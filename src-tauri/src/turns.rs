//! What a Claude Code thread did in its latest turn, read from its log
//! (`~/.claude/projects/<cwd>/<session>.jsonl`): the prompt that started it,
//! each tool call with whether it worked, and the last thing Claude said. The
//! webview turns this into the one-line summary above the terminal. A turn
//! starts at a prompt you typed; tool results, task notifications and other
//! messages the harness adds belong to the turn they arrive in. Logs only
//! grow, so each is read from where the last call stopped.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::thread_edits::{find_log, plain_id};
use crate::usage::{logs_root, parse_time};

/// Steps kept per turn; a longer turn keeps its latest.
const MAX_STEPS: usize = 300;
/// Characters kept of a prompt, a command or what Claude said.
const MAX_TEXT: usize = 600;

#[derive(Default)]
pub struct TurnsState(Arc<Mutex<HashMap<String, Reading>>>);

#[derive(Default)]
struct Reading {
    log: PathBuf,
    /// Bytes of the log already read (always up to a line break).
    offset: u64,
    turn: Option<Turn>,
    /// Prompts seen so far: which turn this is.
    turns: u32,
    /// Tool calls still waiting on a result, by tool-use id, to their step.
    pending: HashMap<String, usize>,
}

#[derive(Clone, Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    /// Which turn of the thread this is, from 1.
    number: u32,
    prompt: String,
    /// Unix seconds.
    started: i64,
    /// When the log last moved in this turn (Unix seconds).
    last: i64,
    steps: Vec<Step>,
    /// Steps dropped from the front of a long turn.
    dropped: u32,
    /// The last thing Claude said, if anything yet.
    said: Option<String>,
    interrupted: bool,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct Step {
    tool: String,
    /// What it acted on: a file, a command, a pattern, a URL, a question.
    target: String,
    /// The call's own note on what it's for (a command's description).
    note: Option<String>,
    /// Whether it worked, once its result is in.
    ok: Option<bool>,
    at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    #[serde(default)]
    is_meta: bool,
    #[serde(default)]
    is_sidechain: bool,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    content: Option<serde_json::Value>,
}

