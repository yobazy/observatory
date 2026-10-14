//! Previews of files an agent made: an HTML mockup, a Markdown doc, an image.
//! The webview can't read the disk, so files reach it through `preview://`,
//! which serves only what was opened for preview: the file, and for a page
//! or a doc its folder, so relative CSS, scripts and images load. Never a
//! whole home directory or anything above it: a file sitting there is
//! served alone.

use serde::Serialize;
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use tauri::http::{Request, Response, StatusCode};
use tauri::{Manager, Runtime, State, UriSchemeContext};

/// What `preview://` may serve: files and folders opened for preview.
#[derive(Default)]
pub struct PreviewScope(Mutex<Vec<PathBuf>>);

impl PreviewScope {
    fn allows(&self, path: &Path) -> bool {
        self.0
            .lock()
            .unwrap()
            .iter()
            .any(|root| path.starts_with(root))
    }

    fn allow(&self, root: PathBuf) {
        let mut roots = self.0.lock().unwrap();
        if !roots.iter().any(|r| root.starts_with(r)) {
            roots.push(root);
        }
    }
}

const MAX_TEXT: u64 = 2 * 1024 * 1024;

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

/// `~/x`, an absolute path, or one relative to `cwd`, as an absolute path.
fn expand(candidate: &str, cwd: Option<&Path>) -> Option<PathBuf> {
    let path = if let Some(rest) = candidate.strip_prefix("~/") {
        home()?.join(rest)
    } else if candidate.starts_with('/') {
        PathBuf::from(candidate)
    } else {
        cwd?.join(candidate)
    };
    Some(path)
}

/// Which of `candidates` (paths read off a terminal, relative ones against
/// `cwd`) are files on disk: each one's absolute path, or None.
#[tauri::command]
pub fn resolve_paths(candidates: Vec<String>, cwd: Option<String>) -> Vec<Option<String>> {
    let cwd = cwd.map(PathBuf::from);
    candidates
        .iter()
        .map(|c| {
            let path = expand(c, cwd.as_deref())?;
            let path = std::fs::canonicalize(path).ok()?;
            path.is_file().then(|| path.to_string_lossy().into_owned())
        })
        .collect()
}

#[derive(Serialize)]
pub struct PreviewFile {
    path: String,
    /// "html", "markdown", "image", "pdf" or "text".
    kind: &'static str,
    size: u64,
    modified: u64,
}

fn kind_of(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "html",
        "md" | "markdown" | "mdx" => "markdown",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "avif" | "ico" | "bmp" => "image",
        "pdf" => "pdf",
        _ => "text",
    }
}

fn modified_ms(path: &Path) -> u64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_millis() as u64)
}

/// Open `path` for preview: let `preview://` serve it (and, for a page or a
/// doc, its folder), and say what kind of file it is.
#[tauri::command]
pub fn open_preview(path: String, scope: State<'_, PreviewScope>) -> Result<PreviewFile, String> {
    let path = std::fs::canonicalize(&path).map_err(|e| format!("{path}: {e}"))?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err(format!("{} isn't a file", path.display()));
    }
    let kind = kind_of(&path);
    let folder = path.parent().map(Path::to_path_buf);
    // A page's stylesheets and images sit beside it; a folder that is the
    // home directory or above it is too much to hand over for that.
    let wide = |dir: &Path| home().is_some_and(|h| h.starts_with(dir)) || dir.parent().is_none();
    match folder {
        Some(dir) if matches!(kind, "html" | "markdown") && !wide(&dir) => scope.allow(dir),
        _ => scope.allow(path.clone()),
    }
    Ok(PreviewFile {
        path: path.to_string_lossy().into_owned(),
        kind,
        size: meta.len(),
        modified: modified_ms(&path),
    })
}

/// A previewed file's text (Markdown, code), up to 2 MB.
#[tauri::command]
pub fn read_preview_text(path: String, scope: State<'_, PreviewScope>) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !scope.allows(&path) {
        return Err("not opened for preview".into());
    }
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_TEXT {
        return Err(format!("{} is too big to preview", path.display()));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// When each previewed file last changed, in ms (0 when gone): what live
/// reload polls.
#[tauri::command]
pub fn preview_modified(paths: Vec<String>) -> Vec<u64> {
    paths.iter().map(|p| modified_ms(Path::new(p))).collect()
}

fn percent_decode(s: &str) -> Vec<u8> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).ok();
            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
}

