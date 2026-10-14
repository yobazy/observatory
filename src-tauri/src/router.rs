//! Dispatch's router: the to-do list goes to the user's agent CLI in
//! headless mode (`claude -p`, `codex exec`, ...) with the prompt on stdin,
//! and its reply comes back for the webview to read as a plan. Which CLI is
//! the desktop app's `routerCommand` pref. It's split into words and run
//! directly, never through a shell, in an empty folder of its own.

use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub const DEFAULT_COMMAND: &str = "claude -p";
/// Routing a long list on a slow model can take a while, but not forever.
const TIMEOUT: Duration = Duration::from_secs(120);
/// Far more than any plan; the rest of a runaway reply is dropped.
const MAX_OUTPUT: u64 = 1024 * 1024;
/// How much of stderr a failure shows.
const MAX_ERROR: usize = 600;

/// The command line as words: whitespace splits, single and double quotes
/// group, a backslash escapes the next character. Err on an open quote.
pub fn split_command(line: &str) -> Result<Vec<String>, String> {
    let mut words = Vec::new();
    let mut word = String::new();
    let mut in_word = false;
    let mut quote: Option<char> = None;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some('"'), '\\') | (None, '\\') => {
                if let Some(next) = chars.next() {
                    word.push(next);
                }
                in_word = true;
            }
            (Some(_), c) => word.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                in_word = true;
            }
            (None, c) if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut word));
                    in_word = false;
                }
            }
            (None, c) => {
                word.push(c);
                in_word = true;
            }
        }
    }
    if quote.is_some() {
        return Err("The router command has an unclosed quote".into());
    }
    if in_word {
        words.push(word);
    }
    Ok(words)
}

/// The PATH a login shell sets up: an app opened from Finder has almost
/// none, and agent CLIs (node scripts, often) need it to find what they run.
/// Read once; the app's own PATH when the shell can't be asked.
fn login_path() -> &'static str {
    static PATH: OnceLock<String> = OnceLock::new();
    PATH.get_or_init(|| {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
        Command::new(shell)
            .args(["-l", "-c", "printf %s \"$PATH\""])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default())
    })
}

/// `program` as a file to run: a path as given, else the first match on `path`.
fn resolve(program: &str, path: &str) -> Option<PathBuf> {
    if program.contains('/') {
        let p = PathBuf::from(program);
        return p.is_file().then_some(p);
    }
    std::env::split_paths(path)
        .map(|dir| dir.join(program))
        .find(|p| p.is_file())
}

/// The router command from desktop.json, or the default.
fn configured(app: &AppHandle) -> String {
    crate::settings::read_desktop_prefs(app.clone())
        .get("routerCommand")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or(DEFAULT_COMMAND)
        .to_string()
}

/// An empty folder to run in, so the CLI picks up no project's notes.
fn neutral_dir() -> PathBuf {
    let dir = std::env::temp_dir().join("observatory-router");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn tail(text: &str, max: usize) -> String {
    let text = text.trim();
    let start = text.len().saturating_sub(max);
    let start = (start..=text.len())
        .find(|&i| text.is_char_boundary(i))
        .unwrap_or(0);
    let cut = &text[start..];
    if start > 0 {
        format!("…{cut}")
    } else {
        cut.to_string()
    }
}

/// Run `words` with `input` on stdin in `cwd`: stdout, or a readable error.
fn run(
    words: &[String],
    input: String,
    cwd: &Path,
    path: &str,
    timeout: Duration,
) -> Result<String, String> {
    let (program, args) = words.split_first().ok_or("The router command is empty")?;
    let bin = resolve(program, path).ok_or_else(|| {
        format!("Couldn't find {program}. Install it, or set the router command in Settings to one that's installed.")
    })?;
    let mut child = Command::new(&bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", path)
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't run {program}: {e}"))?;
    let mut stdin = child.stdin.take().expect("piped");
    std::thread::spawn(move || {
        let _ = stdin.write_all(input.as_bytes());
    });
    // Read up to the cap, then keep draining so the child never blocks on a full pipe.
    let drain = |pipe: Box<dyn Read + Send>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            let mut pipe = pipe;
            let _ = pipe.by_ref().take(MAX_OUTPUT).read_to_end(&mut buf);
            let _ = std::io::copy(&mut pipe, &mut std::io::sink());
            buf
        })
    };
    let out = drain(Box::new(child.stdout.take().expect("piped")));
    let err = drain(Box::new(child.stderr.take().expect("piped")));
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{program} took longer than {}s to route the list",
                    timeout.as_secs()
                ));
            }
            None => std::thread::sleep(Duration::from_millis(100)),
        }
    };
    let stdout = String::from_utf8_lossy(&out.join().unwrap_or_default()).into_owned();
    if !status.success() {
        let stderr = String::from_utf8_lossy(&err.join().unwrap_or_default()).into_owned();
        let why = if stderr.trim().is_empty() {
            &stdout
        } else {
            &stderr
        };
        let why = tail(why, MAX_ERROR);
        let code = status
            .code()
            .map_or_else(|| "was stopped".to_string(), |c| format!("exited with {c}"));
        return Err(if why.is_empty() {
            format!("{program} {code}")
        } else {
            format!("{program} {code}: {why}")
        });
    }
    if stdout.trim().is_empty() {
        return Err(format!("{program} replied with nothing"));
    }
    Ok(stdout)
}

