//! Marked moments (moments.ts): ⇧⌘M saves what the app was doing when you
//! noticed something, so it can be handed to whoever looks into it. Each is
//! a folder under `moments/` in the app's data directory: `moment.json` (the
//! last minute of the usage log's events and the app's state), when a thread
//! was open `thread.json` (its last few entries, so `scripts/drive replay`
//! can show it again in the sandbox) and, when macOS allows it,
//! `screenshot.png` of the window. Its path goes on the
//! clipboard. Nothing leaves this Mac.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Manager, WebviewWindow};

/// The oldest moments past this many are deleted as new ones are saved.
const KEEP: usize = 100;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    dir: PathBuf,
    /// Why there's no screenshot, when there isn't one.
    no_screenshot: Option<String>,
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("moments"))
        .map_err(|e| e.to_string())
}

/// A folder name from the webview's timestamp: only characters safe in a
/// path, so the webview can't point the write anywhere else.
fn folder_name(stamp: &str) -> Option<String> {
    let name: String = stamp
        .chars()
        .map(|c| if c == ':' || c == '.' { '-' } else { c })
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect();
    (!name.is_empty()).then_some(name)
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "objc")]
extern "C" {
    fn sel_registerName(name: *const std::ffi::c_char) -> *const std::ffi::c_void;
    fn objc_msgSend();
}

/// The window's number in the window server, for `screencapture -l`, read
/// on the main thread as AppKit wants.
#[cfg(target_os = "macos")]
fn window_number(window: &WebviewWindow) -> Result<i64, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    let w = window.clone();
    window
        .run_on_main_thread(move || {
            let number = w.ns_window().ok().map(|ns| unsafe {
                // objc_msgSend called with the method's own signature:
                // -[NSWindow windowNumber] returns an NSInteger.
                let send: unsafe extern "C" fn(
                    *mut std::ffi::c_void,
                    *const std::ffi::c_void,
                ) -> isize = std::mem::transmute(objc_msgSend as unsafe extern "C" fn());
                send(ns, sel_registerName(c"windowNumber".as_ptr())) as i64
            });
            let _ = tx.send(number);
        })
        .map_err(|e| e.to_string())?;
    rx.recv()
        .ok()
        .flatten()
        .filter(|n| *n > 0)
        .ok_or_else(|| "couldn't find the window".into())
}

/// The window alone, even under others, into `out`. Screen Recording has
/// to be allowed for the app; the first time, macOS asks.
#[cfg(target_os = "macos")]
pub(crate) fn screenshot(window: &WebviewWindow, out: &Path) -> Result<(), String> {
    if !unsafe { CGPreflightScreenCaptureAccess() } {
        unsafe { CGRequestScreenCaptureAccess() };
        return Err("Screen Recording isn't allowed for Observatory (System Settings › Privacy & Security), so there's no screenshot.".into());
    }
    let id = window_number(window)?;
    // -o leaves out the window's shadow; -x the camera sound.
    let status = Command::new("screencapture")
        .args(["-x", "-o", "-l", &id.to_string()])
        .arg(out)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() || !out.exists() {
        return Err(format!("screencapture failed ({status})."));
    }
    Ok(())
}

/// On Linux, the X display's whole screen, with `xwd` and `ffmpeg`: the
/// sandbox app on the always-on PC runs alone on a virtual display
/// (`scripts/sandbox.sh up`), so the screen is the window.
#[cfg(target_os = "linux")]
pub(crate) fn screenshot(_window: &WebviewWindow, out: &Path) -> Result<(), String> {
    if std::env::var_os("DISPLAY").is_none() {
        return Err("No X display to take a screenshot of.".into());
    }
    let dump = Command::new("xwd")
        .args(["-root", "-silent"])
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("xwd: {e} (install x11-apps)"))?;
    let status = Command::new("ffmpeg")
        .args(["-loglevel", "error", "-y", "-f", "xwd_pipe", "-i", "-"])
        .arg(out)
        .stdin(dump.stdout.ok_or("xwd gave no output")?)
        .status()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    if !status.success() || !out.exists() {
        return Err(format!("ffmpeg couldn't save the screenshot ({status})."));
    }
    Ok(())
}

