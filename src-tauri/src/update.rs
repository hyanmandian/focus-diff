//! Updates: Tauri's updater checks the releases' latest.json a little after launch and every six
//! hours; a new version is only offered (in the panel's footer and in Settings), downloaded and
//! installed when the person says so, then the app restarts into it. Every download is checked
//! against the public key in tauri.conf.json before it's installed.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use crate::i18n::tr;

const FIRST_CHECK: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(6 * 3600);

#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// The version on offer, if a newer one was found. Errors when GitHub couldn't be asked.
pub async fn check<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    let update = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    let version = update.as_ref().map(|u| u.version.clone());
    *app.state::<Pending>().0.lock().unwrap() = update;
    if let Some(version) = &version {
        let _ = app.emit("update-available", version);
    }
    Ok(version)
}

pub fn offered<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    app.state::<Pending>().0.lock().unwrap().as_ref().map(|u| u.version.clone())
}

/// Downloads and installs the version on offer, then restarts into it.
pub async fn install<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let update = app.state::<Pending>().0.lock().unwrap().take().ok_or_else(|| tr!("No update to install", "Não há atualização para instalar"))?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// Release builds look for updates on their own; development builds only when asked.
pub fn watch<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            if let Err(e) = check(&app).await {
                eprintln!("Checking for updates failed: {e}");
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}
