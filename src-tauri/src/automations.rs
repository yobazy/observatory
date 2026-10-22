//! Background jobs on this Mac: every plist in `~/Library/LaunchAgents`
//! (through `plutil -convert json`), what `launchctl print gui/<uid>/<label>`
//! says about it, and the tail of its logs. Which jobs show, their schedule
//! and their health are worked out in the webview (`automations.ts`). The
//! only things run here are `launchctl kickstart` for a job that has a plist
//! there, and a job's own status command from automations.json, without a
//! shell and with a time limit.

use serde::Serialize;
use serde_json::Value;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant, UNIX_EPOCH};

/// How long a job's status command may run.
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);
pub const STATUS_TIMED_OUT: &str = "Status command timed out";

/// Log lines sent per job.
const TAIL_LINES: usize = 20;
/// How far back from a log's end to look for those lines.
const TAIL_BYTES: u64 = 64 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawJob {
    label: String,
    plist_path: String,
    plist: Value,
    launchctl: String,
    /// Unix ms: the newer mtime of the job's stdout and stderr logs.
    last_write: Option<i64>,
    tail: Vec<String>,
}

#[derive(Serialize)]
pub struct AutomationsReport {
    jobs: Vec<RawJob>,
    /// `~/.config/observatory/automations.json`, unparsed; None when absent.
    config: Option<String>,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").unwrap_or_default())
}

/// A plist as JSON, without its EnvironmentVariables: they can hold tokens,
/// and nothing in the view needs them.
fn read_plist(path: &Path) -> Result<Value, String> {
    let out = Command::new("/usr/bin/plutil")
        .args(["-convert", "json", "-o", "-"])
        .arg(path)
        .output()
        .map_err(|e| format!("couldn't run plutil: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    if let Some(map) = v.as_object_mut() {
        map.remove("EnvironmentVariables");
    }
    Ok(v)
}

fn uid() -> &'static str {
    static UID: OnceLock<String> = OnceLock::new();
    UID.get_or_init(|| {
        Command::new("/usr/bin/id")
            .arg("-u")
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    })
}

/// `launchctl print`'s own fields (state, pid, runs, last exit code), not
/// its nested blocks: those hold the job's environment. An error such as
/// "Could not find service" passes through as it is.
fn top_level(text: &str) -> String {
    if !text
        .lines()
        .next()
        .is_some_and(|l| l.trim_end().ends_with('{'))
    {
        return text.trim().to_string();
    }
    let mut depth = 0usize;
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim();
        if t.ends_with('{') {
            if depth == 0 {
                out.push(t.to_string());
            }
            depth += 1;
        } else if t == "}" {
            depth = depth.saturating_sub(1);
            if depth == 0 {
                out.push("}".to_string());
            }
        } else if depth == 1 && !t.is_empty() {
            out.push(format!("\t{t}"));
        }
    }
    out.join("\n")
}

fn launchctl(label: &str) -> String {
    match Command::new("/bin/launchctl")
        .arg("print")
        .arg(format!("gui/{}/{label}", uid()))
        .output()
    {
        Ok(o) => {
            let mut text = String::from_utf8_lossy(&o.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&o.stderr));
            top_level(&text)
        }
        Err(e) => format!("couldn't run launchctl: {e}"),
    }
}

fn mtime_ms(path: &Path) -> Option<i64> {
    let m = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(m.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

/// The last `n` lines of a file, read from its end.
fn last_lines(path: &Path, n: usize) -> Vec<String> {
    let Ok(mut f) = File::open(path) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let from = len.saturating_sub(TAIL_BYTES);
    if f.seek(SeekFrom::Start(from)).is_err() {
        return Vec::new();
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    // Started mid-file: the first line is likely cut.
    if from > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let skip = lines.len().saturating_sub(n);
    lines[skip..].iter().map(|l| l.to_string()).collect()
}

/// When the logs were last written, and their last lines: each log's tail,
/// the older log first, kept to `TAIL_LINES` in all.
fn logs(paths: &[String]) -> (Option<i64>, Vec<String>) {
    let mut found: Vec<(i64, &String)> = Vec::new();
    for p in paths {
        if found.iter().any(|(_, q)| *q == p) {
            continue;
        }
        if let Some(t) = mtime_ms(Path::new(p)) {
            found.push((t, p));
        }
    }
    found.sort();
    let last = found.last().map(|(t, _)| *t);
    let mut tail: Vec<String> = found
        .iter()
        .flat_map(|(_, p)| last_lines(Path::new(p), TAIL_LINES))
        .collect();
    let skip = tail.len().saturating_sub(TAIL_LINES);
    tail.drain(..skip);
    (last, tail)
}

fn job(path: &Path) -> Option<RawJob> {
    let plist = read_plist(path).ok()?;
    let label = plist
        .get("Label")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| Some(path.file_stem()?.to_string_lossy().into_owned()))?;
    let paths: Vec<String> = ["StandardOutPath", "StandardErrorPath"]
        .iter()
        .filter_map(|k| plist.get(*k).and_then(Value::as_str).map(str::to_string))
        .collect();
    let (last_write, tail) = logs(&paths);
    Some(RawJob {
        launchctl: launchctl(&label),
        label,
        plist_path: path.to_string_lossy().into_owned(),
        plist,
        last_write,
        tail,
    })
}

fn scan(dir: &Path) -> Vec<RawJob> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut paths: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "plist"))
        .collect();
    paths.sort();
    paths.iter().filter_map(|p| job(p)).collect()
}