/// Elsewhere the moment is saved without one, so the Rust side still builds.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub(crate) fn screenshot(_window: &WebviewWindow, _out: &Path) -> Result<(), String> {
    Err("Screenshots are only taken on macOS and Linux.".into())
}

fn copy_to_clipboard(text: &str) {
    if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
        }
        let _ = child.wait();
    }
}

/// Delete all but the newest `keep` moments in `root`. Names are
/// timestamps, so they sort oldest first.
fn prune(root: &Path, keep: usize) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    let mut dirs: Vec<PathBuf> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    let extra = dirs.len().saturating_sub(keep);
    for d in &dirs[..extra] {
        let _ = fs::remove_dir_all(d);
    }
}

/// Save `moment` (moments.ts) with a screenshot, and copy its folder's path.
#[tauri::command]
pub async fn save_moment(
    app: AppHandle,
    window: WebviewWindow,
    stamp: String,
    moment: Value,
    thread: Option<Value>,
) -> Result<Saved, String> {
    let root = root(&app)?;
    let name = folder_name(&stamp).ok_or("bad timestamp")?;
    tauri::async_runtime::spawn_blocking(move || {
        let dir = root.join(name);
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let no_screenshot = screenshot(&window, &dir.join("screenshot.png")).err();
        let mut moment = moment;
        if let (Some(why), Some(m)) = (&no_screenshot, moment.as_object_mut()) {
            m.insert("noScreenshot".into(), Value::String(why.clone()));
        }
        let text = serde_json::to_string_pretty(&moment).map_err(|e| e.to_string())?;
        fs::write(dir.join("moment.json"), text).map_err(|e| e.to_string())?;
        if let Some(thread) = thread.filter(|t| !t.is_null()) {
            let text = serde_json::to_string_pretty(&thread).map_err(|e| e.to_string())?;
            fs::write(dir.join("thread.json"), text).map_err(|e| e.to_string())?;
        }
        copy_to_clipboard(&dir.display().to_string());
        prune(&root, KEEP);
        Ok(Saved { dir, no_screenshot })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Add what you noticed to a saved moment's `moment.json`.
#[tauri::command]
pub fn annotate_moment(app: AppHandle, dir: PathBuf, note: String) -> Result<(), String> {
    let root = fs::canonicalize(root(&app)?).map_err(|e| e.to_string())?;
    let dir = fs::canonicalize(&dir).map_err(|e| e.to_string())?;
    if dir.parent() != Some(root.as_path()) {
        return Err("not a saved moment".into());
    }
    let path = dir.join("moment.json");
    let mut moment: Value =
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if let Some(m) = moment.as_object_mut() {
        m.insert("note".into(), Value::String(note));
    }
    let text = serde_json::to_string_pretty(&moment).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

/// Where moments are saved, for Show in Finder; made if it isn't there yet.
#[tauri::command]
pub fn moments_dir(app: AppHandle) -> Result<PathBuf, String> {
    let root = root(&app)?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_name_keeps_only_safe_characters() {
        assert_eq!(
            folder_name("2026-10-18T14:02:11.204Z").as_deref(),
            Some("2026-10-18T14-02-11-204Z")
        );
        // No dots or slashes survive, so it never leaves `moments/`.
        assert_eq!(folder_name("../../etc").as_deref(), Some("----etc"));
        assert_eq!(folder_name("/"), None);
    }

    #[test]
    fn pruning_keeps_the_newest() {
        let root = std::env::temp_dir().join(format!("moments-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        for name in ["2026-10-18T10", "2026-10-18T12", "2026-10-18T11"] {
            fs::create_dir_all(root.join(name)).unwrap();
        }
        prune(&root, 2);
        let mut left: Vec<String> = fs::read_dir(&root)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, ["2026-10-18T11", "2026-10-18T12"]);
        fs::remove_dir_all(&root).unwrap();
    }
}
