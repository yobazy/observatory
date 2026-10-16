//! What's running in your projects, like a small Activity Monitor: every
//! process whose working folder is in one of the checkouts, and everything
//! those started (a headless Chrome an agent opened runs from `/`, but its
//! parent ran in the project). Read from `ps` for usage and `lsof` for
//! working folders and listening ports, which together take about half a
//! second, so it runs off the main thread.

use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::State;

/// One process in a project.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    /// The executable's name, as Activity Monitor shows it.
    pub name: String,
    /// The whole command line.
    pub command: String,
    /// Percent of one core, as `ps` averages it.
    pub cpu: f32,
    /// Resident memory, bytes.
    pub memory: u64,
    /// How long it has been running, seconds.
    pub elapsed: u64,
    /// The checkout it belongs to, as it was passed in.
    pub worktree: String,
    /// Its own working folder is in the checkout; otherwise a process that
    /// is in it started this one.
    pub direct: bool,
    /// Started, at some remove, by the nebula daemon: one of its sessions.
    pub nebula: bool,
    /// TCP ports it listens on.
    pub ports: Vec<u16>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityReport {
    pub processes: Vec<Proc>,
}

/// The last scan's processes, by pid, with their command lines: stopping a
/// process is only allowed for one of these, and only while it's still the
/// same program.
#[derive(Default)]
pub struct ActivityState(Arc<Mutex<Scanned>>);

#[derive(Default)]
struct Scanned {
    roots: Vec<String>,
    commands: HashMap<u32, String>,
}

/// A row of `ps -axo pid=,ppid=,pcpu=,rss=,etime=,comm=`.
#[derive(Debug, Clone, PartialEq)]
struct Row {
    pid: u32,
    ppid: u32,
    cpu: f32,
    rss_kb: u64,
    elapsed: u64,
    comm: String,
}

fn parse_ps(text: &str) -> Vec<Row> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split_whitespace();
            let pid = f.next()?.parse().ok()?;
            let ppid = f.next()?.parse().ok()?;
            let cpu = f.next()?.parse().ok()?;
            let rss_kb = f.next()?.parse().ok()?;
            let elapsed = parse_etime(f.next()?)?;
            // The rest is the executable's path, which may hold spaces.
            let comm = f.collect::<Vec<_>>().join(" ");
            Some(Row {
                pid,
                ppid,
                cpu,
                rss_kb,
                elapsed,
                comm,
            })
        })
        .collect()
}

/// `ps`'s elapsed time, `[[dd-]hh:]mm:ss`, in seconds.
fn parse_etime(s: &str) -> Option<u64> {
    let (days, rest) = match s.split_once('-') {
        Some((d, r)) => (d.parse::<u64>().ok()?, r),
        None => (0, s),
    };
    let parts: Vec<u64> = rest
        .split(':')
        .map(|p| p.parse().ok())
        .collect::<Option<_>>()?;
    let (h, m, sec) = match parts.as_slice() {
        [m, s] => (0, *m, *s),
        [h, m, s] => (*h, *m, *s),
        _ => return None,
    };
    Some(days * 86_400 + h * 3_600 + m * 60 + sec)
}

/// `ps -axo pid=,args=`: each process's whole command line.
fn parse_args(text: &str) -> HashMap<u32, String> {
    text.lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, args) = line.split_once(' ').unwrap_or((line, ""));
            Some((pid.parse().ok()?, args.trim().to_string()))
        })
        .collect()
}

/// `lsof -F pn` output: `p<pid>` starts a process, `n<name>` follows for
/// each file. Gives each pid's names.
fn parse_lsof(text: &str) -> HashMap<u32, Vec<String>> {
    let mut out: HashMap<u32, Vec<String>> = HashMap::new();
    let mut pid = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix('p') {
            pid = p.parse().ok();
        } else if let (Some(n), Some(pid)) = (line.strip_prefix('n'), pid) {
            out.entry(pid).or_default().push(n.to_string());
        }
    }
    out
}

/// The port of a listening socket's name: `*:5173`, `127.0.0.1:3000`,
/// `[::1]:8080`.
fn port_of(name: &str) -> Option<u16> {
    name.rsplit_once(':')?.1.parse().ok()
}

