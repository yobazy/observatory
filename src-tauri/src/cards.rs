//! What a project card is drafted from: the notes a project keeps for its
//! agents (CLAUDE.md, AGENTS.md, skills) and its README. Read-only, from the
//! project's root only, each file cut short past a size cap; the webview
//! does the drafting.

use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// More than any useful excerpt needs; a huge README is read only this far.
const MAX_BYTES: u64 = 64 * 1024;
/// A project with more skills than this is listed in part.
const MAX_SKILLS: usize = 100;

#[derive(Serialize)]
pub struct SourceFile {
    /// Relative to the project root, e.g. `.claude/skills/apply/SKILL.md`.
    path: String,
    text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardSources {
    files: Vec<SourceFile>,
    /// A `.git` in the folder or above it: tasks can get worktrees.
    is_git_repo: bool,
}

fn read_capped(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    if !file.metadata().ok()?.is_file() {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn sources(root: &Path) -> CardSources {
    let mut files = Vec::new();
    let mut push = |rel: String| {
        if let Some(text) = read_capped(&root.join(&rel)) {
            files.push(SourceFile { path: rel, text });
        }
    };
    push("CLAUDE.md".into());
    push("AGENTS.md".into());

    let mut readmes: Vec<String> = std::fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.to_ascii_uppercase().starts_with("README"))
        .collect();
    readmes.sort();
    readmes.into_iter().take(3).for_each(&mut push);

    let mut skills: Vec<String> = std::fs::read_dir(root.join(".claude/skills"))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    skills.sort();
    skills
        .into_iter()
        .take(MAX_SKILLS)
        .for_each(|s| push(format!(".claude/skills/{s}/SKILL.md")));

    let is_git_repo = root.ancestors().any(|d| d.join(".git").exists());
    CardSources { files, is_git_repo }
}

/// The files a card is drafted from, in the folder at `path`.
#[tauri::command]
pub async fn read_card_sources(path: PathBuf) -> Result<CardSources, String> {
    let root = std::fs::canonicalize(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !root.is_dir() {
        return Err(format!("{} isn't a folder", root.display()));
    }
    tauri::async_runtime::spawn_blocking(move || sources(&root))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_notes_readme_and_skills() {
        let dir = std::env::temp_dir().join(format!("nebula-card-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".claude/skills/apply")).unwrap();
        std::fs::create_dir_all(dir.join(".claude/skills/empty")).unwrap();
        std::fs::write(dir.join("CLAUDE.md"), "# Notes\n\nJob search.\n").unwrap();
        std::fs::write(dir.join("README.md"), "Readme").unwrap();
        std::fs::write(
            dir.join(".claude/skills/apply/SKILL.md"),
            "---\ndescription: Apply\n---\n",
        )
        .unwrap();
        let big = "x".repeat(MAX_BYTES as usize + 10);
        std::fs::write(dir.join("AGENTS.md"), &big).unwrap();

        let s = sources(&dir);
        let paths: Vec<_> = s.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(
            paths,
            [
                "CLAUDE.md",
                "AGENTS.md",
                "README.md",
                ".claude/skills/apply/SKILL.md"
            ]
        );
        assert_eq!(s.files[1].text.len(), MAX_BYTES as usize);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
