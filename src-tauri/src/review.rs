//! The check before "done" (review.ts): the project card's checks run in a
//! finished thread's checkout, then a read-only reviewer CLI (the
//! `reviewCommand` pref) reads the result there, and the checkout's git
//! state is read around both so the app can tell whether either changed it.
//! Running checks and the reviewer are both refused unless `reviewOn` is
//! true, since a review is a model call and the checks can take minutes.

use serde::Serialize;
use serde_json::Value;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::git::git;
use crate::router::{configured, login_path, run, split_command, tail};

/// Matches DEFAULT_REVIEW_COMMAND in review.ts: Claude in plan mode reads
/// the checkout but can't edit files or run commands, and saves no session.
const REVIEW_COMMAND: &str = "claude -p --permission-mode plan --no-session-persistence";
/// A reviewer reads files, so it gets longer than a router call.
const REVIEW_TIMEOUT: Duration = Duration::from_secs(600);
/// One check: a full test suite can take a while, but not forever.
const CHECK_TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// How much of a check's output comes back: its end, where failures show.
const CHECK_OUTPUT: usize = 8000;
/// More than any check's useful output; the rest is drained unread.
const MAX_CHECK_READ: u64 = 4 * 1024 * 1024;
const OFF: &str = "The check before done is off";

fn review_on(app: &AppHandle) -> bool {
    crate::settings::read_desktop_prefs(app.clone())
        .get("reviewOn")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// The reviewer command as words: Err unless reviews are turned on; Claude
/// in plan mode when no command is set.
fn review_words(on: bool, command: Option<&str>) -> Result<Vec<String>, String> {
    if !on {
        return Err(OFF.into());
    }
    split_command(command.unwrap_or(REVIEW_COMMAND))
}

/// The checkout's state as one string: HEAD, the branch, every path's
/// status, a hash of the whole diff against HEAD, and each untracked file's
/// size and modified time. Two equal strings mean nothing was committed,
/// edited, added or removed in between.
fn state(dir: &Path) -> Result<String, String> {
    let head = git(dir, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|_| "-".into());
    let branch = git(dir, &["symbolic-ref", "--quiet", "HEAD"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let status = git(dir, &["status", "--porcelain=v1", "-z", "-uall"])?;
    let mut hasher = DefaultHasher::new();
    let diff = git(
        dir,
        &["diff", "--no-color", "--no-ext-diff", "--binary", "HEAD"],
    )
    .unwrap_or_default();
    diff.hash(&mut hasher);
    for entry in status.split('\0') {
        if let Some(path) = entry.strip_prefix("?? ") {
            if let Ok(meta) = std::fs::metadata(dir.join(path)) {
                path.hash(&mut hasher);
                meta.len().hash(&mut hasher);
                meta.modified().ok().hash(&mut hasher);
            }
        }
    }
    Ok(format!(
        "{head}|{branch}|{:016x}|{}",
        hasher.finish(),
        status.replace('\0', "\n")
    ))
}

/// The checkout's git state before and after a check or a review.
#[tauri::command]
pub async fn review_state(path: PathBuf) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || state(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[derive(Serialize, Debug)]
pub struct CheckResult {
    command: String,
    /// None when it ran out of time or couldn't start.
    code: Option<i32>,
    /// The end of what it printed, stdout and stderr together.
    output: String,
}

fn kill_group(pgid: u32) {
    let _ = Command::new("/bin/kill")
        .args(["-KILL", &format!("-{pgid}")])
        .stderr(Stdio::null())
        .status();
}

/// Run one check line through `sh` in `dir`, in its own process group so a
/// timeout takes everything it started with it.
fn run_check(command: &str, dir: &Path, path: &str, timeout: Duration) -> CheckResult {
    let fail = |output: String| CheckResult {
        command: command.to_string(),
        code: None,
        output,
    };
    let mut child = match Command::new("/bin/sh")
        .arg("-c")
        .arg(format!("exec 2>&1\n{command}"))
        .current_dir(dir)
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .env("CI", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return fail(format!("Couldn't run it: {e}")),
    };
    let pgid = child.id();
    let mut pipe = child.stdout.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = pipe.by_ref().take(MAX_CHECK_READ).read_to_end(&mut buf);
        let _ = std::io::copy(&mut pipe, &mut std::io::sink());
        buf
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if Instant::now() >= deadline => {
                kill_group(pgid);
                let _ = child.wait();
                break None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(100)),
            Err(e) => return fail(e.to_string()),
        }
    };
    // Whatever it left running in its group goes too, so the pipe closes.
    kill_group(pgid);
    let output = String::from_utf8_lossy(&reader.join().unwrap_or_default()).into_owned();
    let mut output = tail(&output, CHECK_OUTPUT);
    match status {
        Some(s) => CheckResult {
            command: command.to_string(),
            code: Some(s.code().unwrap_or(-1)),
            output,
        },
        None => {
            output.push_str(&format!(
                "\n(stopped after {} minutes)",
                timeout.as_secs() / 60
            ));
            fail(output)
        }
    }
}

/// Run the card's checks in the checkout at `path`, one after another.
#[tauri::command]
pub async fn run_checks(
    app: AppHandle,
    path: PathBuf,
    checks: Vec<String>,
) -> Result<Vec<CheckResult>, String> {
    if !review_on(&app) {
        return Err(OFF.into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        checks
            .iter()
            .map(|c| run_check(c, &path, login_path(), CHECK_TIMEOUT))
            .collect()
    })
    .await
    .map_err(|e| e.to_string())
}

/// One reviewer call: the review prompt (review.ts) to the `reviewCommand`
/// CLI, run in the checkout so it can read the files; its reply as text.
#[tauri::command]
pub async fn review_task(app: AppHandle, path: PathBuf, prompt: String) -> Result<String, String> {
    let words = review_words(
        review_on(&app),
        configured(&app, "reviewCommand").as_deref(),
    )?;
    tauri::async_runtime::spawn_blocking(move || {
        run(&words, prompt, &path, login_path(), REVIEW_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("obs-review-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        for args in [
            &["init", "-q"][..],
            &["config", "user.email", "t@t"],
            &["config", "user.name", "t"],
        ] {
            git(&dir, args).unwrap();
        }
        std::fs::write(dir.join("a.txt"), "one\n").unwrap();
        git(&dir, &["add", "."]).unwrap();
        git(&dir, &["commit", "-qm", "first"]).unwrap();
        dir
    }

    #[test]
    fn reviewing_is_off_until_turned_on_then_claude_in_plan_mode() {
        assert_eq!(review_words(false, None).unwrap_err(), OFF);
        assert!(review_words(false, Some("codex exec")).is_err());
        assert_eq!(
            review_words(true, None).unwrap(),
            [
                "claude",
                "-p",
                "--permission-mode",
                "plan",
                "--no-session-persistence"
            ]
        );
        assert_eq!(
            review_words(true, Some("codex exec --sandbox read-only")).unwrap(),
            ["codex", "exec", "--sandbox", "read-only"]
        );
    }

    #[test]
    fn the_state_changes_with_any_edit_commit_or_new_file() {
        let dir = repo("state");
        let a = state(&dir).unwrap();
        assert_eq!(state(&dir).unwrap(), a);

        std::fs::write(dir.join("a.txt"), "two\n").unwrap();
        let b = state(&dir).unwrap();
        assert_ne!(b, a);
        // Edited again: still " M a.txt", but a different diff.
        std::fs::write(dir.join("a.txt"), "three\n").unwrap();
        let c = state(&dir).unwrap();
        assert_ne!(c, b);

        std::fs::write(dir.join("new.txt"), "x").unwrap();
        let d = state(&dir).unwrap();
        assert_ne!(d, c);
        std::fs::write(dir.join("new.txt"), "xy").unwrap();
        assert_ne!(state(&dir).unwrap(), d);

        git(&dir, &["add", "."]).unwrap();
        git(&dir, &["commit", "-qm", "second"]).unwrap();
        let e = state(&dir).unwrap();
        assert_ne!(e, a);
        assert_eq!(state(&dir).unwrap(), e);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn checks_report_their_exit_code_and_output() {
        let dir = repo("checks");
        let ok = run_check("echo fine", &dir, "/bin:/usr/bin", CHECK_TIMEOUT);
        assert_eq!(ok.code, Some(0));
        assert_eq!(ok.output, "fine");
        let bad = run_check(
            "echo broke >&2; exit 3",
            &dir,
            "/bin:/usr/bin",
            CHECK_TIMEOUT,
        );
        assert_eq!(bad.code, Some(3));
        assert_eq!(bad.output, "broke");
        let slow = run_check("sleep 5", &dir, "/bin:/usr/bin", Duration::from_millis(300));
        assert_eq!(slow.code, None);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
