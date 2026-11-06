//! A Claude Code thread as a conversation, for the reader view: your prompts,
//! what Claude said, and each run of tool calls between them folded into one
//! entry of steps. Read from the same log as `turns.rs`, with the same idea
//! of what you typed versus what the harness added, and incrementally.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::codex_log;
use crate::thread_edits::{find_log, plain_id};
use crate::turns::{target_of, typed_prompt};
use crate::usage::{logs_root, parse_time};

/// Entries kept per thread; a longer thread keeps its latest.
const MAX_ENTRIES: usize = 600;
/// Characters kept of one prompt or one reply.
const MAX_PROMPT: usize = 8_000;
const MAX_REPLY: usize = 40_000;
/// Lines kept of what a step changed, or of what a failed one printed.
const MAX_DETAIL_LINES: usize = 40;
/// What the CLI prints for a "! cmd" that outlasted its time limit.
const BACKGROUNDED: &str = "was moved to the background";
/// How the CLI's own note starts, added to stderr when a command `cd`s out of
/// the project. It says nothing about how the command went.
const CWD_RESET: &str = "Shell cwd was reset to ";

#[derive(Default)]
pub struct TranscriptState(Arc<Mutex<HashMap<String, Reading>>>);

#[derive(Default)]
struct Reading {
    log: PathBuf,
    /// A Codex rollout, read through `codex_log`.
    codex: bool,
    offset: u64,
    entries: VecDeque<Entry>,
    /// Entries dropped from the front: the first kept one's number.
    dropped: u64,
    /// Tool calls waiting on a result, by tool-use id: entry number and step.
    pending: HashMap<String, (u64, usize)>,
    /// The entry of a command you ran, until its output comes in.
    ran: Option<u64>,
    /// When the turn ended, in ms, while that's the log's last word: the CLI
    /// is at its prompt. None once another turn starts.
    turn_ended_at: Option<i64>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Its place in the thread, from 0; stable as the thread grows.
    n: u64,
    /// "you", "claude", "steps" or "stopped".
    kind: &'static str,
    text: String,
    /// Unix seconds.
    at: i64,
    steps: Vec<Step>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
pub struct Step {
    tool: String,
    target: String,
    ok: Option<bool>,
    /// What it changed, as diff lines ("- old", "+ new"), or the end of
    /// what it printed when it failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    entries: Vec<Entry>,
    /// Entries before the first one sent, no longer kept.
    dropped: u64,
    /// When the turn ended, if the log says it has and the CLI takes a
    /// message now. The daemon can still say running: it holds that until
    /// subagents sent off in the background report in.
    turn_ended_at: Option<i64>,
}

/// A meta row the harness adds with the CLI still at its prompt.
fn between_turns(content: &serde_json::Value) -> bool {
    let text = match content {
        serde_json::Value::Array(blocks) => blocks.first().and_then(|b| b.get("text")),
        other => Some(other),
    };
    text.and_then(|t| t.as_str()).is_some_and(|t| {
        t.starts_with("<system-reminder>") || t.starts_with("<local-command-caveat>")
    })
}

/// A log timestamp in Unix ms, to set against the daemon's clock.
fn parse_ms(ts: &str) -> Option<i64> {
    let secs = parse_time(ts)?;
    let digits = ts.get(20..)?.split(|c: char| !c.is_ascii_digit()).next();
    let ms = format!("{:0<3}", digits.unwrap_or(""));
    Some(secs * 1000 + ms.get(..3)?.parse::<i64>().ok()?)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    subtype: Option<String>,
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

fn clip_to(s: &str, max: usize) -> String {
    let s = s.trim();
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// What an edit or a write changed, as diff lines, clipped.
fn change_of(tool: &str, input: &serde_json::Value) -> Option<String> {
    let s = |v: &serde_json::Value, k: &str| {
        v.get(k).and_then(|t| t.as_str()).unwrap_or("").to_string()
    };
    let pairs: Vec<(String, String)> = match tool {
        "Edit" => vec![(s(input, "old_string"), s(input, "new_string"))],
        "MultiEdit" => input
            .get("edits")
            .and_then(|e| e.as_array())
            .map(|a| {
                a.iter()
                    .map(|e| (s(e, "old_string"), s(e, "new_string")))
                    .collect()
            })
            .unwrap_or_default(),
        "Write" => vec![(String::new(), s(input, "content"))],
        _ => return None,
    };
    let mut lines = vec![];
    for (i, (old, new)) in pairs.iter().enumerate() {
        if i > 0 {
            lines.push("…".to_string());
        }
        lines.extend(old.lines().map(|l| format!("- {l}")));
        lines.extend(new.lines().map(|l| format!("+ {l}")));
    }
    if lines.is_empty() {
        return None;
    }
    let more = lines.len().saturating_sub(MAX_DETAIL_LINES);
    lines.truncate(MAX_DETAIL_LINES);
    if more > 0 {
        lines.push(format!("… {more} more lines"));
    }
    Some(lines.join("\n"))
}

/// What's between `<tag>` and `</tag>` in `text`.
fn between<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let from = text.find(&open)? + open.len();
    let to = text[from..].find(&close)? + from;
    Some(&text[from..to])
}

/// What a command printed, without the XML escaping the CLI logs it with.
/// `&amp;` goes last, or an escaped "&lt;" would come out as "<".
fn unescape(text: &str) -> String {
    text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

/// The last lines of what a tool printed, from its result's content.
fn output_tail(content: &serde_json::Value) -> String {
    let text = match content {
        serde_json::Value::String(t) => t.clone(),
        serde_json::Value::Array(blocks) => blocks
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    };
    let lines: Vec<&str> = text.trim_end().lines().collect();
    let from = lines.len().saturating_sub(MAX_DETAIL_LINES / 2);
    clip_to(&lines[from..].join("\n"), 4_000)
}

impl Reading {
    fn next_n(&self) -> u64 {
        self.dropped + self.entries.len() as u64
    }

    fn push(&mut self, kind: &'static str, text: String, at: i64) {
        let n = self.next_n();
        self.entries.push_back(Entry {
            n,
            kind,
            text,
            at,
            steps: vec![],
        });
        if self.entries.len() > MAX_ENTRIES {
            self.entries.pop_front();
            self.dropped += 1;
        }
    }

    fn get_mut(&mut self, n: u64) -> Option<&mut Entry> {
        n.checked_sub(self.dropped)
            .and_then(|i| self.entries.get_mut(i as usize))
    }

    fn read_line(&mut self, raw: &str) {
        let Ok(l) = serde_json::from_str::<Line>(raw) else {
            return;
        };
        if l.is_sidechain {
            return;
        }
        let ended = l.timestamp.as_deref().and_then(parse_ms).unwrap_or(0);
        if matches!(
            l.subtype.as_deref(),
            Some("stop_hook_summary" | "turn_duration")
        ) {
            self.turn_ended_at = Some(ended);
            return;
        }
        let Some(content) = l.message.and_then(|m| m.content) else {
            return;
        };
        let at = l.timestamp.as_deref().and_then(parse_time).unwrap_or(0);
        match l.kind.as_deref() {
            Some("user") => self.user(&content, l.is_meta, at, ended),
            Some("assistant") => {
                self.turn_ended_at = None;
                self.assistant(&content, at);
            }
            _ => {}
        }
    }

    fn user(&mut self, content: &serde_json::Value, meta: bool, at: i64, ended: i64) {
        // A turn starting, or carrying on: a peer's message or a task's
        // notification starts one of its own, even as a meta row.
        if !(meta && between_turns(content)) {
            self.turn_ended_at = None;
        }
        if let serde_json::Value::Array(blocks) = content {
            for b in blocks {
                let kind = b.get("type").and_then(|t| t.as_str());
                if kind == Some("text")
                    && b.get("text")
                        .and_then(|t| t.as_str())
                        .is_some_and(|t| t.starts_with("[Request interrupted"))
                {
                    self.push("stopped", String::new(), at);
                    self.turn_ended_at = Some(ended);
                    return;
                }
                if kind != Some("tool_result") {
                    continue;
                }
                let id = b.get("tool_use_id").and_then(|t| t.as_str()).unwrap_or("");
                let Some((n, i)) = self.pending.remove(id) else {
                    continue;
                };
                let failed = b.get("is_error").and_then(|e| e.as_bool()).unwrap_or(false);
                if let Some(step) = self.get_mut(n).and_then(|e| e.steps.get_mut(i)) {
                    step.ok = Some(!failed);
                    if failed {
                        step.detail = b.get("content").map(output_tail).filter(|t| !t.is_empty());
                    }
                }
            }
        }
        if meta {
            return;
        }
        if content.as_str().is_some_and(|text| self.shell(text, at)) {
            return;
        }
        if let Some(prompt) = typed_prompt(content) {
            self.pending.clear();
            self.push("you", clip_to(&prompt, MAX_PROMPT), at);
        }
    }

    /// A command you had the CLI run, "! cmd": its line, then a line with what
    /// it printed, both written once it stops. It reads as a step of its own.
    /// True if `text` was one of those lines. Each starts with its tag, so a
    /// prompt that only mentions the tags stays a prompt.
    fn shell(&mut self, text: &str, at: i64) -> bool {
        if !text.starts_with("<bash-") {
            return false;
        }
        if let Some(command) = between(text, "bash-input") {
            self.push("steps", String::new(), at);
            self.ran = Some(self.next_n() - 1);
            let entry = self.entries.back_mut().expect("just pushed");
            entry.steps.push(Step {
                tool: "Bash".to_string(),
                target: command.trim().to_string(),
                ok: None,
                detail: None,
            });
            return true;
        }
        let Some(out) = between(text, "bash-stdout") else {
            return false;
        };
        // Output with no command before it isn't the CLI's: nothing to fill in.
        let Some(n) = self.ran.take() else {
            return false;
        };
        let out = unescape(out);
        let err = unescape(between(text, "bash-stderr").unwrap_or(""));
        let err = err
            .lines()
            .filter(|l| !l.starts_with(CWD_RESET))
            .collect::<Vec<_>>()
            .join("\n");
        let err = err.trim();
        let printed = [out.trim_end(), err]
            .into_iter()
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if let Some(step) = self.get_mut(n).and_then(|e| e.steps.last_mut()) {
            // Over the CLI's time limit it carries on in the background, and
            // the log never says when that ends: `ok` stays unknown.
            step.ok = (!out.contains(BACKGROUNDED)).then_some(err.is_empty());
            step.detail =
                Some(output_tail(&serde_json::Value::from(printed))).filter(|t| !t.is_empty());
        }
        true
    }

    fn assistant(&mut self, content: &serde_json::Value, at: i64) {
        let serde_json::Value::Array(blocks) = content else {
            return;
        };
        for b in blocks {
            match b.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    let text = b.get("text").and_then(|t| t.as_str()).unwrap_or("").trim();
                    if !text.is_empty() {
                        self.push("claude", clip_to(text, MAX_REPLY), at);
                    }
                }
                Some("tool_use") => {
                    let tool = b.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
                    let input = b.get("input").cloned().unwrap_or_default();
                    // Calls in a row share one entry, so a burst of reads is one line.
                    if self.entries.back().map(|e| e.kind) != Some("steps") {
                        self.push("steps", String::new(), at);
                    }
                    let n = self.next_n() - 1;
                    let entry = self.entries.back_mut().expect("just pushed");
                    if let Some(id) = b.get("id").and_then(|i| i.as_str()) {
                        self.pending.insert(id.to_string(), (n, entry.steps.len()));
                    }
                    entry.steps.push(Step {
                        tool: tool.to_string(),
                        target: target_of(&input),
                        ok: None,
                        detail: change_of(tool, &input),
                    });
                }
                _ => {}
            }
        }
    }

    fn catch_up(&mut self) {
        let Ok(len) = std::fs::metadata(&self.log).map(|m| m.len()) else {
            return;
        };
        if len < self.offset {
            *self = Reading {
                log: self.log.clone(),
                codex: self.codex,
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
            if n == 0 || line.last() != Some(&b'\n') {
                break;
            }
            self.offset += n as u64;
            if let Ok(text) = std::str::from_utf8(&line) {
                if self.codex {
                    for l in codex_log::as_claude(text) {
                        self.read_line(&l);
                    }
                } else if text.contains("\"message\"") || text.contains("\"subtype\"") {
                    self.read_line(text);
                }
            }
        }
    }
}

/// `session`'s conversation, the entries numbered `from` on (all kept ones
/// when `from` is none). An entry of steps can still gain results, so the
/// webview asks again from its last entry.
#[tauri::command]
pub async fn thread_transcript(
    session: String,
    from: Option<u64>,
    kind: Option<String>,
    state: State<'_, TranscriptState>,
) -> Result<Option<Transcript>, String> {
    let readings = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        if !plain_id(&session) {
            return Ok(None);
        }
        let mut readings = readings.lock().map_err(|e| e.to_string())?;
        if !readings.contains_key(&session) {
            let codex = kind.as_deref() == Some("codex");
            let log = if codex {
                codex_log::find_log(&session)
            } else {
                let root = logs_root().ok_or("no home folder to find Claude Code's logs in")?;
                find_log(&root, &session)
            };
            let Some(log) = log else {
                return Ok(None);
            };
            readings.insert(
                session.clone(),
                Reading {
                    log,
                    codex,
                    ..Reading::default()
                },
            );
        }
        let r = readings.get_mut(&session).expect("just inserted");
        r.catch_up();
        let from = from.unwrap_or(0).max(r.dropped);
        Ok(Some(Transcript {
            entries: r.entries.iter().filter(|e| e.n >= from).cloned().collect(),
            dropped: r.dropped,
            turn_ended_at: r.turn_ended_at,
        }))
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
    const WORK: &str = r#"{"type":"assistant","timestamp":"2026-10-14T01:00:05Z","message":{"content":[{"type":"text","text":"Looking."},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/r/a.ts"}},{"type":"tool_use","id":"t2","name":"Bash","input":{"command":"npm test"}}]}}"#;
    const MORE: &str = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t3","name":"Edit","input":{"file_path":"/r/a.ts"}}]}}"#;
    const RESULTS: &str = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t2","is_error":true},{"type":"tool_result","tool_use_id":"t3"}]}}"#;
    const DONE: &str =
        r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Fixed it."}]}}"#;

    #[test]
    fn a_thread_reads_as_a_conversation_with_folded_steps() {
        let r = read(&[PROMPT, WORK, MORE, RESULTS, DONE]);
        let kinds: Vec<_> = r.entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["you", "claude", "steps", "claude"]);
        let steps = &r.entries[2].steps;
        assert_eq!(steps.len(), 3, "calls in a row share one entry");
        assert_eq!(
            steps.iter().map(|s| s.ok).collect::<Vec<_>>(),
            [None, Some(false), Some(true)]
        );
        assert_eq!(r.entries[3].text, "Fixed it.");
    }

    #[test]
    fn a_turn_ending_means_the_prompt_is_back_until_the_next_one_starts() {
        const SUMMARY: &str = r#"{"type":"system","subtype":"stop_hook_summary","hookCount":3}"#;
        const ENDED: &str =
            r#"{"type":"system","subtype":"turn_duration","pendingWorkflowCount":1}"#;
        const NOTIFIED: &str = r#"{"type":"user","message":{"content":"<task-notification>done</task-notification>"}}"#;
        const STOPPED: &str = r#"{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#;
        const CAVEAT: &str =
            r#"{"type":"user","isMeta":true,"message":{"content":"<local-command-caveat>caveat"}}"#;
        const REMINDER: &str = r#"{"type":"user","isMeta":true,"message":{"content":[{"type":"text","text":"<system-reminder>tools"}]}}"#;
        const HELPER: &str = r#"{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"a subagent"}]}}"#;
        const QUEUE: &str = r#"{"type":"queue-operation","operation":"enqueue"}"#;

        assert!(read(&[PROMPT, WORK]).turn_ended_at.is_none(), "mid-turn");
        assert!(read(&[PROMPT, DONE, SUMMARY]).turn_ended_at.is_some());
        assert!(read(&[PROMPT, DONE, SUMMARY, ENDED])
            .turn_ended_at
            .is_some());
        // Subagents and the harness carry on past the end of the turn.
        assert!(read(&[DONE, ENDED, HELPER, CAVEAT, REMINDER, QUEUE])
            .turn_ended_at
            .is_some());
        assert!(
            read(&[DONE, ENDED, PROMPT]).turn_ended_at.is_none(),
            "you replied"
        );
        assert!(
            read(&[DONE, ENDED, NOTIFIED]).turn_ended_at.is_none(),
            "a task reported"
        );
        assert!(
            read(&[PROMPT, WORK, STOPPED]).turn_ended_at.is_some(),
            "you stopped it"
        );
    }

    #[test]
    fn a_peers_message_starts_a_turn_though_its_row_is_meta() {
        const ENDED: &str = r#"{"type":"system","subtype":"turn_duration"}"#;
        const PEER: &str = r#"{"type":"user","isMeta":true,"message":{"content":"Another Claude session sent a message"}}"#;
        assert!(read(&[DONE, ENDED, PEER]).turn_ended_at.is_none());
    }

    #[test]
    fn a_turn_ending_is_read_from_the_log_though_it_has_no_message() {
        let log = std::env::temp_dir().join(format!("transcript-{}.jsonl", std::process::id()));
        let ended =
            r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-11-06T04:13:22.075Z"}"#;
        std::fs::write(&log, format!("{DONE}\n{ended}\n")).unwrap();
        let mut r = Reading {
            log: log.clone(),
            ..Reading::default()
        };
        r.catch_up();
        std::fs::remove_file(&log).unwrap();
        assert!(r.turn_ended_at.is_some_and(|t| t > 0));
    }

    #[test]
    fn a_turn_ending_keeps_its_time_to_the_millisecond() {
        let ended =
            r#"{"type":"system","subtype":"turn_duration","timestamp":"2026-11-06T04:13:22.075Z"}"#;
        let whole = parse_time("2026-11-06T04:13:22Z").unwrap();
        assert_eq!(read(&[ended]).turn_ended_at, Some(whole * 1000 + 75));
        assert_eq!(parse_ms("2026-11-06T04:13:22Z"), Some(whole * 1000));
    }

    #[test]
    fn a_step_says_what_it_changed_or_how_it_failed() {
        let edit = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"e1","name":"Edit","input":{"file_path":"/r/a.ts","old_string":"a\nb","new_string":"c"}},{"type":"tool_use","id":"e2","name":"Bash","input":{"command":"npm test"}}]}}"#;
        let failed = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"e2","is_error":true,"content":[{"type":"text","text":"ok 1\nnot ok 2 - sync\n"}]}]}}"#;
        let r = read(&[PROMPT, edit, failed]);
        let steps = &r.entries[1].steps;
        assert_eq!(steps[0].detail.as_deref(), Some("- a\n- b\n+ c"));
        assert_eq!(steps[1].detail.as_deref(), Some("ok 1\nnot ok 2 - sync"));
    }

    #[test]
    fn harness_messages_and_subagents_are_left_out() {
        let r = read(&[
            PROMPT,
            r#"{"type":"user","message":{"content":"<task-notification>x</task-notification>"}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"sub"}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"text","text":"[Request interrupted by user]"}]}}"#,
        ]);
        let kinds: Vec<_> = r.entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["you", "stopped"]);
    }

    #[test]
    fn a_command_you_ran_reads_as_a_step_with_its_output() {
        let r = read(&[
            PROMPT,
            r#"{"type":"user","message":{"content":"<local-command-caveat>Run directly.</local-command-caveat>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-input> npm test && echo ok</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout>12 passed</bash-stdout><bash-stderr></bash-stderr>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-input>false</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout></bash-stdout><bash-stderr>Error: no</bash-stderr>"}}"#,
        ]);
        let kinds: Vec<_> = r.entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["you", "steps", "steps"]);
        let ran = &r.entries[1].steps[0];
        assert_eq!(
            (ran.tool.as_str(), ran.target.as_str()),
            ("Bash", "npm test && echo ok")
        );
        assert_eq!(
            (ran.ok, ran.detail.as_deref()),
            (Some(true), Some("12 passed"))
        );
        let bad = &r.entries[2].steps[0];
        assert_eq!(
            (bad.ok, bad.detail.as_deref()),
            (Some(false), Some("Error: no"))
        );
    }

    #[test]
    fn what_a_command_printed_reads_unescaped() {
        let r = read(&[
            r#"{"type":"user","message":{"content":"<bash-input>a && b</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout>==&gt; Updating &lt;main&gt;\na &amp;&amp; b, &quot;x&quot; &#39;y&#39; &apos;z&apos;\nliteral &amp;lt;</bash-stdout><bash-stderr></bash-stderr>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-input>false</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout></bash-stdout><bash-stderr>x: no such file &lt;y&gt; &amp; more</bash-stderr>"}}"#,
        ]);
        assert_eq!(r.entries[0].steps[0].target, "a && b");
        assert_eq!(
            r.entries[0].steps[0].detail.as_deref(),
            Some("==> Updating <main>\na && b, \"x\" 'y' 'z'\nliteral &lt;")
        );
        assert_eq!(
            (
                r.entries[1].steps[0].ok,
                r.entries[1].steps[0].detail.as_deref()
            ),
            (Some(false), Some("x: no such file <y> & more"))
        );
    }

    #[test]
    fn the_cwd_notice_is_not_a_failure_and_keeps_the_output() {
        let r = read(&[
            r#"{"type":"user","message":{"content":"<bash-input>cd /tmp && ls</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout>a.txt\nb.txt</bash-stdout><bash-stderr>Shell cwd was reset to /Users/me/repo</bash-stderr>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-input>cd /tmp</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout></bash-stdout><bash-stderr>Shell cwd was reset to /Users/me/repo</bash-stderr>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-input>cd /tmp && nope</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout></bash-stdout><bash-stderr>nope: not found\nShell cwd was reset to /Users/me/repo</bash-stderr>"}}"#,
        ]);
        let step = |i: usize| {
            let s = &r.entries[i].steps[0];
            (s.ok, s.detail.as_deref())
        };
        assert_eq!(step(0), (Some(true), Some("a.txt\nb.txt")));
        assert_eq!(step(1), (Some(true), None));
        assert_eq!(step(2), (Some(false), Some("nope: not found")));
    }

    #[test]
    fn both_streams_show_when_a_command_prints_to_both() {
        let r = read(&[
            r#"{"type":"user","message":{"content":"<bash-input>make</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout>built a</bash-stdout><bash-stderr>make: no b</bash-stderr>"}}"#,
        ]);
        let step = &r.entries[0].steps[0];
        assert_eq!(
            (step.ok, step.detail.as_deref()),
            (Some(false), Some("built a\nmake: no b"))
        );
    }

    #[test]
    fn a_prompt_mentioning_the_bash_tags_stays_in_the_thread() {
        let tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#;
        let done = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#;
        let input = r#"{"type":"user","message":{"content":"Why does <bash-input>ls</bash-input> show up?"}}"#;
        let output = r#"{"type":"user","message":{"content":"The log has <bash-stdout>hi</bash-stdout><bash-stderr>boom</bash-stderr> in it"}}"#;
        let r = read(&[PROMPT, tool, done, input, output]);
        let kinds: Vec<_> = r.entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["you", "steps", "you", "you"]);
        assert!(r.entries[2].text.contains("<bash-input>ls</bash-input>"));
        assert!(r.entries[3].text.contains("<bash-stdout>hi</bash-stdout>"));
        let step = &r.entries[1].steps[0];
        assert_eq!((step.ok, step.detail.as_deref()), (Some(true), None));
    }

    #[test]
    fn output_only_lands_on_the_command_it_belongs_to() {
        let tool = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Bash","input":{"command":"ls"}}]}}"#;
        let done = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"}]}}"#;
        let output = r#"{"type":"user","message":{"content":"<bash-stdout>hi</bash-stdout><bash-stderr>boom</bash-stderr>"}}"#;
        let r = read(&[PROMPT, tool, done, output]);
        let kinds: Vec<_> = r.entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["you", "steps"]);
        let step = &r.entries[1].steps[0];
        assert_eq!((step.ok, step.detail.as_deref()), (Some(true), None));
    }

    #[test]
    fn a_command_moved_to_the_background_is_left_unfinished() {
        let r = read(&[
            r#"{"type":"user","message":{"content":"<bash-input>deploy</bash-input>"}}"#,
            r#"{"type":"user","message":{"content":"<bash-stdout>Command did not complete within its 120s timeout and was moved to the background (ID: b1).</bash-stdout><bash-stderr></bash-stderr>"}}"#,
        ]);
        let step = &r.entries[0].steps[0];
        assert_eq!(step.ok, None);
        assert!(step
            .detail
            .as_deref()
            .is_some_and(|d| d.contains("background")));
    }

    #[test]
    fn a_pasted_message_shows_without_its_wrapper() {
        let r = read(&[
            r#"{"type":"user","message":{"content":"\n\n<pasted_content id=\"3aef\">\nRegister client\n</pasted_content id=\"3aef\">\n"}}"#,
        ]);
        assert_eq!(r.entries[0].kind, "you");
        assert_eq!(r.entries[0].text, "Register client");
    }

    #[test]
    fn a_long_thread_keeps_its_latest_entries_and_numbers() {
        let mut r = Reading::default();
        for i in 0..MAX_ENTRIES + 3 {
            r.read_line(&format!(
                r#"{{"type":"user","message":{{"content":"prompt {i}"}}}}"#
            ));
        }
        assert_eq!(r.entries.len(), MAX_ENTRIES);
        assert_eq!(r.dropped, 3);
        assert_eq!(r.entries[0].n, 3);
        assert_eq!(r.entries[0].text, "prompt 3");
    }

    #[test]
    fn a_codex_thread_reads_as_a_conversation() {
        let item = |item: &str| {
            format!(
                r#"{{"timestamp":"2026-10-14T01:00:00Z","type":"event_msg","payload":{{"type":"item_completed","item":{item}}}}}"#
            )
        };
        let mut r = Reading {
            codex: true,
            ..Reading::default()
        };
        for raw in [
            item(r#"{"type":"UserMessage","content":[{"type":"text","text":"fix the build"}]}"#),
            item(r#"{"type":"AgentMessage","content":[{"type":"Text","text":"Looking."}]}"#),
            item(
                r#"{"type":"CommandExecution","id":"e1","command":["zsh","-lc","npm test"],"parsed_cmd":[],"status":"completed","exit_code":0}"#,
            ),
            item(r#"{"type":"FileChange","id":"f1","changes":{"/r/a.ts":{"type":"update"}}}"#),
            item(r#"{"type":"AgentMessage","content":[{"type":"Text","text":"Fixed it."}]}"#),
        ] {
            for l in codex_log::as_claude(&raw) {
                r.read_line(&l);
            }
        }
        let kinds: Vec<_> = r.entries.iter().map(|e| e.kind).collect();
        assert_eq!(kinds, ["you", "claude", "steps", "claude"]);
        assert_eq!(
            r.entries[2].steps.len(),
            2,
            "the command and the edit share one entry"
        );
        assert!(r.entries[2].steps.iter().all(|s| s.ok == Some(true)));
    }
}