/// Every launchd agent of this user's, with what launchd and its logs say.
#[tauri::command]
pub async fn automations_report() -> Result<AutomationsReport, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = home();
        AutomationsReport {
            jobs: scan(&home.join("Library/LaunchAgents")),
            config: std::fs::read_to_string(config_path()).ok(),
        }
    })
    .await
    .map_err(|e| e.to_string())
}

fn config_path() -> PathBuf {
    home().join(".config/observatory/automations.json")
}

/// Whether `label` is one of the plists in `dir`: kickstart only ever goes
/// to a job the view lists, never to a label the webview made up.
fn has_plist(dir: &Path, label: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|e| {
        let p = e.path();
        p.extension().is_some_and(|x| x == "plist")
            && read_plist(&p)
                .ok()
                .and_then(|v| v.get("Label").and_then(Value::as_str).map(|l| l == label))
                .unwrap_or_else(|| p.file_stem().is_some_and(|s| s == label))
    })
}

/// `launchctl kickstart`'s arguments: `-k` kills a running instance first.
fn kickstart_args(uid: &str, label: &str, restart: bool) -> Vec<String> {
    let mut args = vec!["kickstart".to_string()];
    if restart {
        args.push("-k".into());
    }
    args.push(format!("gui/{uid}/{label}"));
    args
}

fn kickstart(dir: &Path, label: &str, restart: bool) -> Result<(), String> {
    if !has_plist(dir, label) {
        return Err(format!("{label} has no plist in {}", dir.display()));
    }
    let out = Command::new("/bin/launchctl")
        .args(kickstart_args(uid(), label, restart))
        .output()
        .map_err(|e| format!("couldn't run launchctl: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        let msg = err.trim();
        Err(if msg.is_empty() {
            format!("launchctl kickstart exited with {}", out.status)
        } else {
            msg.to_string()
        })
    }
}

/// Run a job now: `launchctl kickstart`, with `-k` (restart) for an
/// always-on job.
#[tauri::command]
pub async fn automations_kickstart(label: String, restart: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        kickstart(&home().join("Library/LaunchAgents"), &label, restart)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A job's `statusCommand` from automations.json: a list of arguments, or
/// a string split on spaces (no shell, so no quoting or pipes).
fn status_argv(config: &str, label: &str) -> Option<Vec<String>> {
    let v: Value = serde_json::from_str(config).ok()?;
    let list = v.get("jobs").unwrap_or(&v).as_array()?;
    let entry = list
        .iter()
        .find(|e| e.get("label").and_then(Value::as_str) == Some(label))?;
    let argv: Vec<String> = match entry.get("statusCommand")? {
        Value::String(s) => s.split_whitespace().map(String::from).collect(),
        Value::Array(a) => a
            .iter()
            .filter_map(|x| x.as_str().map(String::from))
            .collect(),
        _ => return None,
    };
    (!argv.is_empty()).then_some(argv)
}

/// A program by name, the way a login shell would find it: an app opened
/// from Finder has almost no PATH of its own.
fn resolve(program: &str) -> PathBuf {
    if let Some(rest) = program.strip_prefix("~/") {
        return home().join(rest);
    }
    if program.contains('/') {
        return PathBuf::from(program);
    }
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    dirs.extend([
        home().join(".local/bin"),
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    dirs.into_iter()
        .map(|d| d.join(program))
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(program))
}

/// Run `argv` without a shell; its output (stdout, then stderr), or
/// `STATUS_TIMED_OUT` once it has run for `timeout`, when it's killed.
fn run_status(argv: &[String], timeout: Duration) -> Result<String, String> {
    let (program, args) = argv.split_first().ok_or("empty status command")?;
    let mut child = Command::new(resolve(program))
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("couldn't run {program}: {e}"))?;
    // Read both pipes as the command writes, so a chatty one can't block on a
    // full pipe; a reader left behind by a grandchild just ends with it.
    let read = |pipe: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(mut p) = pipe {
                let _ = p.read_to_end(&mut buf);
            }
            String::from_utf8_lossy(&buf).into_owned()
        })
    };
    let out = read(
        child
            .stdout
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let err = read(
        child
            .stderr
            .take()
            .map(|p| Box::new(p) as Box<dyn Read + Send>),
    );
    let start = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => break status,
            None if start.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(STATUS_TIMED_OUT.into());
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    };
    let mut text = out.join().unwrap_or_default();
    text.push_str(&err.join().unwrap_or_default());
    let mut text = text.trim_end().to_string();
    if !status.success() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&format!("Exited with {status}"));
    }
    Ok(text)
}

