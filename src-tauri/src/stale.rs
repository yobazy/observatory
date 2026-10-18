//! A nebula daemon that's alive but out of reach: its pid is in
//! `daemon.pid` and it still holds that file's lock, so every new daemon
//! quits with "another nebula daemon is already running", yet its socket is
//! gone (macOS cleans /tmp) or refuses connections. Nothing can talk to it,
//! so the only way back is to stop it and start a fresh one.

use crate::daemon::StartError;
use nebula_core::paths;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleDaemon {
    pub pid: u32,
    /// Its child processes: the agent sessions a restart ends.
    pub sessions: usize,
}

extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}
const SIGTERM: i32 = 15;
const SIGKILL: i32 = 9;

fn signal(pid: u32, sig: i32) -> bool {
    i32::try_from(pid).is_ok_and(|p| p > 0 && unsafe { kill(p, sig) } == 0)
}

/// True while `pid` is a process this user can signal.
pub fn pid_alive(pid: u32) -> bool {
    signal(pid, 0)
}

/// True when `pid` runs a `nebula` binary, so a pid the system has since
/// reused for something else is never stopped.
fn is_nebula(pid: u32) -> bool {
    Command::new("ps")
        .args(["-o", "comm=", "-p", &pid.to_string()])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .is_some_and(|c| {
            Path::new(c.trim())
                .file_name()
                .is_some_and(|n| n == "nebula")
        })
}

/// The pid in `pidfile` when it's `alive` and nothing answers on `socket`.
pub fn stale_pid(pidfile: &Path, socket: &Path, alive: impl Fn(u32) -> bool) -> Option<u32> {
    let pid: u32 = std::fs::read_to_string(pidfile).ok()?.trim().parse().ok()?;
    if !alive(pid) || std::os::unix::net::UnixStream::connect(socket).is_ok() {
        return None;
    }
    Some(pid)
}

fn children(pid: u32) -> usize {
    Command::new("pgrep")
        .args(["-P", &pid.to_string()])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count())
        .unwrap_or(0)
}

/// The out-of-reach daemon, if there is one.
pub fn find() -> Option<StaleDaemon> {
    let pid = stale_pid(&paths::pidfile_path(), &paths::socket_path(), |p| {
        pid_alive(p) && is_nebula(p)
    })?;
    Some(StaleDaemon {
        pid,
        sessions: children(pid),
    })
}

#[tauri::command]
pub fn stale_daemon() -> Option<StaleDaemon> {
    find()
}

/// Wait up to `limit` for `pid` to exit.
fn exited(pid: u32, limit: Duration) -> bool {
    let until = Instant::now() + limit;
    while pid_alive(pid) {
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    true
}

/// Stop the out-of-reach daemon `pid`: SIGTERM, then SIGKILL if it hangs on.
/// Refuses any pid that isn't that daemon, so the webview can't use this to
/// signal other processes.
pub fn stop(pid: u32) -> Result<(), StartError> {
    if find().map(|s| s.pid) != Some(pid) {
        return Err(StartError::Failed {
            message: "That nebula isn't running anymore. Start it again.".into(),
        });
    }
    signal(pid, SIGTERM);
    if !exited(pid, Duration::from_secs(5)) {
        signal(pid, SIGKILL);
        if !exited(pid, Duration::from_secs(2)) {
            return Err(StartError::Failed {
                message: format!(
                    "nebula (pid {pid}) didn't stop. Quit it with kill -9 {pid} in a terminal."
                ),
            });
        }
    }
    Ok(())
}

/// Stop the out-of-reach daemon `pid` and start a fresh one.
#[tauri::command]
pub async fn restart_daemon(app: tauri::AppHandle, pid: u32) -> Result<(), StartError> {
    tauri::async_runtime::spawn_blocking(move || {
        stop(pid)?;
        crate::daemon::spawn_daemon(&app)
    })
    .await
    .map_err(|e| StartError::Failed {
        message: e.to_string(),
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::net::UnixListener;

    fn dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("stale-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn a_live_pid_with_no_socket_is_stale() {
        let d = dir("live");
        let mut child = Command::new("sleep").arg("30").spawn().unwrap();
        std::fs::write(d.join("daemon.pid"), format!("{}\n", child.id())).unwrap();
        let found = stale_pid(&d.join("daemon.pid"), &d.join("daemon.sock"), pid_alive);
        child.kill().unwrap();
        child.wait().unwrap();
        assert_eq!(found, Some(child.id()));
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_socket_that_refuses_connections_is_stale_too() {
        let d = dir("refused");
        let sock = d.join("daemon.sock");
        // A socket file nothing accepts a connection on. Not a dropped
        // listener: a child another test spawns meanwhile can inherit it
        // (macOS sets close-on-exec after the socket opens) and keep it up.
        let _datagram = std::os::unix::net::UnixDatagram::bind(&sock).unwrap();
        std::fs::write(d.join("daemon.pid"), format!("{}\n", std::process::id())).unwrap();
        assert_eq!(
            stale_pid(&d.join("daemon.pid"), &sock, pid_alive),
            Some(std::process::id())
        );
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_dead_pid_is_not_stale() {
        let d = dir("dead");
        let mut child = Command::new("true").spawn().unwrap();
        child.wait().unwrap();
        std::fs::write(d.join("daemon.pid"), format!("{}\n", child.id())).unwrap();
        assert!(!pid_alive(child.id()));
        assert_eq!(
            stale_pid(&d.join("daemon.pid"), &d.join("daemon.sock"), pid_alive),
            None
        );
        assert_eq!(
            stale_pid(&d.join("missing.pid"), &d.join("daemon.sock"), pid_alive),
            None
        );
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_daemon_listening_on_its_socket_is_not_stale() {
        let d = dir("listening");
        let sock = d.join("daemon.sock");
        let _listener = UnixListener::bind(&sock).unwrap();
        std::fs::write(d.join("daemon.pid"), format!("{}\n", std::process::id())).unwrap();
        assert_eq!(stale_pid(&d.join("daemon.pid"), &sock, pid_alive), None);
        std::fs::remove_dir_all(&d).unwrap();
    }
}