/// Route a to-do list: the router prompt (router.ts) to the configured CLI,
/// its reply back as text.
#[tauri::command]
pub async fn route_list(app: AppHandle, prompt: String) -> Result<String, String> {
    let words = split_command(&configured(&app))?;
    tauri::async_runtime::spawn_blocking(move || {
        run(&words, prompt, &neutral_dir(), login_path(), TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(s: &str) -> Vec<String> {
        split_command(s).unwrap()
    }

    #[test]
    fn splits_commands_without_a_shell() {
        assert_eq!(words("claude -p"), ["claude", "-p"]);
        assert_eq!(
            words("  codex   exec --skip-git-repo-check "),
            ["codex", "exec", "--skip-git-repo-check"]
        );
        assert_eq!(
            words(r#"claude -p --tools "" --model 'claude haiku'"#),
            ["claude", "-p", "--tools", "", "--model", "claude haiku"]
        );
        assert_eq!(words(r"a\ b c"), ["a b", "c"]);
        assert_eq!(words("echo $HOME; rm"), ["echo", "$HOME;", "rm"]);
        assert!(split_command("claude \"-p").is_err());
        assert!(words("   ").is_empty());
    }

    #[test]
    fn finds_programs_on_the_given_path() {
        assert_eq!(
            resolve("sh", "/nowhere:/bin"),
            Some(PathBuf::from("/bin/sh"))
        );
        assert_eq!(resolve("/bin/sh", ""), Some(PathBuf::from("/bin/sh")));
        assert_eq!(resolve("no-such-router-cli", "/bin:/usr/bin"), None);
    }

    fn sh(script: &str) -> Vec<String> {
        vec!["sh".into(), "-c".into(), script.into()]
    }

    #[test]
    fn returns_stdout_with_the_prompt_on_stdin() {
        let out = run(
            &sh("cat"),
            "{\"tasks\":[]}".into(),
            &neutral_dir(),
            "/bin:/usr/bin",
            TIMEOUT,
        );
        assert_eq!(out.unwrap(), "{\"tasks\":[]}");
    }

    #[test]
    fn reports_failures_readably() {
        let path = "/bin:/usr/bin";
        let err = run(
            &sh("echo nope >&2; exit 3"),
            String::new(),
            &neutral_dir(),
            path,
            TIMEOUT,
        )
        .unwrap_err();
        assert_eq!(err, "sh exited with 3: nope");
        let err = run(&sh("true"), String::new(), &neutral_dir(), path, TIMEOUT).unwrap_err();
        assert_eq!(err, "sh replied with nothing");
        let err = run(
            &["no-such-router-cli".into()],
            String::new(),
            &neutral_dir(),
            path,
            TIMEOUT,
        )
        .unwrap_err();
        assert!(err.starts_with("Couldn't find no-such-router-cli"), "{err}");
        let err = run(
            &sh("sleep 5"),
            String::new(),
            &neutral_dir(),
            path,
            Duration::from_millis(300),
        )
        .unwrap_err();
        assert!(err.contains("took longer"), "{err}");
    }

    #[test]
    fn caps_the_output() {
        let out = run(
            &sh("head -c 3000000 /dev/zero"),
            String::new(),
            &neutral_dir(),
            "/bin:/usr/bin",
            TIMEOUT,
        )
        .unwrap();
        assert_eq!(out.len() as u64, MAX_OUTPUT);
    }

    /// One real call of the default router: `cargo test -- --ignored router_smoke`.
    #[test]
    #[ignore]
    fn router_smoke() {
        let words = split_command(DEFAULT_COMMAND).unwrap();
        let out = run(
            &words,
            "Reply with this JSON only: {\"tasks\":[]}".into(),
            &neutral_dir(),
            login_path(),
            TIMEOUT,
        );
        let out = out.unwrap();
        assert!(out.contains("tasks"), "{out}");
    }
}
