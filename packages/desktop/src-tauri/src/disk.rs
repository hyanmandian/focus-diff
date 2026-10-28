use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

pub fn cache_folder(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?.join(name);
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

pub fn write(path: &Path, contents: impl AsRef<[u8]>) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let temporary = path.with_extension(format!("{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let written = std::fs::write(&temporary, contents).and_then(|()| std::fs::rename(&temporary, path));
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written
}

pub fn save_json(file: Option<&Path>, value: &impl serde::Serialize) {
    let Some(file) = file else { return };
    if let Some(dir) = file.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = write(file, serde_json::to_string(value).unwrap_or_default());
}

pub fn name(key: &str) -> String {
    let fnv = |seed: u64| key.bytes().fold(seed, |h, b| (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3));
    format!("{:016x}{:016x}", fnv(0xcbf2_9ce4_8422_2325), fnv(0x6c62_272e_07bb_0142))
}

pub fn age(path: &Path) -> Option<Duration> {
    path.metadata().and_then(|m| m.modified()).ok()?.elapsed().ok()
}

pub fn touch(path: &Path) {
    let _ = std::fs::File::options().append(true).open(path).and_then(|f| f.set_modified(SystemTime::now()));
}

pub fn sweep(dir: &Path, after: Duration) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if age(&entry.path()).is_some_and(|age| age > after) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_whole_files_and_names_them_stably() {
        let dir = std::env::temp_dir().join(format!("fd-disk-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("state.json");
        write(&file, "one").unwrap();
        write(&file, "two").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "two");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        assert!(age(&file).is_some_and(|age| age < Duration::from_secs(60)));
        sweep(&dir, Duration::from_secs(60));
        assert!(file.exists());
        assert!(write(&dir.join("missing/state.json"), "x").is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        assert_eq!(name("a"), name("a"));
        assert_ne!(name("a"), name("b"));
        assert_eq!(name("a").len(), 32);
        let _ = std::fs::remove_dir_all(dir);
    }
}