fn mime(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "pdf" => "application/pdf",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "md" | "markdown" | "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// `preview://localhost/<absolute path>`: a file opened for preview, or one
/// beside a previewed page. Anything else is a 404, never a hint at what
/// exists.
pub fn serve<R: Runtime>(
    ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
) -> Response<Cow<'static, [u8]>> {
    let not_found = || {
        Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Cow::Borrowed(&b""[..]))
            .unwrap()
    };
    let raw = percent_decode(request.uri().path());
    let Ok(path) = std::fs::canonicalize(PathBuf::from(String::from_utf8_lossy(&raw).into_owned()))
    else {
        return not_found();
    };
    let scope = ctx.app_handle().state::<PreviewScope>();
    if !scope.allows(&path) || !path.is_file() {
        return not_found();
    }
    let picking = request
        .uri()
        .query()
        .is_some_and(|q| q.split('&').any(|kv| kv == "pick=1"));
    match std::fs::read(&path) {
        Ok(bytes) if picking && kind_of(&path) == "html" => Response::builder()
            .header("Content-Type", mime(&path))
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(with_picker(bytes)))
            .unwrap(),
        Ok(bytes) => Response::builder()
            .header("Content-Type", mime(&path))
            // Live reload re-requests the same URL; it must not be cached.
            .header("Cache-Control", "no-store")
            .body(Cow::Owned(bytes))
            .unwrap(),
        Err(_) => not_found(),
    }
}

/// Comment mode's script (pick.js), for a page opened with `?pick=1`.
const PICKER: &str = include_str!("pick.js");

/// `page` with the comment-mode script added: before `</body>` when it has
/// one, else at the end, where a browser still runs it.
fn with_picker(page: Vec<u8>) -> Vec<u8> {
    let tag = format!("<script>{PICKER}</script>");
    let lower = page.to_ascii_lowercase();
    let at = lower
        .windows(7)
        .rposition(|w| w == b"</body>")
        .unwrap_or(page.len());
    let mut out = Vec::with_capacity(page.len() + tag.len());
    out.extend_from_slice(&page[..at]);
    out.extend_from_slice(tag.as_bytes());
    out.extend_from_slice(&page[at..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_decoding_keeps_slashes_and_decodes_the_rest() {
        assert_eq!(
            percent_decode("/Users/me/My%20Mock/index.html"),
            b"/Users/me/My Mock/index.html"
        );
        assert_eq!(percent_decode("/a/caf%C3%A9.md"), "/a/café.md".as_bytes());
        assert_eq!(percent_decode("/a/100%"), b"/a/100%");
    }

    #[test]
    fn the_scope_serves_inside_its_roots_only() {
        let scope = PreviewScope::default();
        scope.allow(PathBuf::from("/tmp/mock"));
        assert!(scope.allows(Path::new("/tmp/mock/index.html")));
        assert!(scope.allows(Path::new("/tmp/mock/css/site.css")));
        assert!(
            !scope.allows(Path::new("/tmp/mockery/index.html")),
            "a sibling sharing a prefix"
        );
        assert!(!scope.allows(Path::new("/tmp/other.html")));
    }

    #[test]
    fn the_picker_goes_before_the_end_of_the_body() {
        let page = with_picker(b"<html><body><p>hi</p></BODY></html>".to_vec());
        let page = String::from_utf8(page).unwrap();
        assert!(page.starts_with("<html><body><p>hi</p><script>"));
        assert!(page.ends_with("</script></BODY></html>"));
        let bare = String::from_utf8(with_picker(b"<p>no body</p>".to_vec())).unwrap();
        assert!(bare.starts_with("<p>no body</p><script>") && bare.ends_with("</script>"));
    }

    #[test]
    fn kinds_follow_the_extension() {
        assert_eq!(kind_of(Path::new("/a/Mock.HTML")), "html");
        assert_eq!(kind_of(Path::new("/a/notes.md")), "markdown");
        assert_eq!(kind_of(Path::new("/a/shot.png")), "image");
        assert_eq!(kind_of(Path::new("/a/main.rs")), "text");
    }
}