/// A path as both `/private/tmp/x` and `/tmp/x` would compare: macOS's
/// firmlinks give some folders two names.
fn norm(path: &str) -> &str {
    let p = path.trim_end_matches('/');
    p.strip_prefix("/private")
        .filter(|r| r.starts_with('/'))
        .unwrap_or(p)
}

/// The checkout `cwd` is in: the longest root that is it or holds it, so a
/// worktree nested in its main checkout wins over the main checkout.
fn root_of<'a>(cwd: &str, roots: &'a [String]) -> Option<&'a String> {
    let cwd = norm(cwd);
    roots
        .iter()
        .filter(|r| {
            let r = norm(r);
            !r.is_empty()
                && (cwd == r
                    || cwd
                        .strip_prefix(r)
                        .is_some_and(|rest| rest.starts_with('/')))
        })
        .max_by_key(|r| norm(r).len())
}

/// Which processes belong to which checkout. A process whose working
/// folder is in one belongs to it; one that isn't takes its nearest
/// ancestor's. `skip` (this app's processes and the daemon) belong to none,
/// and pass nothing on.
fn attribute(
    rows: &[Row],
    cwds: &HashMap<u32, String>,
    roots: &[String],
    skip: &HashSet<u32>,
) -> HashMap<u32, (String, bool)> {
    let parent: HashMap<u32, u32> = rows.iter().map(|r| (r.pid, r.ppid)).collect();
    let mut out = HashMap::new();
    for r in rows {
        if skip.contains(&r.pid) {
            continue;
        }
        if let Some(root) = cwds.get(&r.pid).and_then(|c| root_of(c, roots)) {
            out.insert(r.pid, (root.clone(), true));
            continue;
        }
        // Up the tree, at most a few dozen steps (pid 1 ends it).
        let mut at = r.ppid;
        for _ in 0..64 {
            if at <= 1 || skip.contains(&at) {
                break;
            }
            if let Some(root) = cwds.get(&at).and_then(|c| root_of(c, roots)) {
                out.insert(r.pid, (root.clone(), false));
                break;
            }
            match parent.get(&at) {
                Some(&p) => at = p,
                None => break,
            }
        }
    }
    out
}

/// `pid` and everything under it.
fn tree(rows: &[Row], pid: u32) -> HashSet<u32> {
    let mut out = HashSet::from([pid]);
    loop {
        let more: Vec<u32> = rows
            .iter()
            .filter(|r| !out.contains(&r.pid) && out.contains(&r.ppid))
            .map(|r| r.pid)
            .collect();
        if more.is_empty() {
            return out;
        }
        out.extend(more);
    }
}

fn base(comm: &str) -> &str {
    comm.rsplit('/').next().unwrap_or(comm)
}

/// Whether `pid` descends from one of `daemons`.
fn under(pid: u32, parent: &HashMap<u32, u32>, daemons: &HashSet<u32>) -> bool {
    let mut at = pid;
    for _ in 0..64 {
        match parent.get(&at) {
            Some(&p) if daemons.contains(&p) => return true,
            Some(&p) if p > 1 => at = p,
            _ => return false,
        }
    }
    false
}

/// Everything the scan reads, as text, so the rest can be tested without
/// running anything.
struct Snapshot {
    ps: String,
    args: String,
    cwds: String,
    listening: String,
}