fn clip(s: &str) -> String {
    let s = s.trim();
    match s.char_indices().nth(MAX_TEXT) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

fn text_of(v: &serde_json::Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(clip)
}

/// What a tool call acted on, by the inputs each kind of tool takes.
fn target_of(input: &serde_json::Value) -> String {
    for key in [
        "file_path",
        "notebook_path",
        "command",
        "pattern",
        "url",
        "query",
        "description",
        "skill",
    ] {
        if let Some(t) = text_of(input, key) {
            return t;
        }
    }
    input
        .get("questions")
        .and_then(|q| q.get(0))
        .and_then(|q| text_of(q, "question"))
        .unwrap_or_default()
}

/// A prompt you typed, as opposed to what the harness adds as a user message:
/// command output, task notifications, skill text, another session's message.
fn typed_prompt(content: &serde_json::Value) -> Option<String> {
    let text = match content {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Array(blocks) => {
            if blocks
                .iter()
                .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_result"))
            {
                return None;
            }
            blocks
                .iter()
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .filter(|t| !t.starts_with("[Image"))
                .collect::<Vec<_>>()
                .join("\n")
        }
        _ => return None,
    };
    let t = text.trim_start();
    let harness = t.starts_with('<')
        || t.starts_with("Another Claude session sent a message")
        || t.starts_with("Base directory for this skill");
    (!t.is_empty() && !harness).then_some(text)
}

impl Reading {
    fn read_line(&mut self, raw: &str) {
        let Ok(l) = serde_json::from_str::<Line>(raw) else {
            return;
        };
        if l.is_sidechain {
            return;
        }
        let Some(content) = l.message.and_then(|m| m.content) else {
            return;
        };
        let at = l.timestamp.as_deref().and_then(parse_time).unwrap_or(0);
        match l.kind.as_deref() {
            Some("user") => self.user(&content, l.is_meta, at),
            Some("assistant") => self.assistant(&content, at),
            _ => {}
        }
    }

    fn user(&mut self, content: &serde_json::Value, meta: bool, at: i64) {
        if let serde_json::Value::Array(blocks) = content {
            for b in blocks {
                if b.get("type").and_then(|t| t.as_str()) == Some("text")
                    && b.get("text")
                        .and_then(|t| t.as_str())
                        .is_some_and(|t| t.starts_with("[Request interrupted"))
                {
                    if let Some(turn) = &mut self.turn {
                        turn.interrupted = true;
                        turn.last = at.max(turn.last);
                    }
                    return;
                }
                if b.get("type").and_then(|t| t.as_str()) != Some("tool_result") {
                    continue;
                }
                let id = b.get("tool_use_id").and_then(|t| t.as_str()).unwrap_or("");
                let Some(i) = self.pending.remove(id) else {
                    continue;
                };
                if let Some(step) = self.turn.as_mut().and_then(|t| t.steps.get_mut(i)) {
                    let failed = b.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
                    step.ok = Some(!failed);
                }
            }
        }
        if meta {
            return;
        }
        if let Some(prompt) = typed_prompt(content) {
            self.turns += 1;
            self.pending.clear();
            self.turn = Some(Turn {
                number: self.turns,
                prompt: clip(&prompt),
                started: at,
                last: at,
                ..Turn::default()
            });
        } else if let Some(turn) = &mut self.turn {
            turn.last = at.max(turn.last);
        }
    }

    fn assistant(&mut self, content: &serde_json::Value, at: i64) {
        let Some(turn) = &mut self.turn else {
            return;
        };
        let serde_json::Value::Array(blocks) = content else {
            return;
        };
        turn.last = at.max(turn.last);
        for b in blocks {
            match b.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    if let Some(t) = text_of(b, "text").filter(|t| !t.is_empty()) {
                        turn.said = Some(t);
                    }
                }
                Some("tool_use") => {
                    let tool = b.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
                    let input = b.get("input").cloned().unwrap_or_default();
                    let note = (tool == "Bash")
                        .then(|| text_of(&input, "description"))
                        .flatten();
                    if turn.steps.len() >= MAX_STEPS {
                        turn.steps.remove(0);
                        turn.dropped += 1;
                        // Every pending index moved down by one.
                        self.pending.retain(|_, i| {
                            if *i == 0 {
                                return false;
                            }
                            *i -= 1;
                            true
                        });
                    }
                    if let Some(id) = b.get("id").and_then(|i| i.as_str()) {
                        self.pending.insert(id.to_string(), turn.steps.len());
                    }
                    turn.steps.push(Step {
                        tool: tool.to_string(),
                        target: target_of(&input),
                        note,
                        ok: None,
                        at,
                    });
                }
                _ => {}
            }
        }
    }

    /// Read what the log gained since the last call.
    fn catch_up(&mut self) {
        let Ok(len) = std::fs::metadata(&self.log).map(|m| m.len()) else {
            return;
        };
        // A log that shrank was rewritten: read it again from the top.
        if len < self.offset {
            *self = Reading {
                log: self.log.clone(),
                ..Reading::default()
            };
        }
        if len == self.offset {
            return;
        }
        let Ok(mut f) = File::open(&self.log) else {
            return;
        };
        if f.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut reader = BufReader::new(f);
        let mut line = Vec::new();
        loop {
            line.clear();
            let Ok(n) = reader.read_until(b'\n', &mut line) else {
                break;
            };
            // Stop before a line still being written; it's read next time.
            if n == 0 || line.last() != Some(&b'\n') {
                break;
            }
            self.offset += n as u64;
            // Cheap reject before parsing: only messages matter here.
            let Ok(text) = std::str::from_utf8(&line) else {
                continue;
            };
            if text.contains("\"message\"") {
                self.read_line(text);
            }
        }
    }
}

