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

use crate::thread_edits::{find_log, plain_id};
use crate::turns::{target_of, typed_prompt};
use crate::usage::{logs_root, parse_time};

/// Entries kept per thread; a longer thread keeps its latest.
const MAX_ENTRIES: usize = 600;
/// Characters kept of one prompt or one reply.
const MAX_PROMPT: usize = 8_000;
const MAX_REPLY: usize = 40_000;

#[derive(Default)]
pub struct TranscriptState(Arc<Mutex<HashMap<String, Reading>>>);

#[derive(Default)]
struct Reading {
    log: PathBuf,
    offset: u64,
    entries: VecDeque<Entry>,
    /// Entries dropped from the front: the first kept one's number.
    dropped: u64,
    /// Tool calls waiting on a result, by tool-use id: entry number and step.
    pending: HashMap<String, (u64, usize)>,
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
}

#[derive(Serialize)]
pub struct Transcript {
    entries: Vec<Entry>,
    /// Entries before the first one sent, no longer kept.
    dropped: u64,
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

fn clip_to(s: &str, max: usize) -> String {
    let s = s.trim();
    match s.char_indices().nth(max) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
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
                let kind = b.get("type").and_then(|t| t.as_str());
                if kind == Some("text")
                    && b.get("text")
                        .and_then(|t| t.as_str())
                        .is_some_and(|t| t.starts_with("[Request interrupted"))
                {
                    self.push("stopped", String::new(), at);
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
                }
            }
        }
        if meta {
            return;
        }
        if let Some(prompt) = typed_prompt(content) {
            self.pending.clear();
            self.push("you", clip_to(&prompt, MAX_PROMPT), at);
        }
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
                if text.contains("\"message\"") {
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
    state: State<'_, TranscriptState>,
) -> Result<Option<Transcript>, String> {
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
        let r = readings.get_mut(&session).expect("just inserted");
        r.catch_up();
        let from = from.unwrap_or(0).max(r.dropped);
        Ok(Some(Transcript {
            entries: r.entries.iter().filter(|e| e.n >= from).cloned().collect(),
            dropped: r.dropped,
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
}