fn build(snap: &Snapshot, roots: &[String], me: u32) -> Vec<Proc> {
    let rows = parse_ps(&snap.ps);
    let args = parse_args(&snap.args);
    let cwds: HashMap<u32, String> = parse_lsof(&snap.cwds)
        .into_iter()
        .filter_map(|(pid, mut names)| Some((pid, names.pop()?)))
        .collect();
    let daemons: HashSet<u32> = rows
        .iter()
        .filter(|r| base(&r.comm) == "nebula")
        .map(|r| r.pid)
        .collect();
    let mut skip = tree(&rows, me);
    skip.extend(&daemons);
    let owners = attribute(&rows, &cwds, roots, &skip);
    let parent: HashMap<u32, u32> = rows.iter().map(|r| (r.pid, r.ppid)).collect();
    let mut ports = parse_lsof(&snap.listening);
    let mut out: Vec<Proc> = rows
        .iter()
        .filter_map(|r| {
            let (worktree, direct) = owners.get(&r.pid)?.clone();
            let mut p: Vec<u16> = ports
                .remove(&r.pid)
                .unwrap_or_default()
                .iter()
                .filter_map(|n| port_of(n))
                .collect();
            p.sort_unstable();
            p.dedup();
            Some(Proc {
                pid: r.pid,
                ppid: r.ppid,
                name: base(&r.comm).to_string(),
                command: args.get(&r.pid).cloned().unwrap_or_else(|| r.comm.clone()),
                cpu: r.cpu,
                memory: r.rss_kb * 1024,
                elapsed: r.elapsed,
                worktree,
                direct,
                nebula: under(r.pid, &parent, &daemons),
                ports: p,
            })
        })
        .collect();
    out.sort_by(|a, b| b.cpu.total_cmp(&a.cpu).then(b.memory.cmp(&a.memory)));
    out
}

fn run(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| format!("couldn't run {cmd}: {e}"))?;
    // lsof exits 1 when some process couldn't be read; what it did read is
    // still good.
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn snapshot() -> Result<Snapshot, String> {
    Ok(Snapshot {
        ps: run("/bin/ps", &["-axo", "pid=,ppid=,pcpu=,rss=,etime=,comm="])?,
        args: run("/bin/ps", &["-axo", "pid=,args="])?,
        cwds: run("/usr/sbin/lsof", &["-a", "-d", "cwd", "-n", "-F", "pn"])?,
        listening: run(
            "/usr/sbin/lsof",
            &["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"],
        )?,
    })
}

fn scan(roots: &[String]) -> Result<Vec<Proc>, String> {
    Ok(build(&snapshot()?, roots, std::process::id()))
}

/// The processes running in `roots` (checkout paths) and what they started.
#[tauri::command]
pub async fn activity_report(
    roots: Vec<String>,
    state: State<'_, ActivityState>,
) -> Result<ActivityReport, String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let processes = scan(&roots)?;
        let mut last = shared.lock().map_err(|_| "activity scan poisoned")?;
        last.commands = processes
            .iter()
            .map(|p| (p.pid, p.command.clone()))
            .collect();
        last.roots = roots;
        Ok(ActivityReport { processes })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Ask `pid` to quit, or with `force` make it. Only a process the last scan
/// found in a project, and that a fresh scan still finds there running the
/// same command: a pid can be reused by another program in the meantime.
#[tauri::command]
pub async fn stop_process(
    pid: u32,
    force: bool,
    state: State<'_, ActivityState>,
) -> Result<(), String> {
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (roots, command) = {
            let last = shared.lock().map_err(|_| "activity scan poisoned")?;
            let command = last
                .commands
                .get(&pid)
                .cloned()
                .ok_or("that process isn't one of your projects'")?;
            (last.roots.clone(), command)
        };
        let now = scan(&roots)?;
        if !now.iter().any(|p| p.pid == pid && p.command == command) {
            return Err("that process has already ended, or isn't the same one any more".into());
        }
        let out = Command::new("/bin/kill")
            .arg(if force { "-KILL" } else { "-TERM" })
            .arg(pid.to_string())
            .output()
            .map_err(|e| format!("couldn't run kill: {e}"))?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const PS: &str = "\
    1     0   0.0  12000 10-01:02:03 /sbin/launchd
  100     1   0.1   9000    01:00:00 /usr/local/bin/nebula
  200   100  35.0 400000       12:30 /Users/me/.local/bin/claude
  201   200  80.5 900000       05:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)
  300     1  12.0 200000    02:00:00 /usr/local/bin/node
  400     1   0.0   5000       00:10 /bin/zsh
  500     1   1.0  50000       03:00 /Applications/Observatory.app/Contents/MacOS/observatory
  501   500   0.5   8000       00:01 /bin/zsh
