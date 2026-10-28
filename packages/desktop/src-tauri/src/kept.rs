//! The last copy of each pull request a review window showed (or the panel fetched ahead): its
//! details, files and conversations, on disk, so opening it again shows that at once while the
//! page asks GitHub for what changed. Plain JSON the pages write; kept two weeks after last use.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle};

use crate::disk;

const SWEEP_AFTER: Duration = Duration::from_secs(14 * 24 * 3600);
const LARGEST: usize = 8 * 1024 * 1024;

/// A pull request's GraphQL id names its file: letters, digits, `_` and `-` only.
fn file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Bad pull request".into());
    }
    disk::cache_folder(app, "reviews").map(|dir| dir.join(format!("{id}.json"))).ok_or_else(|| "No cache folder".into())
}

pub fn read(app: &AppHandle, id: &str) -> Result<Option<String>, String> {
    let path = file(app, id)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            // Used: kept from the sweep.
            disk::touch(&path);
            Ok(Some(text))
        }
        Err(_) => Ok(None),
    }
}

pub fn write(app: &AppHandle, id: &str, contents: &str) -> Result<(), String> {
    let path = file(app, id)?;
    if contents.len() > LARGEST {
        // Too big to be worth it: whatever was kept is older than this, so it goes.
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    disk::write(&path, contents).map_err(|e| e.to_string())
}

/// Removes what nobody's opened for two weeks.
pub fn sweep(app: &AppHandle) {
    if let Some(dir) = disk::cache_folder(app, "reviews") {
        disk::sweep(&dir, SWEEP_AFTER);
    }
}
