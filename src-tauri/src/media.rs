//! Pictures and videos in descriptions and comments, which in private repositories GitHub serves
//! only to a signed-in browser (release assets, attachments). The pages ask for
//! `media://localhost/?u=<the GitHub address>`; this fetches it with the token (which stays here),
//! keeps it on disk for a week, and serves it, in ranges for videos so they can be scrubbed.
//! Only GitHub's own hosts, https.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::Value;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

const KEEP: Duration = Duration::from_secs(7 * 24 * 3600);
const LARGEST: u64 = 200 * 1024 * 1024;

fn folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("media");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn name(key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                if let Ok(b) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(b);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// GitHub's hosts only: github.com and its user content hosts.
fn allowed(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").to_ascii_lowercase();
    !host.contains('@') && !host.contains(':') && (host == "github.com" || host.ends_with(".githubusercontent.com"))
}

/// The cache key: private-user-images' addresses carry a token that changes each time; the path
/// names the file.
fn key(url: &str) -> String {
    if url.contains("private-user-images.githubusercontent.com") { url.split('?').next().unwrap_or(url).to_string() } else { url.to_string() }
}

fn kind(bytes: &[u8], url: &str) -> &'static str {
    let path = url.split('?').next().unwrap_or(url).to_ascii_lowercase();
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ if path.ends_with(".mp4") || path.ends_with(".m4v") => "video/mp4",
        _ if path.ends_with(".mov") => "video/quicktime",
        _ if path.ends_with(".webm") => "video/webm",
        _ if bytes.get(4..8) == Some(b"ftyp") => "video/mp4",
        _ if bytes.starts_with(b"<svg") || bytes.starts_with(b"<?xml") => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

fn read_all(response: ureq::http::Response<ureq::Body>) -> Option<Vec<u8>> {
    if response.status() != 200 {
        return None;
    }
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(LARGEST).read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// A private repository's release asset, through the API (github.com's own download link wants a
/// browser session): the release by tag, the asset by name, its bytes.
fn release_asset(token: &str, url: &str) -> Option<Vec<u8>> {
    let rest = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = rest.splitn(6, '/').collect();
    let [owner, repo, "releases", "download", tag, file] = parts.as_slice() else { return None };
    let agent = crate::github::agent();
    let auth = format!("Bearer {token}");
    let release: Value = agent
        .get(format!("https://api.github.com/repos/{owner}/{repo}/releases/tags/{tag}"))
        .header("Authorization", &auth)
        .header("Accept", "application/vnd.github+json")
        .call()
        .ok()?
        .into_body()
        .read_json()
        .ok()?;
    let file = decode(file);
    let id = release["assets"].as_array()?.iter().find(|a| a["name"].as_str() == Some(&file))?["id"].as_u64()?;
    // GitHub answers with a redirect to its storage, which ureq follows without the token.
    let response = agent
        .get(format!("https://api.github.com/repos/{owner}/{repo}/releases/assets/{id}"))
        .header("Authorization", &auth)
        .header("Accept", "application/octet-stream")
        .call()
        .ok()?;
    read_all(response)
}

fn fetch<R: Runtime>(app: &AppHandle<R>, url: &str) -> Option<Vec<u8>> {
    if url.starts_with("https://github.com/") && url.contains("/releases/download/") {
        let token = app.state::<crate::github::Auth>().token_for_git().ok()?;
        return release_asset(&token, url);
    }
    // Everything else on GitHub's content hosts is reachable at its (signed) address.
    read_all(crate::github::agent().get(url).call().ok()?)
}

fn fresh(path: &Path) -> bool {
    path.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a < KEEP)
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(vec![]).unwrap_or_default()
}

/// The bytes asked for: all of them, or a range ("bytes=a-b"), as a video player asks.
fn serve_bytes(request: &Request<Vec<u8>>, bytes: Vec<u8>, content_type: &str) -> Response<Vec<u8>> {
    let total = bytes.len();
    let range = request.headers().get("range").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("bytes=")).and_then(|v| {
        let (a, b) = v.split_once('-')?;
        let start: usize = a.parse().ok()?;
        let end: usize = if b.is_empty() { total.saturating_sub(1) } else { b.parse::<usize>().ok()?.min(total.saturating_sub(1)) };
        (start <= end && end < total).then_some((start, end))
    });
    let builder = Response::builder().header("Content-Type", content_type).header("Accept-Ranges", "bytes").header("Cache-Control", "max-age=604800");
    match range {
        Some((start, end)) => builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header("Content-Range", format!("bytes {start}-{end}/{total}"))
            .header("Content-Length", (end - start + 1).to_string())
            .body(bytes[start..=end].to_vec())
            .unwrap_or_default(),
        None => builder.status(StatusCode::OK).header("Content-Length", total.to_string()).body(bytes).unwrap_or_default(),
    }
}

/// Answers one `media://` request. Blocking: run it off the main thread.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let query = request.uri().query().unwrap_or("");
    let Some(url) = query.split('&').find_map(|p| p.strip_prefix("u=")).map(decode) else { return empty(StatusCode::BAD_REQUEST) };
    if !allowed(&url) {
        return empty(StatusCode::FORBIDDEN);
    }
    let Some(dir) = folder(app) else { return empty(StatusCode::INTERNAL_SERVER_ERROR) };
    let path = dir.join(name(&key(&url)));
    let bytes = match std::fs::read(&path) {
        Ok(bytes) if fresh(&path) => bytes,
        cached => match fetch(app, &url) {
            Some(bytes) => {
                let temporary = path.with_extension("tmp");
                if std::fs::write(&temporary, &bytes).is_ok() {
                    let _ = std::fs::rename(&temporary, &path);
                }
                bytes
            }
            // Offline, or gone: an older copy beats none.
            None => match cached {
                Ok(bytes) => bytes,
                Err(_) => return empty(StatusCode::BAD_GATEWAY),
            },
        },
    };
    let content_type = kind(&bytes, &url);
    // Something that isn't a picture or a video isn't shown, whatever GitHub sent.
    if content_type == "application/octet-stream" || content_type == "image/svg+xml" {
        return empty(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    serve_bytes(request, bytes, content_type)
}

/// Removes what nobody's looked at for a month.
pub fn sweep<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = folder(app) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a > KEEP * 4);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_github() {
        assert!(allowed("https://github.com/acme/web/releases/download/v1/a.png"));
        assert!(allowed("https://private-user-images.githubusercontent.com/1/a.png?jwt=x"));
        assert!(!allowed("http://github.com/a.png"));
        assert!(!allowed("https://github.com.evil.com/a.png"));
        assert!(!allowed("https://evil.com/?https://github.com/"));
        assert!(!allowed("https://user@github.com/a.png"));
    }

    #[test]
    fn keys_and_kinds() {
        assert_eq!(key("https://private-user-images.githubusercontent.com/1/a.png?jwt=x"), key("https://private-user-images.githubusercontent.com/1/a.png?jwt=y"));
        assert_eq!(kind(b"\0\0\0\x18ftypmp42", "https://x/v"), "video/mp4");
        assert_eq!(kind(b"x", "https://x/a.MOV"), "video/quicktime");
        assert_eq!(decode("https%3A%2F%2Fgithub.com%2Fa%20b"), "https://github.com/a b");
    }

    #[test]
    fn ranges() {
        let request = Request::builder().header("range", "bytes=2-4").body(vec![]).unwrap();
        let response = serve_bytes(&request, b"0123456789".to_vec(), "video/mp4");
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.body(), b"234");
        assert_eq!(response.headers()["content-range"], "bytes 2-4/10");
    }
}