";

    fn snap(cwds: &str, listening: &str) -> Snapshot {
        Snapshot {
            ps: PS.into(),
            args: "  200 claude --model opus\n  300 node node_modules/.bin/vite --port 5173\n"
                .into(),
            cwds: cwds.into(),
            listening: listening.into(),
        }
    }

    fn roots() -> Vec<String> {
        vec![
            "/Users/me/code/shop".into(),
            "/Users/me/code/shop/.worktrees/cart".into(),
            "/tmp/scratch/".into(),
        ]
    }

    #[test]
    fn reads_ps_rows_and_elapsed_times() {
        let rows = parse_ps(PS);
        assert_eq!(rows.len(), 8);
        assert_eq!(rows[0].elapsed, 10 * 86_400 + 3_600 + 2 * 60 + 3);
        assert_eq!(
            rows[3].comm,
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)"
        );
        assert_eq!(parse_etime("05:00"), Some(300));
        assert_eq!(parse_etime("bad"), None);
        assert_eq!(port_of("[::1]:8080"), Some(8080));
        assert_eq!(port_of("*:5173"), Some(5173));
    }

    #[test]
    fn a_process_belongs_to_its_folder_and_what_it_starts_to_it_too() {
        let cwds = "p200\nn/Users/me/code/shop/.worktrees/cart/src\np201\nn/\np300\nn/private/tmp/scratch\np400\nn/Users/me\n";
        let got = build(&snap(cwds, "p300\nn*:5173\nn[::1]:5173\n"), &roots(), 500);
        let by: HashMap<u32, &Proc> = got.iter().map(|p| (p.pid, p)).collect();
        // The nested worktree wins over the main checkout it sits in.
        assert_eq!(by[&200].worktree, "/Users/me/code/shop/.worktrees/cart");
        assert!(by[&200].direct && by[&200].nebula);
        assert_eq!(by[&200].command, "claude --model opus");
        // Chrome runs from `/`, but claude started it.
        assert_eq!(by[&201].worktree, "/Users/me/code/shop/.worktrees/cart");
        assert!(!by[&201].direct && by[&201].nebula);
        assert_eq!(by[&201].name, "Google Chrome Helper (Renderer)");
        // /private/tmp is /tmp; a dev server left to launchd isn't nebula's.
        assert_eq!(by[&300].worktree, "/tmp/scratch/");
        assert!(!by[&300].nebula);
        assert_eq!(by[&300].ports, vec![5173]);
        assert_eq!(by[&300].memory, 200_000 * 1024);
        // Outside every project, the daemon itself, and this app's own: none.
        for pid in [400, 100, 500, 501] {
            assert!(!by.contains_key(&pid), "{pid}");
        }
        // Busiest first.
        assert_eq!(got[0].pid, 201);
    }

    #[test]
    fn a_folder_only_matches_whole_names() {
        let roots = vec!["/Users/me/code/shop".to_string()];
        assert!(root_of("/Users/me/code/shopfront", &roots).is_none());
        assert!(root_of("/Users/me/code/shop", &roots).is_some());
    }

    /// Prints what the scan finds on this Mac, read-only:
    /// `cargo test --locked activity -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn probe_this_mac() {
        let home = std::env::var("HOME").unwrap();
        let dir = format!("{home}/Documents/Programming");
        let roots: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.path().to_string_lossy().into_owned())
            .collect();
        let started = std::time::Instant::now();
        let procs = scan(&roots).unwrap();
        let mut by: HashMap<&str, (usize, f32, u64, usize)> = HashMap::new();
        for p in &procs {
            let e = by.entry(p.worktree.as_str()).or_default();
            e.0 += 1;
            e.1 += p.cpu;
            e.2 += p.memory;
            e.3 += usize::from(!p.direct);
        }
        let mut rows: Vec<_> = by.into_iter().collect();
        rows.sort_by_key(|r| std::cmp::Reverse(r.1 .2));
        println!(
            "scan took {:?}, {} processes",
            started.elapsed(),
            procs.len()
        );
        for (w, (n, cpu, mem, inherited)) in rows {
            println!(
                "{:40} {n:3} procs ({inherited} started by one) {cpu:6.1}% {:6} MB",
                w.rsplit('/').next().unwrap(),
                mem / 1_048_576
            );
        }
        for p in procs.iter().filter(|p| !p.ports.is_empty()) {
            println!("  listening: {} {:?} in {}", p.name, p.ports, p.worktree);
        }
    }
}
