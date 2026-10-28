//! Updates: Tauri's updater checks the releases' latest.json a little after launch and every six
//! hours; a new version is only offered (in the panel's footer and in Settings), downloaded and
//! installed when the person says so, then the app restarts into it. Every download is checked
//! against the public key in tauri.conf.json before it's installed.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Error, Update, UpdaterExt};
use crate::i18n::tr;
use crate::sync::Locked;

const FIRST_CHECK: Duration = Duration::from_secs(30);
const EVERY: Duration = Duration::from_secs(6 * 3600);

#[derive(Default)]
pub struct Pending(Mutex<Option<Update>>);

/// The version on offer, if a newer one was found. A release feed that isn't there (nothing published
/// yet, or nothing for this computer) means there's nothing newer; an error, said for people, only
/// when the feed couldn't be reached or read. The updater's own words go to the log.
pub async fn check(app: &AppHandle) -> Result<Option<String>, String> {
    let checked = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(e) => Err(e),
    };
    let update = match checked {
        Ok(update) => update,
        Err(Error::ReleaseNotFound | Error::TargetNotFound(_) | Error::TargetsNotFound(..)) => None,
        Err(e) => {
            eprintln!("Checking for updates failed: {e}");
            return Err(match e {
                Error::Reqwest(_) | Error::Network(_) => tr!("Couldn't reach the update server. Check your connection and try again.", "Não foi possível falar com o servidor de atualizações. Verifique sua conexão e tente de novo."),
                _ => tr!("The update server's answer couldn't be read. Try again later.", "Não foi possível ler a resposta do servidor de atualizações. Tente de novo mais tarde."),
            });
        }
    };
    let version = update.as_ref().map(|u| u.version.clone());
    *app.state::<Pending>().0.held() = update;
    if let Some(version) = &version {
        let _ = app.emit("update-available", version);
    }
    Ok(version)
}

pub fn offered(app: &AppHandle) -> Option<String> {
    app.state::<Pending>().0.held().as_ref().map(|u| u.version.clone())
}

/// Downloads and installs the version on offer, then restarts into it.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let update = app.state::<Pending>().0.held().take().ok_or_else(|| tr!("No update to install", "Não há atualização para instalar"))?;
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// Release builds look for updates on their own; development builds only when asked.
pub fn watch(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            // Quiet when it fails: check() has logged why, and the next try is in six hours.
            let _ = check(&app).await;
            tokio::time::sleep(EVERY).await;
        }
    });
}
