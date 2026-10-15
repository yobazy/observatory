//! A Codex thread's log (`~/.codex/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`)
//! retold as Claude Code log lines, so the turn summary (`turns.rs`) and the
//! reader (`transcript.rs`) read both kinds of thread the same way. Codex
//! records each finished item once, result included: a command becomes a
//! tool call and its result back to back, and a file change one Edit per file.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};

/// Where Codex keeps its sessions.
fn sessions_root() -> Option<PathBuf> {
    let home = match std::env::var_os("CODEX_HOME") {
        Some(dir) => PathBuf::from(dir),
        None => PathBuf::from(std::env::var_os("HOME")?).join(".codex"),
    };
    Some(home.join("sessions"))
}

/// The rollout whose name ends in `session`, newest day first: a thread is
/// usually recent, and the folders are dated.
pub(crate) fn find_log(session: &str) -> Option<PathBuf> {
    find_in(&sessions_root()?, &format!("-{session}.jsonl"), 3)
}

fn find_in(dir: &Path, suffix: &str, depth: u8) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .collect();
    entries.sort_unstable_by(|a, b| b.cmp(a));
    if depth == 0 {
        return entries.into_iter().find(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(suffix))
        });
    }
    entries
        .iter()
        .filter(|p| p.is_dir())
        .find_map(|p| find_in(p, suffix, depth - 1))
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

/// A Codex command as the Claude Code tool that does the same thing, and
/// its input: a plain read, search or listing gets its own name, so the
/// summary counts it as looking rather than running.
fn as_tool(item: &Value) -> (&'static str, Value) {
    let shell = item
        .get("command")
        .and_then(|c| c.as_array())
        .and_then(|a| a.last())
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let parsed = item.get("parsed_cmd").and_then(|p| p.as_array());
    if let Some([one]) = parsed.map(|p| p.as_slice()) {
        let cmd = str_of(one, "cmd");
        match str_of(one, "type") {
            "read" if !str_of(one, "path").is_empty() => {
                return ("Read", json!({ "file_path": str_of(one, "path") }))
            }
            "search" => return ("Grep", json!({ "pattern": cmd })),
            "list_files" => return ("Glob", json!({ "pattern": cmd })),
            _ => {}
        }
    }
    ("Bash", json!({ "command": shell }))
}

fn user(at: &Value, content: Value) -> String {
    json!({ "type": "user", "timestamp": at, "message": { "content": content } }).to_string()
}

fn assistant(at: &Value, content: Value) -> String {
    json!({ "type": "assistant", "timestamp": at, "message": { "content": content } }).to_string()
}

/// A call and its result, as Claude Code logs them on two lines.
fn call(at: &Value, id: &str, tool: &str, input: Value, ok: bool) -> [String; 2] {
    [
        assistant(
            at,
            json!([{ "type": "tool_use", "id": id, "name": tool, "input": input }]),
        ),
        user(
            at,
            json!([{ "type": "tool_result", "tool_use_id": id, "is_error": !ok }]),
        ),
    ]
}