/// The latest turn of `session` (a Claude Code session id), or none when it
/// has no log on this machine or no prompt yet.
#[tauri::command]
pub async fn thread_turn(
    session: String,
    state: State<'_, TurnsState>,
) -> Result<Option<Turn>, String> {
    let readings = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !plain_id(&session) {
            return Ok(None);
        }
        let mut readings = readings.lock().map_err(|e| e.to_string())?;
        if !readings.contains_key(&session) {
            let root = logs_root().ok_or("no home folder to find Claude Code's logs in")?;
            let Some(log) = find_log(&root, &session) else {
                return Ok(None);
            };
            readings.insert(
                session.clone(),
                Reading {
                    log,
                    ..Reading::default()
                },
            );
        }
        let reading = readings.get_mut(&session).expect("just inserted");
        reading.catch_up();
        Ok(reading.turn.clone())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(lines: &[&str]) -> Reading {
        let mut r = Reading::default();
        for l in lines {
            r.read_line(l);
        }
        r
    }

    const PROMPT: &str = r#"{"type":"user","timestamp":"2026-10-14T01:00:00Z","message":{"content":"fix the build"}}"#;
    const BASH: &str = r#"{"type":"assistant","timestamp":"2026-10-14T01:00:05Z","message":{"content":[{"type":"text","text":"Running it"},{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"npm test","description":"Run the tests"}},{"type":"tool_use","id":"t2","name":"Edit","input":{"file_path":"/r/a.ts"}}]}}"#;
    const RESULTS: &str = r#"{"type":"user","timestamp":"2026-10-14T01:00:09Z","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":true},{"type":"tool_result","tool_use_id":"t2"}]}}"#;

    #[test]
    fn a_turn_collects_its_steps_and_their_results() {
        let r = read(&[PROMPT, BASH, RESULTS]);
        let t = r.turn.unwrap();
        assert_eq!(t.number, 1);
        assert_eq!(t.prompt, "fix the build");
        assert_eq!(t.said.as_deref(), Some("Running it"));
        assert_eq!(t.steps.len(), 2);
        assert_eq!(t.steps[0].target, "npm test");
        assert_eq!(t.steps[0].note.as_deref(), Some("Run the tests"));
        assert_eq!(t.steps[0].ok, Some(false));
        assert_eq!(t.steps[1].target, "/r/a.ts");
        assert_eq!(t.steps[1].ok, Some(true));
        assert_eq!(t.last - t.started, 9);
    }

    #[test]
    fn a_new_prompt_starts_a_new_turn() {
        let next = r#"{"type":"user","timestamp":"2026-10-14T02:00:00Z","message":{"content":[{"type":"text","text":"now push it"}]}}"#;
        let t = read(&[PROMPT, BASH, RESULTS, next]).turn.unwrap();
        assert_eq!(
            (t.number, t.prompt.as_str(), t.steps.len()),
            (2, "now push it", 0)
        );
    }

    #[test]
    fn what_the_harness_adds_stays_in_the_turn() {
        let lines = [
            r#"{"type":"user","isMeta":true,"message":{"content":"Caveat: local command"}}"#,
            r#"{"type":"user","message":{"content":"<task-notification>done</task-notification>"}}"#,
            r#"{"type":"user","message":{"content":"Another Claude session sent a message: hi"}}"#,
            r#"{"type":"user","isSidechain":true,"message":{"content":"subagent prompt"}}"#,
        ];
        let mut all = vec![PROMPT];
        all.extend(lines);
        let t = read(&all).turn.unwrap();
        assert_eq!((t.number, t.prompt.as_str()), (1, "fix the build"));
    }

    #[test]
    fn an_interrupt_marks_the_turn() {
        let stop = r#"{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#;
        let r = read(&[PROMPT, BASH, stop]);
        let t = r.turn.unwrap();
        assert!(t.interrupted);
        assert_eq!((t.number, t.prompt.as_str()), (1, "fix the build"));
    }

    #[test]
    fn a_long_turn_keeps_its_latest_steps() {
        let mut r = read(&[PROMPT]);
        for i in 0..MAX_STEPS + 5 {
            r.read_line(&format!(
                r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"x{i}","name":"Read","input":{{"file_path":"/f{i}"}}}}]}}}}"#
            ));
        }
        r.read_line(&format!(
            r#"{{"type":"user","message":{{"content":[{{"type":"tool_result","tool_use_id":"x{}"}}]}}}}"#,
            MAX_STEPS + 4
        ));
        let t = r.turn.unwrap();
        assert_eq!((t.steps.len(), t.dropped), (MAX_STEPS, 5));
        assert_eq!(t.steps[0].target, "/f5");
        assert_eq!(t.steps.last().unwrap().ok, Some(true));
    }

    #[test]
    fn questions_name_what_they_ask() {
        let ask = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"q","name":"AskUserQuestion","input":{"questions":[{"question":"Which port?"}]}}]}}"#;
        let t = read(&[PROMPT, ask]).turn.unwrap();
        assert_eq!(t.steps[0].target, "Which port?");
    }
}
