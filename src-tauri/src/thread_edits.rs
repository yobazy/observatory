//! Which files each Claude Code thread changed, read from its log
//! (`~/.claude/projects/<cwd>/<session>.jsonl`, subagents under
//! `<session>/subagents/`): every Edit, MultiEdit, Write and NotebookEdit call
//! names the file it changed. The webview matches these against a checkout's
//! uncommitted files, so each one sits under the thread that left it. Logs
//! only grow, so each is read from where the last call stopped.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::usage::{logs_root, parse_time};

#[derive(Default)]
pub struct EditsState(Arc<Mutex<Scan>>);

#[derive(Default)]
struct Scan {
    /// Each session's own log, once found (its folder never changes).
    logs: HashMap<String, PathBuf>,
    /// Bytes of each log already read (always up to a line break).
    offsets: HashMap<PathBuf, u64>,
    /// Per session, each file it changed and when it last did (Unix seconds).
    files: HashMap<String, HashMap<String, i64>>,
}

#[derive(Serialize)]
pub struct Edit {
    path: String,
    /// Unix seconds.
    at: i64,
}

#[derive(Deserialize)]
struct Line {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    content: Option<serde_json::Value>,
}

const EDIT_TOOLS: [&str; 4] = ["Edit", "MultiEdit", "Write", "NotebookEdit"];

/// The files one log line says the thread changed, with when.
fn edits_in(line: &str) -> Vec<(String, i64)> {
    // Cheap reject before parsing: most lines aren't tool calls.
    if !line.contains("\"tool_use\"") {
        return vec![];
    }
    let Ok(l) = serde_json::from_str::<Line>(line) else {
        return vec![];
    };
    if l.kind.as_deref() != Some("assistant") {
        return vec![];
    }
    let Some(at) = l.timestamp.as_deref().and_then(parse_time) else {
        return vec![];
    };
    let Some(serde_json::Value::Array(blocks)) = l.message.and_then(|m| m.content) else {
        return vec![];
    };
    blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .filter(|b| {
            b.get("name")
                .and_then(|n| n.as_str())
                .is_some_and(|n| EDIT_TOOLS.contains(&n))
        })
        .filter_map(|b| {
            let input = b.get("input")?;
            let path = input
                .get("file_path")
                .or_else(|| input.get("notebook_path"))?
                .as_str()?;
            Some((path.to_string(), at))
        })
        .collect()
}

/// A session id as Claude Code writes it; anything else could name a path.
pub(crate) fn plain_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The session's own log: `<session>.jsonl` in whichever project folder has it.
pub(crate) fn find_log(root: &Path, session: &str) -> Option<PathBuf> {
    let name = format!("{session}.jsonl");
    std::fs::read_dir(root)
        .ok()?
        .flatten()
        .map(|e| e.path().join(&name))
        .find(|p| p.is_file())
}

/// The session's log and its subagents' logs.
fn logs_of(main: &Path, session: &str) -> Vec<PathBuf> {
    let mut logs = vec![main.to_path_buf()];
    if let Some(dir) = main.parent().map(|d| d.join(session).join("subagents")) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            logs.extend(
                entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.extension().is_some_and(|x| x == "jsonl")),
            );
        }
    }
    logs
}

/// Read what `path` gained since the last call into `files`.
fn read_new(path: &Path, offsets: &mut HashMap<PathBuf, u64>, files: &mut HashMap<String, i64>) {
    let Ok(len) = std::fs::metadata(path).map(|m| m.len()) else {
        return;
    };
    let mut from = offsets.get(path).copied().unwrap_or(0);
    // A log that shrank was rewritten: read it again from the top.
    if len < from {
        from = 0;
    }
    if len == from {
        return;
    }
    let Ok(mut f) = File::open(path) else {
        return;
    };
    if f.seek(SeekFrom::Start(from)).is_err() {
        return;
    }
    let mut reader = BufReader::new(f);
    let mut line = Vec::new();
    let mut at = from;
    loop {
        line.clear();
        let Ok(n) = reader.read_until(b'\n', &mut line) else {
            break;
        };
        // Stop before a line still being written; it's read next time.
        if n == 0 || line.last() != Some(&b'\n') {
            break;
        }
        at += n as u64;
        if let Ok(text) = std::str::from_utf8(&line) {
            for (file, when) in edits_in(text) {
                let last = files.entry(file).or_insert(when);
                *last = (*last).max(when);
            }
        }
    }
    offsets.insert(path.to_path_buf(), at);
}

