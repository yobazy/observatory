//! The app's Dock icon, drawn by the webview: the plate of whichever thread
//! needs you most (`src/nebula/dock.ts`). The red count is the window's
//! badge, set apart from this.

use base64::Engine;

/// Shows `png` (base64) as the Dock icon, or the app's own icon again for
/// none. Only macOS has a Dock; elsewhere this does nothing.
#[tauri::command]
pub fn set_dock_icon(app: tauri::AppHandle, png: Option<String>) -> Result<(), String> {
    let bytes = match png {
        Some(b64) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(b64)
                .map_err(|e| e.to_string())?,
        ),
        None => None,
    };
    show(&app, bytes)
}

#[cfg(target_os = "macos")]
fn show(app: &tauri::AppHandle, bytes: Option<Vec<u8>>) -> Result<(), String> {
    use objc2::AllocAnyThread;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::NSData;

    // AppKit wants this on the main thread.
    app.run_on_main_thread(move || {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let image =
            bytes.and_then(|b| NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(&b)));
        let ns_app = NSApplication::sharedApplication(mtm);
        unsafe { ns_app.setApplicationIconImage(image.as_deref()) };
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
fn show(_app: &tauri::AppHandle, _bytes: Option<Vec<u8>>) -> Result<(), String> {
    Ok(())
}
