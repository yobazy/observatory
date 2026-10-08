//! Following a project to a new folder, after it was renamed or moved on
//! disk. The daemon re-points its own rows (`SetProjectPath`); what lives
//! outside it, keyed by the old path, is carried here: the project's entry
//! in nebula's settings, and Claude Code's history, whose folder name is the
//! session's working directory. The webview carries its own prefs.

use nebula_core::paths;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Which of `paths` are no longer folders on disk: projects whose repo was
/// renamed, moved or deleted.
#[tauri::command]
pub fn missing_dirs(paths: Vec<String>) -> Vec<String> {
    paths.into_iter().filter(|p| !Path::new(p).is_dir()).collect()
}

#[derive(Serialize)]
pub struct Carried {
    /// The project had an entry in nebula's settings, now under its new path.
    settings: bool,
    /// Claude Code history folders moved to the new paths.
    histories: usize,
}

/// Carry what's keyed by a project's old paths over to the new ones: its
/// settings entry (`repo` is the old and new repo path), and each checkout's
/// Claude Code history (`moves`, old and new checkout paths).
#[tauri::command]
pub fn carry_project_state(repo: (String, String), moves: Vec<(String, String)>) -> Result<Carried, String> {
    let settings = rekey_project_settings(&repo.0, &repo.1)?;
    let mut histories = 0;
    if let Some(root) = paths::claude_config_dir().map(|d| d.join("projects")) {
        for (old, new) in &moves {
            if move_history(&root, old, new).map_err(|e| format!("Couldn't move Claude's history for {old}: {e}"))? {
                histories += 1;
            }
        }
    }
    Ok(Carried { settings, histories })
}

/// Move the `projects` entry for `old` to `new`, as the TUI's Project tab
/// keys it. A field the new path already has wins over the old one's.
fn rekey_project_settings(old: &str, new: &str) -> Result<bool, String> {
    let merged = crate::daemon::read_settings();
    let mut projects = merged
        .get("projects")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let Some(Value::Object(moved)) = projects.remove(old) else {
        return Ok(false);
    };
    let mut entry = moved;
    if let Some(Value::Object(kept)) = projects.remove(new) {
        entry.extend(kept);
    }
    projects.insert(new.to_string(), Value::Object(entry));
    crate::settings::write_setting("projects".into(), Value::Object(projects))?;
    Ok(true)
}

/// Claude Code's folder for a working directory: every character but a
/// letter or digit becomes `-` (`/Users/me/.x/a_b` → `-Users-me--x-a-b`).
fn history_dir_name(path: &str) -> String {
    path.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Move the history for `old` under `root` to `new`'s folder. When `new`
/// already has one (Claude ran there since the move), the old files join it
/// and none is overwritten. False when there was nothing to move.
fn move_history(root: &Path, old: &str, new: &str) -> std::io::Result<bool> {
    let from = root.join(history_dir_name(old));
    let to = root.join(history_dir_name(new));
    if from == to || !from.is_dir() {
        return Ok(false);
    }
    if !to.exists() {
        std::fs::rename(&from, &to)?;
        return Ok(true);
    }
    for entry in std::fs::read_dir(&from)? {
        let entry = entry?;
        let target: PathBuf = to.join(entry.file_name());
        if !target.exists() {
            std::fs::rename(entry.path(), target)?;
        }
    }
    // Left behind only when both folders held a file of the same name.
    let _ = std::fs::remove_dir(&from);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn history_dir_names_match_claude_codes() {
        assert_eq!(
            history_dir_name("/Users/bazil/Documents/Programming/nebula-desktop"),
            "-Users-bazil-Documents-Programming-nebula-desktop"
        );
        assert_eq!(
            history_dir_name("/Users/bazil/.pencil/documents/festify-2.0"),
            "-Users-bazil--pencil-documents-festify-2-0"
        );
    }

    #[test]
    fn history_moves_and_merges_without_overwriting() {
        let root = std::env::temp_dir().join(format!("observatory-history-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let old = root.join(history_dir_name("/code/acme"));
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("a.jsonl"), "old a").unwrap();

        assert!(move_history(&root, "/code/acme", "/code/acme-web").unwrap());
        let new = root.join(history_dir_name("/code/acme-web"));
        assert_eq!(std::fs::read_to_string(new.join("a.jsonl")).unwrap(), "old a");
        assert!(!old.exists());
        assert!(!move_history(&root, "/code/acme", "/code/acme-web").unwrap(), "nothing left to move");

        // Claude already ran in the new folder: the old files join it.
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("a.jsonl"), "older a").unwrap();
        std::fs::write(old.join("b.jsonl"), "old b").unwrap();
        assert!(move_history(&root, "/code/acme", "/code/acme-web").unwrap());
        assert_eq!(std::fs::read_to_string(new.join("a.jsonl")).unwrap(), "old a", "not overwritten");
        assert_eq!(std::fs::read_to_string(new.join("b.jsonl")).unwrap(), "old b");
        assert!(old.join("a.jsonl").exists(), "the clash stays where it was");

        std::fs::remove_dir_all(&root).unwrap();
    }
}
