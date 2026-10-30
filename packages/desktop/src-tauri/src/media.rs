use std::io::Read;
use std::time::Duration;

use serde_json::Value;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::disk;

const KEEP: Duration = Duration::from_hours(7 * 24);
const LARGEST: u64 = 200 * 1024 * 1024;

pub(crate) fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = |b: u8| char::from(b).to_digit(16);
                if let (Some(high), Some(low)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                    out.extend(u8::try_from(high * 16 + low));
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

fn allowed(url: &str) -> bool {
    crate::github::https_host(url).is_some_and(|host| host == "github.com" || host.ends_with(".githubusercontent.com"))
}

fn key(url: &str) -> String {
    if url.contains("private-user-images.githubusercontent.com") { url.split('?').next().unwrap_or(url).to_string() } else { url.to_string() }
}

pub(crate) fn image_kind(bytes: &[u8]) -> Option<&'static str> {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => Some("image/png"),
        [0xFF, 0xD8, ..] => Some("image/jpeg"),
        [b'G', b'I', b'F', ..] => Some("image/gif"),
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => Some("image/webp"),
        _ => None,
    }
}

fn kind(bytes: &[u8], url: &str) -> &'static str {
    if let Some(image) = image_kind(bytes) {
        return image;
    }
    let path = std::path::Path::new(url.split('?').next().unwrap_or(url));
    match path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).as_deref() {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
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

fn tag_ok(tag: &str) -> bool {
    !tag.is_empty() && !tag.starts_with('.') && tag.chars().all(|c| c.is_ascii_alphanumeric() || "._-+%".contains(c))
}

fn release_asset(token: &str, url: &str) -> Option<Vec<u8>> {
    let rest = url.strip_prefix("https://github.com/")?;
    let parts: Vec<&str> = rest.splitn(6, '/').collect();
    let [owner, repo, "releases", "download", tag, file] = parts.as_slice() else { return None };
    if !crate::github::name_ok(owner) || !crate::github::name_ok(repo) || !tag_ok(tag) {
        return None;
    }
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
    let response = agent
        .get(format!("https://api.github.com/repos/{owner}/{repo}/releases/assets/{id}"))
        .header("Authorization", &auth)
        .header("Accept", "application/octet-stream")
        .call()
        .ok()?;
    read_all(response)
}

fn fetch(app: &AppHandle, url: &str) -> Option<Vec<u8>> {
    if url.starts_with("https://github.com/") && url.contains("/releases/download/") {
        let token = app.state::<crate::github::Auth>().token_for_git().ok()?;
        return release_asset(&token, url);
    }
    if let Some(signed) = crate::web::signed_address(app, url) {
        return read_all(crate::github::agent().get(&signed).call().ok()?);
    }
    read_all(crate::github::agent().get(url).call().ok()?)
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder().status(status).body(vec![]).unwrap_or_default()
}

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

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let query = request.uri().query().unwrap_or("");
    let Some(url) = query.split('&').find_map(|p| p.strip_prefix("u=")).map(decode) else { return empty(StatusCode::BAD_REQUEST) };
    if !allowed(&url) {
        return empty(StatusCode::FORBIDDEN);
    }
    let Some(dir) = disk::cache_folder(app, "media") else { return empty(StatusCode::INTERNAL_SERVER_ERROR) };
    let path = dir.join(disk::name(&key(&url)));
    let bytes = match std::fs::read(&path) {
        Ok(bytes) if disk::age(&path).is_some_and(|age| age < KEEP) => bytes,
        cached => match fetch(app, &url) {
            Some(bytes) => {
                let _ = disk::write(&path, &bytes);
                bytes
            }
            None => match cached {
                Ok(bytes) => bytes,
                Err(_) => return empty(StatusCode::BAD_GATEWAY),
            },
        },
    };
    let content_type = kind(&bytes, &url);
    if content_type == "application/octet-stream" || content_type == "image/svg+xml" {
        return empty(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    serve_bytes(request, bytes, content_type)
}

pub fn sweep(app: &AppHandle) {
    if let Some(dir) = disk::cache_folder(app, "media") {
        disk::sweep(&dir, KEEP * 4);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_release_tag_is_one_plain_path_segment() {
        assert!(tag_ok("v1.2.0"));
        assert!(tag_ok("desktop-v0.1.0"));
        assert!(!tag_ok(".."));
        assert!(!tag_ok(""));
        assert!(!tag_ok("v1?x=1"));
    }

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
    fn decodes_any_text() {
        assert_eq!(decode("a%2"), "a%2");
        assert_eq!(decode("%aé/%é"), "%aé/%é");
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
