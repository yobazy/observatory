//! Previews of files an agent made: an HTML mockup, a Markdown doc, an image,
//! a video.
//! The webview can't read the disk, so files reach it through `preview://`,
//! which serves only what was opened for preview: the file, and for a page
//! or a doc its folder, so relative CSS, scripts and images load. Never a
//! whole home directory or anything above it: a file sitting there is
//! served alone.

use serde::Serialize;
use std::borrow::Cow;
use std::io::{Read, Seek, SeekFrom};
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
    /// "html", "markdown", "image", "video", "pdf" or "text".
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
        "mp4" | "m4v" | "mov" | "webm" => "video",
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
        "m4v" => "video/x-m4v",
        "mov" => "video/quicktime",
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
    // WebKit plays a video only when it can ask for it a piece at a time.
    if let Some(range) = request.headers().get("range") {
        return serve_range(&path, range.to_str().unwrap_or("")).unwrap_or_else(not_found);
    }
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

/// The first and last byte `range` (a `Range: bytes=…` header) asks for, in
/// a file of `len` bytes. None when it asks for none of it.
fn byte_range(range: &str, len: u64) -> Option<(u64, u64)> {
    let spec = range
        .trim()
        .strip_prefix("bytes=")?
        .split(',')
        .next()?
        .trim();
    let (start, end) = spec.split_once('-')?;
    let (start, end) = if start.is_empty() {
        // `-500`: the last 500 bytes.
        let n: u64 = end.parse().ok()?;
        (len.checked_sub(n.min(len))?, len.checked_sub(1)?)
    } else {
        let start: u64 = start.parse().ok()?;
        let end = if end.is_empty() {
            len.checked_sub(1)?
        } else {
            end.parse::<u64>().ok()?.min(len.checked_sub(1)?)
        };
        (start, end)
    };
    (start <= end && start < len).then_some((start, end))
}

/// The part of `path` a `Range` header asks for: a 206, or a 416 when the
/// range is outside the file. Read in pieces of at most 4 MB, so a long
/// video isn't read whole for each one.
fn serve_range(path: &Path, range: &str) -> Option<Response<Cow<'static, [u8]>>> {
    const PIECE: u64 = 4 * 1024 * 1024;
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let Some((start, end)) = byte_range(range, len) else {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header("Content-Range", format!("bytes */{len}"))
            .body(Cow::Borrowed(&b""[..]))
            .ok();
    };
    let end = end.min(start + PIECE - 1);
    let mut bytes = vec![0; (end - start + 1) as usize];
    file.seek(SeekFrom::Start(start)).ok()?;
    file.read_exact(&mut bytes).ok()?;
    Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header("Content-Type", mime(path))
        .header("Accept-Ranges", "bytes")
        .header("Content-Range", format!("bytes {start}-{end}/{len}"))
        .header("Cache-Control", "no-store")
        .body(Cow::Owned(bytes))
        .ok()
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
        assert_eq!(kind_of(Path::new("/a/cut.MP4")), "video");
        assert_eq!(kind_of(Path::new("/a/take.mov")), "video");
        assert_eq!(kind_of(Path::new("/a/main.rs")), "text");
    }

    #[test]
    fn ranges_ask_for_part_of_the_file() {
        assert_eq!(byte_range("bytes=0-1", 100), Some((0, 1)));
        assert_eq!(byte_range("bytes=10-", 100), Some((10, 99)));
        assert_eq!(byte_range("bytes=90-500", 100), Some((90, 99)));
        assert_eq!(byte_range("bytes=-20", 100), Some((80, 99)));
        assert_eq!(byte_range("bytes=100-", 100), None, "past the end");
        assert_eq!(byte_range("bytes=5-2", 100), None);
        assert_eq!(byte_range("bytes=0-", 0), None, "an empty file");
        assert_eq!(byte_range("lines=1-2", 100), None);
    }

    #[test]
    fn a_range_is_served_as_a_206() {
        let dir = std::env::temp_dir().join(format!("obs-range-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("clip.mp4");
        std::fs::write(&path, b"0123456789").unwrap();
        let res = serve_range(&path, "bytes=2-4").unwrap();
        assert_eq!(res.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(res.headers()["Content-Range"], "bytes 2-4/10");
        assert_eq!(res.headers()["Content-Type"], "video/mp4");
        assert_eq!(&res.body()[..], b"234");
        let res = serve_range(&path, "bytes=20-").unwrap();
        assert_eq!(res.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
