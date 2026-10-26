//! People's pictures, kept on disk for a week. GitHub serves avatars cacheable for five minutes, so
//! each time the panel's web view is made again it would ask for every one again; pictures hardly
//! ever change. The pages ask for `avatar://localhost/<path on avatars.githubusercontent.com>` and
//! get the kept copy, fetched once (without the token: avatars are public).

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime};

const KEEP: Duration = Duration::from_secs(7 * 24 * 3600);
const SWEEP_AFTER: Duration = Duration::from_secs(30 * 24 * 3600);
const LARGEST: u64 = 2 * 1024 * 1024;

fn folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("avatars");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// FNV-1a: a stable file name for an address.
fn name(key: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in key.bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn kind(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xFF, 0xD8, ..] => "image/jpeg",
        [b'G', b'I', b'F', ..] => "image/gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "image/webp",
        _ => "application/octet-stream",
    }
}

fn fresh(path: &Path, age: Duration) -> bool {
    path.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a < age)
}

fn fetch(address: &str) -> Option<Vec<u8>> {
    use std::io::Read;
    let response = crate::github::agent().get(address).call().ok()?;
    if response.status() != 200 {
        return None;
    }
    let mut bytes = Vec::new();
    response.into_body().into_reader().take(LARGEST).read_to_end(&mut bytes).ok()?;
    (kind(&bytes) != "application/octet-stream").then_some(bytes)
}

fn reply(status: StatusCode, bytes: Vec<u8>) -> Response<Vec<u8>> {
    let mut builder = Response::builder().status(status);
    if status == StatusCode::OK {
        builder = builder.header("Content-Type", kind(&bytes)).header("Cache-Control", "max-age=604800, immutable");
    }
    builder.body(bytes).unwrap_or_default()
}

/// Answers one `avatar://` request. Blocking: run it off the main thread.
pub fn serve<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let key = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    // Only GitHub's avatar host, whatever a page asks for.
    if !key.starts_with('/') || key.starts_with("//") || key.contains("..") || key.contains('@') {
        return reply(StatusCode::BAD_REQUEST, vec![]);
    }
    let Some(dir) = folder(app) else { return reply(StatusCode::INTERNAL_SERVER_ERROR, vec![]) };
    let path = dir.join(name(key));
    if fresh(&path, KEEP) && let Ok(bytes) = std::fs::read(&path) {
        return reply(StatusCode::OK, bytes);
    }
    match fetch(&format!("https://avatars.githubusercontent.com{key}")) {
        Some(bytes) => {
            let temporary = path.with_extension("tmp");
            if std::fs::write(&temporary, &bytes).is_ok() {
                let _ = std::fs::rename(&temporary, &path);
            }
            reply(StatusCode::OK, bytes)
        }
        // Offline: last week's picture beats none.
        None => match std::fs::read(&path) {
            Ok(bytes) => reply(StatusCode::OK, bytes),
            Err(_) => reply(StatusCode::BAD_GATEWAY, vec![]),
        },
    }
}

/// Removes pictures nobody's been shown for a month.
pub fn sweep<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = folder(app) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if !fresh(&entry.path(), SWEEP_AFTER) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_kinds() {
        assert_eq!(name("/u/1?s=48"), name("/u/1?s=48"));
        assert_ne!(name("/u/1?s=48"), name("/u/2?s=48"));
        assert_eq!(kind(&[0x89, b'P', b'N', b'G', 0]), "image/png");
        assert_eq!(kind(b"<html>"), "application/octet-stream");
    }
}