/// The files each of `sessions` (Claude Code session ids) changed, by session.
/// A session with no log on this machine is left out.
#[tauri::command]
pub async fn thread_edits(
    sessions: Vec<String>,
    state: State<'_, EditsState>,
) -> Result<HashMap<String, Vec<Edit>>, String> {
    let scan = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let root = logs_root().ok_or("no home folder to find Claude Code's logs in")?;
        let mut scan = scan.lock().map_err(|e| e.to_string())?;
        let Scan {
            logs,
            offsets,
            files,
        } = &mut *scan;
        let mut out = HashMap::new();
        for session in sessions.into_iter().filter(|s| plain_id(s)) {
            let main = match logs.get(&session) {
                Some(p) => p.clone(),
                None => match find_log(&root, &session) {
                    Some(p) => {
                        logs.insert(session.clone(), p.clone());
                        p
                    }
                    None => continue,
                },
            };
            let seen = files.entry(session.clone()).or_default();
            for log in logs_of(&main, &session) {
                read_new(&log, offsets, seen);
            }
            let edits = seen
                .iter()
                .map(|(path, &at)| Edit {
                    path: path.clone(),
                    at,
                })
                .collect();
            out.insert(session, edits);
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn edits_are_read_from_tool_calls() {
        let line = r#"{"type":"assistant","timestamp":"2026-10-14T03:39:30.800Z","message":{"content":[
            {"type":"text","text":"Saving it"},
            {"type":"tool_use","name":"Write","input":{"file_path":"/repo/a.ts","content":"x"}},
            {"type":"tool_use","name":"Edit","input":{"file_path":"/repo/b.ts","old_string":"a","new_string":"b"}},
            {"type":"tool_use","name":"NotebookEdit","input":{"notebook_path":"/repo/n.ipynb"}},
            {"type":"tool_use","name":"Read","input":{"file_path":"/repo/c.ts"}}
        ]}}"#
            .replace('\n', "");
        let at = parse_time("2026-10-14T03:39:30.800Z").unwrap();
        assert_eq!(
            edits_in(&line),
            vec![
                ("/repo/a.ts".to_string(), at),
                ("/repo/b.ts".to_string(), at),
                ("/repo/n.ipynb".to_string(), at)
            ]
        );
    }

    #[test]
    fn other_lines_have_no_edits() {
        assert!(
            edits_in(r#"{"type":"user","message":{"content":[{"type":"tool_result"}]}}"#)
                .is_empty()
        );
        assert!(edits_in(r#"{"type":"assistant","message":{"content":"tool_use"}}"#).is_empty());
        assert!(edits_in("not json \"tool_use\"").is_empty());
    }

    #[test]
    fn only_plain_ids_name_a_log() {
        assert!(plain_id("dbb11c21-7ca7-4523-a6f2-c0812faa971b"));
        assert!(!plain_id("../etc/passwd"));
        assert!(!plain_id(""));
    }

    #[test]
    fn a_log_is_read_once_and_then_only_what_it_gained() {
        let dir = std::env::temp_dir().join(format!("observatory-edits-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("s.jsonl");
        let edit = |p: &str, ts: &str| {
            format!(
                r#"{{"type":"assistant","timestamp":"{ts}","message":{{"content":[{{"type":"tool_use","name":"Edit","input":{{"file_path":"{p}"}}}}]}}}}"#
            ) + "\n"
        };
        std::fs::write(&log, edit("/r/a", "2026-10-14T01:00:00Z")).unwrap();
        let (mut offsets, mut files) = (HashMap::new(), HashMap::new());
        read_new(&log, &mut offsets, &mut files);
        assert_eq!(files.len(), 1);

        let more = edit("/r/a", "2026-10-14T02:00:00Z") + &edit("/r/b", "2026-10-14T02:00:00Z");
        let mut f = std::fs::OpenOptions::new().append(true).open(&log).unwrap();
        std::io::Write::write_all(&mut f, more.as_bytes()).unwrap();
        // Half a line, still being written: left for next time.
        std::io::Write::write_all(&mut f, br#"{"type":"assistant""#).unwrap();
        read_new(&log, &mut offsets, &mut files);
        assert_eq!(files["/r/a"], parse_time("2026-10-14T02:00:00Z").unwrap());
        assert!(files.contains_key("/r/b"));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
