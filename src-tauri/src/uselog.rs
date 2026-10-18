//! The usage log (uselog.ts): one JSON line per thing you did in the app,
//! appended to `usage-log.jsonl` in the app's data directory. It's off
//! unless turned on in Settings, and nothing in it leaves this Mac.

use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const FILE: &str = "usage-log.jsonl";
/// Past this the log moves aside to `usage-log.1.jsonl`, replacing the one
/// there, so it never holds more than about twice this.
const ROTATE_AT: u64 = 20 * 1024 * 1024;

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join(FILE))
        .map_err(|e| e.to_string())
}

fn rotated(path: &std::path::Path) -> PathBuf {
    path.with_extension("1.jsonl")
}

/// Append `events` to `path`, one compact line each.
fn append(path: &std::path::Path, events: &[Value]) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    if fs::metadata(path).is_ok_and(|m| m.len() > ROTATE_AT) {
        fs::rename(path, rotated(path))?;
    }
    let mut out = String::new();
    for e in events {
        out.push_str(&e.to_string());
        out.push('\n');
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?
        .write_all(out.as_bytes())
}

#[tauri::command]
pub fn append_use_log(app: AppHandle, events: Vec<Value>) -> Result<(), String> {
    append(&log_path(&app)?, &events).map_err(|e| e.to_string())
}

/// Where the log is, for Show in Finder; it may not exist yet.
#[tauri::command]
pub fn use_log_path(app: AppHandle) -> Result<PathBuf, String> {
    log_path(&app)
}

/// Delete the log and the one rotated out before it.
#[tauri::command]
pub fn clear_use_log(app: AppHandle) -> Result<(), String> {
    let path = log_path(&app)?;
    for p in [rotated(&path), path] {
        match fs::remove_file(&p) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e.to_string()),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn appends_one_line_per_event() {
        let dir = std::env::temp_dir().join(format!("uselog-{}", std::process::id()));
        let path = dir.join(FILE);
        let _ = fs::remove_dir_all(&dir);
        append(&path, &[json!({"e": "a"}), json!({"e": "b"})]).unwrap();
        append(&path, &[json!({"e": "c"})]).unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert_eq!(text, "{\"e\":\"a\"}\n{\"e\":\"b\"}\n{\"e\":\"c\"}\n");
        assert_eq!(rotated(&path), dir.join("usage-log.1.jsonl"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
