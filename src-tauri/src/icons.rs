//! Project icons: images turned into data URLs the webview can show (it has
//! no access to arbitrary files), and a repo's own logo found where web and
//! app projects usually keep one.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Big enough for any sane icon, small enough to keep in the prefs file.
const MAX_BYTES: u64 = 512 * 1024;

/// Where projects tend to keep a logo, most specific first.
const CANDIDATES: &[&str] = &[
    "icon.svg",
    "logo.svg",
    "public/favicon.svg",
    "public/logo.svg",
    "public/icon.svg",
    "static/favicon.svg",
    "app/icon.svg",
    "src/app/icon.svg",
    "assets/icon.png",
    "assets/logo.png",
    "icon.png",
    "logo.png",
    "app/icon.png",
    "src/app/icon.png",
    "public/logo.png",
    "public/icon.png",
    "public/apple-touch-icon.png",
    "public/favicon.png",
    "static/favicon.png",
    "src-tauri/icons/icon.png",
    "public/favicon.ico",
    "static/favicon.ico",
    "app/favicon.ico",
    "src/app/favicon.ico",
    "favicon.ico",
];

fn mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn data_url(path: &Path) -> Result<String, String> {
    let kind = mime(path)
        .ok_or("that isn't an image this app can show (png, jpg, gif, webp, svg or ico)")?;
    let len = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if len > MAX_BYTES {
        return Err(format!(
            "that image is {} KB; icons can be up to {} KB",
            len / 1024,
            MAX_BYTES / 1024
        ));
    }
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(format!("data:{kind};base64,{}", B64.encode(bytes)))
}

/// A picked image, ready to show and to keep in the prefs.
#[tauri::command]
pub fn read_icon(path: PathBuf) -> Result<String, String> {
    data_url(&path)
}

/// The repo's own logo, if it keeps one in a usual place.
#[tauri::command]
pub fn project_logo(repo: PathBuf) -> Option<String> {
    CANDIDATES
        .iter()
        .map(|c| repo.join(c))
        .find(|p| p.is_file() && data_url(p).is_ok())
        .and_then(|p| data_url(&p).ok())
}

/// Folders a scan never enters: dependencies and build output, full of
/// other projects' icons.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "vendor",
    "Pods",
    "DerivedData",
    "coverage",
];
/// Words in a file's or its folder's name that mark it as an icon.
const HINTS: &[&str] = &["icon", "logo", "favicon", "brand", "mark", "avatar"];
const MAX_DEPTH: usize = 5;
/// Stops a scan of a huge repo early, before it gets slow.
const MAX_VISITED: usize = 20_000;
const MAX_FOUND: usize = 12;
/// A folder of icon sizes (src-tauri/icons, an .appiconset) offers a few, not
/// all of them.
const MAX_PER_DIR: usize = 3;

#[derive(Serialize)]
pub struct FoundImage {
    /// Where it is, from the repo's root.
    path: String,
    url: String,
}

fn hinted(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    HINTS.iter().any(|h| name.contains(h))
}

/// Image files in `repo` that look like icons, walked breadth first so the
/// shallow ones come first.
fn scan(repo: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut queue = std::collections::VecDeque::from([(repo.to_path_buf(), 0)]);
    let mut visited = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let dir_hinted = dir != repo
            && dir
                .file_name()
                .is_some_and(|n| hinted(&n.to_string_lossy()));
        let mut here: Vec<(PathBuf, u64)> = Vec::new();
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_VISITED {
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if depth < MAX_DEPTH && !SKIP_DIRS.contains(&name.as_str()) {
                    subdirs.push(path);
                }
            } else if kind.is_file() && mime(&path).is_some() && (dir_hinted || hinted(&name)) {
                let len = entry.metadata().map(|m| m.len()).unwrap_or(u64::MAX);
                if len > 0 && len <= MAX_BYTES {
                    here.push((path, len));
                }
            }
        }
        // Vectors first, then the biggest bitmaps, which scale down best.
        here.sort_by_key(|(p, len)| (mime(p) != Some("image/svg+xml"), std::cmp::Reverse(*len)));
        found.extend(here.into_iter().take(MAX_PER_DIR).map(|(p, _)| p));
        subdirs.sort();
        queue.extend(subdirs.into_iter().map(|d| (d, depth + 1)));
        if visited > MAX_VISITED {
            break;
        }
    }
    found
}

