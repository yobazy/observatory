//! Where the app keeps its own files (desktop.json, the usage log, moments).
//! A debug build (`npm run tauri dev`, the sandbox) keeps them in a `dev`
//! folder inside the installed app's, so trying a change never rewrites the
//! prefs, log or moments of the copy you actually use.

use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// `dir`, or its `dev` folder for a debug build.
fn scoped(dir: PathBuf, dev: bool) -> PathBuf {
    if dev {
        dir.join("dev")
    } else {
        dir
    }
}

pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| scoped(d, cfg!(debug_assertions)))
        .map_err(|e| e.to_string())
}

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| scoped(d, cfg!(debug_assertions)))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_debug_build_keeps_its_files_apart() {
        let dir = PathBuf::from("/Library/Application Support/dev.bazil.observatory");
        assert_eq!(scoped(dir.clone(), false), dir);
        assert_eq!(scoped(dir.clone(), true), dir.join("dev"));
    }
}
