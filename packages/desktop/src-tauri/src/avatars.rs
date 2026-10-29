use std::time::Duration;

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle};

use crate::disk;

const KEEP: Duration = Duration::from_secs(7 * 24 * 3600);
const SWEEP_AFTER: Duration = Duration::from_secs(30 * 24 * 3600);
const LARGEST: u64 = 2 * 1024 * 1024;

fn kind(bytes: &[u8]) -> &'static str {
    crate::media::image_kind(bytes).unwrap_or("application/octet-stream")
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

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri = request.uri();
    let key = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    if !key.starts_with('/') || key.starts_with("//") || key.contains("..") || key.contains('@') {
        return reply(StatusCode::BAD_REQUEST, vec![]);
    }
    let Some(dir) = disk::cache_folder(app, "avatars") else { return reply(StatusCode::INTERNAL_SERVER_ERROR, vec![]) };
    let path = dir.join(disk::name(key));
    if disk::age(&path).is_some_and(|age| age < KEEP) && let Ok(bytes) = std::fs::read(&path) {
        return reply(StatusCode::OK, bytes);
    }
    match fetch(&format!("https://avatars.githubusercontent.com{key}")) {
        Some(bytes) => {
            let _ = disk::write(&path, &bytes);
            reply(StatusCode::OK, bytes)
        }
        None => match std::fs::read(&path) {
            Ok(bytes) => reply(StatusCode::OK, bytes),
            Err(_) => reply(StatusCode::BAD_GATEWAY, vec![]),
        },
    }
}

pub fn sweep(app: &AppHandle) {
    if let Some(dir) = disk::cache_folder(app, "avatars") {
        disk::sweep(&dir, SWEEP_AFTER);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds() {
        assert_eq!(kind(&[0x89, b'P', b'N', b'G', 0]), "image/png");
        assert_eq!(kind(b"<html>"), "application/octet-stream");
    }
}