/// The Claude Code lines that tell what `raw` (one Codex log line) does;
/// none for the many lines that don't matter here.
pub(crate) fn as_claude(raw: &str) -> Vec<String> {
    // Cheap reject: everything read here is an event.
    if !raw.contains("\"event_msg\"") {
        return vec![];
    }
    let Ok(line) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let at = line.get("timestamp").cloned().unwrap_or(Value::Null);
    let Some(p) = line.get("payload") else {
        return vec![];
    };
    match str_of(p, "type") {
        "turn_aborted" => vec![user(
            &at,
            json!([{ "type": "text", "text": "[Request interrupted by user]" }]),
        )],
        "item_completed" => {
            let Some(item) = p.get("item") else {
                return vec![];
            };
            let id = str_of(item, "id");
            let texts = || {
                item.get("content")
                    .and_then(|c| c.as_array())
                    .map(|c| {
                        c.iter()
                            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default()
            };
            match str_of(item, "type") {
                "UserMessage" => {
                    let text = texts();
                    if text.trim().is_empty() {
                        vec![]
                    } else {
                        vec![user(&at, Value::String(text))]
                    }
                }
                "AgentMessage" => {
                    let text = texts();
                    if text.trim().is_empty() {
                        vec![]
                    } else {
                        vec![assistant(&at, json!([{ "type": "text", "text": text }]))]
                    }
                }
                "CommandExecution" => {
                    let (tool, input) = as_tool(item);
                    let ok = str_of(item, "status") == "completed"
                        && item.get("exit_code").and_then(|c| c.as_i64()).unwrap_or(0) == 0;
                    call(&at, id, tool, input, ok).into()
                }
                "FileChange" => {
                    let ok = !matches!(str_of(item, "status"), "failed" | "declined");
                    item.get("changes")
                        .and_then(|c| c.as_object())
                        .map(|changes| {
                            changes
                                .keys()
                                .enumerate()
                                .flat_map(|(i, path)| {
                                    call(
                                        &at,
                                        &format!("{id}-{i}"),
                                        "Edit",
                                        json!({ "file_path": path }),
                                        ok,
                                    )
                                })
                                .collect()
                        })
                        .unwrap_or_default()
                }
                _ => vec![],
            }
        }
        _ => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(item: Value) -> String {
        json!({ "timestamp": "2026-10-14T01:00:00Z", "type": "event_msg", "payload": { "type": "item_completed", "item": item } })
            .to_string()
    }

    fn kinds(lines: &[String]) -> Vec<(String, String)> {
        lines
            .iter()
            .map(|l| {
                let v: Value = serde_json::from_str(l).unwrap();
                let c = &v["message"]["content"];
                let what = if c.is_string() {
                    "prompt".to_string()
                } else {
                    let b = &c[0];
                    match b["type"].as_str().unwrap() {
                        "tool_use" => format!("{} {}", b["name"].as_str().unwrap(), b["input"]),
                        "tool_result" => format!("result error={}", b["is_error"]),
                        t => t.to_string(),
                    }
                };
                (v["type"].as_str().unwrap().to_string(), what)
            })
            .collect()
    }

    #[test]
    fn prompts_and_replies_become_messages() {
        let prompt = as_claude(&event(
            json!({ "type": "UserMessage", "content": [{ "type": "local_image", "path": "/a.png" }, { "type": "text", "text": "fix it" }] }),
        ));
        let reply = as_claude(&event(
            json!({ "type": "AgentMessage", "content": [{ "type": "Text", "text": "Done." }], "phase": "final_answer" }),
        ));
        assert_eq!(kinds(&prompt), [("user".into(), "prompt".into())]);
        assert_eq!(kinds(&reply), [("assistant".into(), "text".into())]);
    }

    #[test]
    fn a_command_is_a_call_and_its_result() {
        let failed = as_claude(&event(json!({
            "type": "CommandExecution", "id": "e1", "command": ["/bin/zsh", "-lc", "npm test"],
            "parsed_cmd": [{ "type": "unknown", "cmd": "npm test" }], "status": "failed", "exit_code": 1
        })));
        assert_eq!(
            kinds(&failed),
            [
                ("assistant".into(), r#"Bash {"command":"npm test"}"#.into()),
                ("user".into(), "result error=true".into())
            ]
        );
        let read = as_claude(&event(json!({
            "type": "CommandExecution", "id": "e2", "command": ["/bin/zsh", "-lc", "cat src/a.ts"],
            "parsed_cmd": [{ "type": "read", "cmd": "cat src/a.ts", "path": "/r/src/a.ts" }], "status": "completed", "exit_code": 0
        })));
        assert_eq!(kinds(&read)[0].1, r#"Read {"file_path":"/r/src/a.ts"}"#);
        assert_eq!(kinds(&read)[1].1, "result error=false");
    }

    #[test]
    fn a_file_change_is_an_edit_per_file() {
        let lines = as_claude(&event(json!({
            "type": "FileChange", "id": "f1",
            "changes": { "/r/a.ts": { "type": "update" }, "/r/b.ts": { "type": "add" } }
        })));
        let edits: Vec<_> = kinds(&lines)
            .into_iter()
            .filter(|(k, _)| k == "assistant")
            .map(|(_, w)| w)
            .collect();
        assert_eq!(
            edits,
            [
                r#"Edit {"file_path":"/r/a.ts"}"#,
                r#"Edit {"file_path":"/r/b.ts"}"#
            ]
        );
    }

    #[test]
    fn the_rest_of_the_log_is_left_out() {
        assert!(as_claude(
            r#"{"type":"response_item","payload":{"type":"message","role":"user"}}"#
        )
        .is_empty());
        assert!(as_claude(&event(json!({ "type": "Reasoning" }))).is_empty());
    }
}
