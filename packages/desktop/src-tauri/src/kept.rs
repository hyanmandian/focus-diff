//! The last copy of each pull request a review window showed (or the panel fetched ahead): its
//! details, files and conversations, on disk, so opening it again shows that at once while the
//! page asks GitHub for what changed. Plain JSON the pages write; kept two weeks after last use.

use std::path::PathBuf;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

const SWEEP_AFTER: Duration = Duration::from_secs(14 * 24 * 3600);
const LARGEST: usize = 8 * 1024 * 1024;

fn folder<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join("reviews");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

/// A pull request's GraphQL id names its file: letters, digits, `_` and `-` only.
fn file<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Err("Bad pull request".into());
    }
    folder(app).map(|dir| dir.join(format!("{id}.json"))).ok_or_else(|| "No cache folder".into())
}

pub fn read<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<Option<String>, String> {
    let path = file(app, id)?;
    match std::fs::read_to_string(&path) {
        Ok(text) => {
            // Used: kept from the sweep.
            let _ = std::fs::File::options().append(true).open(&path).and_then(|f| f.set_modified(std::time::SystemTime::now()));
            Ok(Some(text))
        }
        Err(_) => Ok(None),
    }
}

pub fn write<R: Runtime>(app: &AppHandle<R>, id: &str, contents: &str) -> Result<(), String> {
    let path = file(app, id)?;
    if contents.len() > LARGEST {
        // Too big to be worth it: whatever was kept is older than this, so it goes.
        let _ = std::fs::remove_file(&path);
        return Ok(());
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &path).map_err(|e| e.to_string())
}

/// Removes what nobody's opened for two weeks.
pub fn sweep<R: Runtime>(app: &AppHandle<R>) {
    let Some(dir) = folder(app) else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let old = entry.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|a| a > SWEEP_AFTER);
        if old {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}