/// The output of a job's status command, run now.
#[tauri::command]
pub async fn automations_status(label: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config =
            std::fs::read_to_string(config_path()).map_err(|e| format!("automations.json: {e}"))?;
        let argv =
            status_argv(&config, &label).ok_or_else(|| format!("{label} has no statusCommand"))?;
        run_status(&argv, STATUS_TIMEOUT)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/automations")
            .join(name)
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "observatory-automations-{}-{name}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn plist_reads_as_json_without_its_environment() {
        let v = read_plist(&fixture("com.bazil.todos-notion.plist")).unwrap();
        assert_eq!(v["Label"], "com.bazil.todos-notion");
        assert_eq!(v["StartInterval"], 300);
        assert_eq!(v["WatchPaths"].as_array().unwrap().len(), 3);
        assert!(v.get("EnvironmentVariables").is_none());
    }

    #[test]
    fn launchctl_keeps_its_own_fields_not_the_environment() {
        let text = std::fs::read_to_string(fixture("launchctl-wispr-watch.txt")).unwrap();
        let out = top_level(&text);
        assert!(out.starts_with("gui/501/com.bazil.wispr-watch = {"));
        assert!(out.contains("\tlast exit code = 0"));
        assert!(out.contains("\truns = 77"));
        assert!(!out.contains("XPC_SERVICE_NAME"));
        assert!(!out.contains("PATH =>"));
        assert!(!out.contains("/Users/x/.local/bin/wispr-watch\n"));
    }

    #[test]
    fn launchctl_error_passes_through() {
        let text = std::fs::read_to_string(fixture("launchctl-missing.txt")).unwrap();
        assert!(top_level(&text).contains("Could not find service \"com.bazil.todos-notion\""));
    }

    #[test]
    fn tail_is_the_last_lines_older_log_first() {
        let dir = scratch("tail");
        let out = dir.join("job.out");
        let err = dir.join("job.err");
        let mut f = File::create(&out).unwrap();
        for i in 0..30 {
            writeln!(f, "out {i}").unwrap();
        }
        drop(f);
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&err, "err 0\nerr 1\n").unwrap();
        let paths = [
            out.to_string_lossy().into_owned(),
            err.to_string_lossy().into_owned(),
        ];
        let (last, tail) = logs(&paths);
        assert_eq!(last, mtime_ms(&err));
        assert_eq!(tail.len(), TAIL_LINES);
        assert_eq!(tail.first().unwrap(), "out 12");
        assert_eq!(&tail[tail.len() - 2..], ["err 0", "err 1"]);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn one_log_for_both_streams_is_read_once() {
        let dir = scratch("same");
        let log = dir.join("job.log");
        std::fs::copy(fixture("todos-notion.log.txt"), &log).unwrap();
        let p = log.to_string_lossy().into_owned();
        let (last, tail) = logs(&[p.clone(), p]);
        assert!(last.is_some());
        assert_eq!(tail.len(), 9);
        assert!(tail.last().unwrap().starts_with("PermissionError"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_logs_mean_no_last_run() {
        let (last, tail) = logs(&["/nonexistent/observatory.log".to_string()]);
        assert_eq!(last, None);
        assert!(tail.is_empty());
    }

    #[test]
    fn scan_lists_each_plist_with_its_label() {
        let jobs = scan(&fixture(""));
        let labels: Vec<&str> = jobs.iter().map(|j| j.label.as_str()).collect();
        assert_eq!(
            labels,
            [
                "ai.hermes.gateway",
                "com.bazil.career-ops.mailwatch",
                "com.bazil.todos-notion",
                "com.bazil.wispr-watch"
            ]
        );
    }

    #[test]
    fn kickstart_restarts_only_when_asked() {
        assert_eq!(
            kickstart_args("501", "com.x.job", false),
            ["kickstart", "gui/501/com.x.job"]
        );
        assert_eq!(
            kickstart_args("501", "com.x.job", true),
            ["kickstart", "-k", "gui/501/com.x.job"]
        );
    }

    #[test]
    fn kickstart_refuses_a_label_without_a_plist() {
        let dir = fixture("");
        assert!(has_plist(&dir, "com.bazil.wispr-watch"));
        assert!(!has_plist(&dir, "com.apple.Finder"));
        let err = kickstart(&dir, "com.example.not-here", false).unwrap_err();
        assert!(err.contains("has no plist"));
    }

    #[test]
    fn status_command_comes_from_the_config() {
        let config = r#"{"jobs": [
            {"label": "com.x.a", "name": "A", "statusCommand": "wispr-watch --status"},
            {"label": "com.x.b", "statusCommand": ["/bin/echo", "two words"]},
            {"label": "com.x.c"}
        ]}"#;
        assert_eq!(
            status_argv(config, "com.x.a").unwrap(),
            ["wispr-watch", "--status"]
        );
        assert_eq!(
            status_argv(config, "com.x.b").unwrap(),
            ["/bin/echo", "two words"]
        );
        assert_eq!(status_argv(config, "com.x.c"), None);
        assert_eq!(status_argv(config, "com.x.z"), None);
    }

    #[test]
    fn status_command_output_is_its_lines() {
        let argv = [
            "/usr/bin/printf".to_string(),
            "one\\ntwo\\nthree\\n".to_string(),
        ];
        assert_eq!(
            run_status(&argv, STATUS_TIMEOUT).unwrap(),
            "one\ntwo\nthree"
        );
        // No shell: a pipe is just an argument.
        let echo = [
            "/bin/echo".to_string(),
            "a|b".to_string(),
            "$HOME".to_string(),
        ];
        assert_eq!(run_status(&echo, STATUS_TIMEOUT).unwrap(), "a|b $HOME");
    }

    #[test]
    fn status_command_past_its_time_is_killed() {
        let argv = ["/bin/sleep".to_string(), "30".to_string()];
        let start = Instant::now();
        let err = run_status(&argv, Duration::from_millis(300)).unwrap_err();
        assert_eq!(err, STATUS_TIMED_OUT);
        assert!(start.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn status_command_failure_says_how_it_exited() {
        let argv = [
            "/bin/sh".to_string(),
            "-c".to_string(),
            "echo nope; exit 3".to_string(),
        ];
        let out = run_status(&argv, STATUS_TIMEOUT).unwrap();
        assert!(out.starts_with("nope\nExited with"), "{out}");
    }

    /// Manual check for S12 against the throwaway sandbox job only (install
    /// it with `scripts/sandbox.sh automations`): Run now's code path writes
    /// a new line to its log within 5 s.
    /// `cargo test -- --ignored sandbox_job_runs_now`
    #[test]
    #[ignore]
    fn sandbox_job_runs_now() {
        const LABEL: &str = "com.observatory.sandbox-job";
        let dir = home().join("Library/LaunchAgents");
        let plist = read_plist(&dir.join(format!("{LABEL}.plist")))
            .expect("run scripts/sandbox.sh automations first");
        let log = PathBuf::from(plist["StandardOutPath"].as_str().unwrap());
        let lines = |p: &Path| {
            std::fs::read_to_string(p)
                .map(|t| t.lines().count())
                .unwrap_or(0)
        };
        let before = lines(&log);
        kickstart(&dir, LABEL, false).unwrap();
        let start = Instant::now();
        while lines(&log) <= before {
            assert!(
                start.elapsed() < Duration::from_secs(5),
                "no new line in 5 s"
            );
            std::thread::sleep(Duration::from_millis(100));
        }
        let (last, tail) = logs(&[log.to_string_lossy().into_owned()]);
        assert!(Instant::now().duration_since(start) < Duration::from_secs(5));
        assert!(last.is_some());
        println!("new line: {}", tail.last().unwrap());
    }
}
