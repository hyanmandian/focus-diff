use std::fmt::Write;
use std::time::Duration;

use tauri::{AppHandle};

use crate::disk;
use crate::github::{repo_ok, Auth};
use crate::i18n::tr;

const SWEEP_AFTER: Duration = Duration::from_hours(14 * 24);
pub const LARGEST: usize = 20 * 1024 * 1024;
pub const ABSENT: &str = "absent";

fn valid_sha(sha: &str) -> bool {
    (sha.len() == 40 || sha.len() == 64) && sha.chars().all(|c| c.is_ascii_hexdigit())
}

fn valid_path(path: &str) -> bool {
    !path.is_empty() && path.len() <= 4096 && !path.starts_with('/') && !path.contains('\\') && !path.contains('\0') && path.split('/').all(|s| !s.is_empty() && s != "." && s != "..")
}

fn encode(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for b in path.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~' | b'/') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

pub fn file_at(app: &AppHandle, auth: &Auth, repo: &str, sha: &str, path: &str) -> Result<Option<Vec<u8>>, String> {
    if !repo_ok(repo) || !valid_sha(sha) || !valid_path(path) {
        return Err("Bad request".into());
    }
    let dir = disk::cache_folder(app, "files");
    let stem = disk::name(&format!("{repo}\n{sha}\n{path}"));
    let (kept, absent) = match &dir {
        Some(dir) => (Some(dir.join(&stem)), Some(dir.join(format!("{stem}.absent")))),
        None => (None, None),
    };
    if let Some(kept) = &kept
        && let Ok(bytes) = std::fs::read(kept)
    {
        disk::touch(kept);
        return Ok(Some(bytes));
    }
    if absent.as_ref().is_some_and(|a| a.exists()) {
        return Ok(None);
    }
    let (status, bytes) = auth.get_bytes(&format!("/repos/{repo}/contents/{}?ref={sha}", encode(path)), "application/vnd.github.raw+json", LARGEST)?;
    match status {
        200 => {
            if let Some(kept) = &kept {
                let _ = disk::write(kept, &bytes);
            }
            Ok(Some(bytes))
        }
        404 => {
            if let Some(absent) = &absent {
                let _ = std::fs::write(absent, b"");
            }
            Ok(None)
        }
        _ => Err(tr!("GitHub returned {status}", "O GitHub respondeu {status}")),
    }
}

pub fn sweep(app: &AppHandle) {
    if let Some(dir) = disk::cache_folder(app, "files") {
        disk::sweep(&dir, SWEEP_AFTER);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_only_safe_requests() {
        assert!(repo_ok("acme/web.site"));
        assert!(!repo_ok("acme/../x"));
        assert!(!repo_ok("acme/.."));
        assert!(!repo_ok("acme"));
        assert!(valid_sha(&"a".repeat(40)));
        assert!(!valid_sha("main"));
        assert!(valid_path("src/a b.ts"));
        assert!(!valid_path("../etc/passwd"));
        assert!(!valid_path("/abs"));
        assert!(!valid_path("a//b"));
    }

    #[test]
    fn encodes_paths_for_the_api() {
        assert_eq!(encode("src/a b#?.ts"), "src/a%20b%23%3F.ts");
        assert_eq!(encode("é"), "%C3%A9");
    }
}