fn project_images_in(repo: &Path) -> Vec<FoundImage> {
    let usual = CANDIDATES
        .iter()
        .map(|c| repo.join(c))
        .filter(|p| p.is_file());
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for path in usual.chain(scan(repo)) {
        if out.len() >= MAX_FOUND {
            break;
        }
        let Ok(url) = data_url(&path) else {
            continue;
        };
        // The same picture under two names shows once.
        if !seen.insert(url.clone()) {
            continue;
        }
        let rel = path.strip_prefix(repo).unwrap_or(&path);
        out.push(FoundImage {
            path: rel.to_string_lossy().into_owned(),
            url,
        });
    }
    out
}

/// Images in the repo that could be its icon, the usual logo spots first,
/// for the icon picker to offer without a file dialog.
#[tauri::command]
pub async fn project_images(repo: PathBuf) -> Vec<FoundImage> {
    tauri::async_runtime::spawn_blocking(move || project_images_in(&repo))
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_most_specific_logo() {
        let repo = std::env::temp_dir().join(format!("icons-test-{}", std::process::id()));
        std::fs::create_dir_all(repo.join("public")).unwrap();
        std::fs::write(repo.join("public/favicon.ico"), b"ico").unwrap();
        std::fs::write(repo.join("public/favicon.svg"), b"<svg/>").unwrap();
        let url = project_logo(repo.clone()).unwrap();
        assert!(url.starts_with("data:image/svg+xml;base64,"), "{url}");
        std::fs::remove_dir_all(&repo).unwrap();
        assert!(project_logo(repo).is_none());
    }

    #[test]
    fn offers_the_icons_it_finds() {
        let repo = std::env::temp_dir().join(format!("icons-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&repo);
        for dir in ["public", "src-tauri/icons", "node_modules/pkg", "docs"] {
            std::fs::create_dir_all(repo.join(dir)).unwrap();
        }
        std::fs::write(repo.join("public/favicon.svg"), b"<svg/>").unwrap();
        std::fs::write(repo.join("public/copy.svg"), b"<svg/>").unwrap();
        std::fs::write(repo.join("public/brand-mark.png"), b"png").unwrap();
        for size in ["32x32", "64x64", "128x128", "256x256"] {
            std::fs::write(repo.join(format!("src-tauri/icons/{size}.png")), size).unwrap();
        }
        std::fs::write(repo.join("node_modules/pkg/logo.png"), b"theirs").unwrap();
        std::fs::write(repo.join("docs/screenshot.png"), b"shot").unwrap();
        let paths: Vec<String> = project_images_in(&repo)
            .into_iter()
            .map(|f| f.path)
            .collect();
        assert_eq!(paths[0], "public/favicon.svg", "{paths:?}");
        assert!(paths.contains(&"public/brand-mark.png".into()), "{paths:?}");
        // copy.svg is the same picture as favicon.svg, and isn't named like an icon.
        assert!(
            !paths
                .iter()
                .any(|p| p.contains("copy") || p.contains("node_modules") || p.contains("docs")),
            "{paths:?}"
        );
        assert_eq!(
            paths.iter().filter(|p| p.starts_with("src-tauri")).count(),
            MAX_PER_DIR,
            "{paths:?}"
        );
        assert!(
            paths.contains(&"src-tauri/icons/256x256.png".into()),
            "{paths:?}"
        );
        std::fs::remove_dir_all(&repo).unwrap();
    }

    #[test]
    fn refuses_what_it_cant_show() {
        assert!(read_icon(PathBuf::from("/etc/hosts")).is_err());
    }
}
