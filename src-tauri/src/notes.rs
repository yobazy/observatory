//! Save to notes (Reader.tsx): a reply kept as a Markdown file in the folder
//! picked in Settings, such as an Obsidian vault. The folder comes from the
//! app's own prefs, not from the page, so a reply can only ever be written
//! there, under a name of its own that never replaces another file.

use std::fs::OpenOptions;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// A file name from a reply's headline: no path separators or characters
/// that trouble Finder or Obsidian, not hidden, and kept short.
fn file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "/\\:*?\"<>|#^[]".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let words = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = words.trim_start_matches(['.', ' ']).trim();
    let short: String = trimmed.chars().take(80).collect();
    if short.trim().is_empty() {
        "Reply".into()
    } else {
        short.trim().to_string()
    }
}

/// Write `text` to `<dir>/<stem>.md`, or `<stem> 2.md` and so on when that's
/// taken. Returns where it went.
fn write_new(dir: &Path, stem: &str, text: &str) -> Result<PathBuf, String> {
    for i in 1..1000 {
        let path = dir.join(if i == 1 {
            format!("{stem}.md")
        } else {
            format!("{stem} {i}.md")
        });
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut f) => {
                f.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
                return Ok(path);
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("too many notes with that name".into())
}

#[tauri::command]
pub fn save_note(app: AppHandle, name: String, text: String) -> Result<PathBuf, String> {
    let prefs = crate::settings::read_desktop_prefs(app);
    let dir = prefs
        .get("notesFolder")
        .and_then(|d| d.as_str())
        .filter(|d| !d.trim().is_empty())
        .ok_or("Pick a notes folder in Settings first")?;
    let dir = PathBuf::from(dir);
    if !dir.is_dir() {
        return Err(format!("{} isn't a folder", dir.display()));
    }
    write_new(&dir, &file_stem(&name), &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_headline_makes_a_safe_short_file_name() {
        assert_eq!(
            file_stem("Fix: the cart/sync race #75"),
            "Fix the cart sync race 75"
        );
        assert_eq!(file_stem("../../etc/passwd"), "etc passwd");
        assert_eq!(file_stem("   "), "Reply");
        assert_eq!(file_stem(&"a".repeat(200)).len(), 80);
    }

    #[test]
    fn a_new_note_never_replaces_one_already_there() {
        let dir = std::env::temp_dir().join(format!("observatory-notes-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let first = write_new(&dir, "Note", "one").unwrap();
        let second = write_new(&dir, "Note", "two").unwrap();
        assert_eq!(first.file_name().unwrap(), "Note.md");
        assert_eq!(second.file_name().unwrap(), "Note 2.md");
        assert_eq!(std::fs::read_to_string(&first).unwrap(), "one");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
