use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle};

use crate::disk;

const SWEEP_AFTER: Duration = Duration::from_hours(14 * 24);
const LARGEST: usize = 8 * 1024 * 1024;

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
            disk::touch(&path);
            Ok(Some(text))
        }
        Err(_) => Ok(None),
    }
}

pub fn write(app: &AppHandle, id: &str, contents: &str) -> Result<(), String> {
    let path = file(app, id)?;
    if contents.len() > LARGEST {
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    disk::write(&path, contents).map_err(|e| e.to_string())
}

pub fn sweep(app: &AppHandle) {
    if let Some(dir) = disk::cache_folder(app, "reviews") {
        disk::sweep(&dir, SWEEP_AFTER);
    }
}
