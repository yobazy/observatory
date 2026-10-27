//! The dev build's control socket: lets an agent use the app the way you do
//! (pick a thread, open a file, click, read the screen, take a screenshot)
//! with `scripts/drive`, so it can see a change working without you. Only a
//! debug build listens, and only when `OBSERVATORY_CONTROL` names the socket,
//! which `scripts/sandbox.sh app` sets; a release never does.
//!
//! One JSON request per line, one JSON reply per line. A screenshot is taken
//! here; everything else goes to the webview (control.ts), which owns what's
//! on screen, and its answer comes back through `control_reply`.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// Requests waiting on the webview's answer, by id, and the next id.
#[derive(Default, Clone)]
pub struct ControlState(Arc<Pending>);

#[derive(Default)]
pub struct Pending {
    waiting: Mutex<HashMap<u64, oneshot::Sender<Value>>>,
    next: AtomicU64,
}

/// The webview's answer to request `id`.
#[tauri::command]
pub fn control_reply(id: u64, reply: Value, state: State<'_, ControlState>) {
    if let Some(tx) = state.0.waiting.lock().unwrap().remove(&id) {
        let _ = tx.send(reply);
    }
}

/// Where to listen, when this build should.
fn socket_path() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    std::env::var_os("OBSERVATORY_CONTROL")
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
}

/// Listen on the control socket, if this is a dev build asked to.
pub fn start(app: &AppHandle) {
    let Some(path) = socket_path() else {
        return;
    };
    #[cfg(unix)]
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = listen(app, &path).await {
                eprintln!("control socket {}: {e}", path.display());
            }
        });
    }
    #[cfg(not(unix))]
    let _ = (app, path);
}

#[cfg(unix)]
async fn listen(app: AppHandle, path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)?;
    // Yours alone: what drives the app can see everything in it.
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    eprintln!("control socket listening at {}", path.display());
    loop {
        let (stream, _) = listener.accept().await?;
        tauri::async_runtime::spawn(serve(app.clone(), stream));
    }
}

#[cfg(unix)]
async fn serve(app: AppHandle, stream: tokio::net::UnixStream) {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(req) => answer(&app, req).await,
            Err(e) => json!({ "ok": false, "error": format!("not JSON: {e}") }),
        };
        let mut out = reply.to_string();
        out.push('\n');
        if write.write_all(out.as_bytes()).await.is_err() {
            break;
        }
    }
}

async fn answer(app: &AppHandle, req: Value) -> Value {
    if req["cmd"] == "shot" {
        return shot(app, &req).await;
    }
    let state = app.state::<ControlState>().inner().clone();
    let pending = &state.0.waiting;
    let id = state.0.next.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = oneshot::channel();
    pending.lock().unwrap().insert(id, tx);
    if let Err(e) = app.emit("observatory://control", json!({ "id": id, "req": req })) {
        pending.lock().unwrap().remove(&id);
        return json!({ "ok": false, "error": e.to_string() });
    }
    match tokio::time::timeout(Duration::from_secs(20), rx).await {
        Ok(Ok(reply)) => reply,
        _ => {
            pending.lock().unwrap().remove(&id);
            json!({ "ok": false, "error": "the window didn't answer in 20s (is it loaded?)" })
        }
    }
}

/// The window, into `req.out` (an absolute path ending in .png).
async fn shot(app: &AppHandle, req: &Value) -> Value {
    let Some(out) = req["out"].as_str().map(PathBuf::from) else {
        return json!({ "ok": false, "error": "shot needs \"out\", a .png path" });
    };
    if !out.is_absolute() || out.extension().is_none_or(|e| e != "png") {
        return json!({ "ok": false, "error": "\"out\" must be an absolute .png path" });
    }
    let Some(window) = app.get_webview_window("main") else {
        return json!({ "ok": false, "error": "no main window" });
    };
    let taken = tauri::async_runtime::spawn_blocking(move || {
        if let Some(dir) = out.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        crate::moments::screenshot(&window, &out).map(|()| out)
    })
    .await;
    match taken {
        Ok(Ok(out)) => json!({ "ok": true, "value": out }),
        Ok(Err(e)) => json!({ "ok": false, "error": e }),
        Err(e) => json!({ "ok": false, "error": e.to_string() }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_named_socket_is_listened_on() {
        // Tests are debug builds, so the environment decides.
        std::env::remove_var("OBSERVATORY_CONTROL");
        assert_eq!(socket_path(), None);
        std::env::set_var("OBSERVATORY_CONTROL", "");
        assert_eq!(socket_path(), None);
        std::env::set_var("OBSERVATORY_CONTROL", "/tmp/x/control.sock");
        assert_eq!(socket_path(), Some(PathBuf::from("/tmp/x/control.sock")));
        std::env::remove_var("OBSERVATORY_CONTROL");
    }
}
