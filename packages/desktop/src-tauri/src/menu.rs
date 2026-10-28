//! The menu bar, while a window of the app's own is open (the app is in the Dock then): the Mac's
//! standard menus, which text fields need for ⌘C, ⌘V, ⌘A and ⌘Z, plus every command of the review
//! window's toolbar, as the HIG asks. A command for a review goes to the window that's in front
//! (as a "menu" event, src/components/review/review.tsx); its items are dimmed when no review is, and the
//! review says which of them apply to its pull request.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Theme};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::i18n::tr;

/// The commands that act on the review in front.
const REVIEW: &[&str] = &[
    "find", "overview", "diff", "wrap", "whitespace", "file-next", "file-previous", "toggle-viewed", "next-file", "next-comment", "previous-comment", "commits", "all-changes", "since-review", "ai-review", "submit", "merge", "auto-merge",
    "update-branch", "ready", "draft", "close", "reopen", "delete-branch", "rerun-failed", "open-github", "leave", "shortcuts",
];

/// The review commands' items, and what each review window last said applies to it.
pub struct ReviewItems {
    /// Made again when the language changes, with the menu bar.
    items: Mutex<Items>,
    /// By window label: the commands it can do now.
    state: Mutex<HashMap<String, HashMap<String, bool>>>,
}

/// The menu bar in the language in use; `items`: its review commands, by id. Only the Mac has one.
#[cfg(target_os = "macos")]
pub fn build(app: &AppHandle) -> tauri::Result<(Menu<tauri::Wry>, ReviewItems)> {
    let (menu, items) = make(app)?;
    Ok((menu, ReviewItems { items: Mutex::new(items), state: Mutex::new(HashMap::new()) }))
}

/// The language changed: the menu bar is made again in it, the review commands as the window in
/// front last said.
pub fn relocalize(app: &AppHandle) {
    // Where there's no menu bar, the tray icon's menu is the one to say again.
    #[cfg(not(target_os = "macos"))]
    if let (Some(tray), Ok(menu)) = (app.try_state::<crate::Tray>(), crate::tray_menu(app))
        && let Some(icon) = tray.0.lock().unwrap().as_ref()
    {
        let _ = icon.set_menu(Some(menu));
    }
    let Some(review) = app.try_state::<ReviewItems>() else { return };
    let Ok((menu, items)) = make(app) else { return };
    if app.set_menu(menu).is_err() {
        return;
    }
    *review.items.lock().unwrap() = items;
    if let Some((label, _)) = app.webview_windows().into_iter().find(|(_, w)| w.is_focused().unwrap_or(false)) {
        focused(app, &label);
    } else {
        focused(app, "");
    }
}

/// The review commands' items, by id.
type Items = HashMap<&'static str, MenuItem<tauri::Wry>>;

fn make(app: &AppHandle) -> tauri::Result<(Menu<tauri::Wry>, Items)> {
    let name = app.package_info().name.clone();
    let mut items = HashMap::new();
    let mut item = |id: &'static str, text: &str, accelerator: Option<&str>| -> tauri::Result<MenuItem<tauri::Wry>> {
        let mut builder = MenuItemBuilder::with_id(id, text);
        if let Some(accelerator) = accelerator {
            builder = builder.accelerator(accelerator);
        }
        let built = builder.enabled(!REVIEW.contains(&id)).build(app)?;
        if REVIEW.contains(&id) {
            items.insert(id, built.clone());
        }
        Ok(built)
    };

    // Every item's text is given: the predefined ones' own are English whatever the language.
    let app_menu = SubmenuBuilder::new(app, &name)
        .item(&item("about", &tr!("About {name}", "Sobre o {name}"), None)?)
        .item(&item("updates", &tr!("Check for Updates…", "Buscar atualizações…"), None)?)
        .separator()
        .item(&item("settings", &tr!("Settings…", "Ajustes…"), Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, Some(&tr!("Services", "Serviços")))?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, Some(&tr!("Hide {name}", "Ocultar {name}")))?)
        .item(&PredefinedMenuItem::hide_others(app, Some(&tr!("Hide Others", "Ocultar outros")))?)
        .item(&PredefinedMenuItem::show_all(app, Some(&tr!("Show All", "Mostrar tudo")))?)
        .separator()
        // The app's own Quit: the run loop keeps a tray app alive through the system's.
        .item(&item("quit", &tr!("Quit {name}", "Sair do {name}"), Some("CmdOrCtrl+Q"))?)
        .build()?;
    let file = SubmenuBuilder::new(app, tr!("File", "Arquivo")).item(&PredefinedMenuItem::close_window(app, Some(&tr!("Close Window", "Fechar janela")))?).build()?;
    let edit = SubmenuBuilder::new(app, tr!("Edit", "Editar"))
        .item(&PredefinedMenuItem::undo(app, Some(&tr!("Undo", "Desfazer")))?)
        .item(&PredefinedMenuItem::redo(app, Some(&tr!("Redo", "Refazer")))?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, Some(&tr!("Cut", "Recortar")))?)
        .item(&PredefinedMenuItem::copy(app, Some(&tr!("Copy", "Copiar")))?)
        .item(&PredefinedMenuItem::paste(app, Some(&tr!("Paste", "Colar")))?)
        .item(&PredefinedMenuItem::select_all(app, Some(&tr!("Select All", "Selecionar tudo")))?)
        .separator()
        .item(&item("find", &tr!("Find Files…", "Buscar arquivos…"), Some("CmdOrCtrl+F"))?)
        .build()?;
    // j, k, v, n, p and ⌥⇧J are the page's own keys (they'd type into a field as menu shortcuts),
    // so these items name no shortcut; the page's Keyboard Shortcuts sheet lists them.
    let view = SubmenuBuilder::new(app, tr!("View", "Visualizar"))
        .item(&item("overview", &tr!("Overview", "Visão geral"), Some("CmdOrCtrl+1"))?)
        .item(&item("diff", &tr!("Diff", "Diff"), Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item("wrap", &tr!("Wrap Long Lines", "Quebrar linhas longas"), None)?)
        .item(&item("whitespace", &tr!("Hide Whitespace Changes", "Ocultar mudanças de espaço em branco"), None)?)
        .separator()
        .item(&item("file-next", &tr!("Next File", "Próximo arquivo"), None)?)
        .item(&item("file-previous", &tr!("Previous File", "Arquivo anterior"), None)?)
        .item(&item("toggle-viewed", &tr!("Mark File as Viewed or Not", "Marcar arquivo como visualizado ou não"), None)?)
        .item(&item("next-file", &tr!("Next File to Review", "Próximo arquivo para revisar"), None)?)
        .item(&item("next-comment", &tr!("Next Comment", "Próxima conversa"), None)?)
        .item(&item("previous-comment", &tr!("Previous Comment", "Conversa anterior"), None)?)
        .separator()
        .item(&item("commits", &tr!("Choose Commits…", "Escolher commits…"), None)?)
        .item(&item("all-changes", &tr!("All Changes", "Todas as mudanças"), None)?)
        .item(&item("since-review", &tr!("Changes Since Your Last Review", "Mudanças desde a sua última revisão"), None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, Some(&tr!("Enter Full Screen", "Entrar em tela cheia")))?)
        .build()?;
    let pull_request = SubmenuBuilder::new(app, tr!("Pull Request", "Pull request"))
        .item(&item("ai-review", &tr!("Review with AI", "Revisar com IA"), None)?)
        .item(&item("submit", &tr!("Submit Review…", "Enviar revisão…"), None)?)
        .item(&item("merge", &tr!("Merge…", "Fazer merge…"), None)?)
        .item(&item("auto-merge", &tr!("Merge When Ready", "Fazer merge quando estiver pronto"), None)?)
        .item(&item("update-branch", &tr!("Update Branch", "Atualizar branch"), None)?)
        .separator()
        .item(&item("ready", &tr!("Ready for Review", "Pronto para revisão"), None)?)
        .item(&item("draft", &tr!("Convert to Draft", "Converter em rascunho"), None)?)
        .item(&item("close", &tr!("Close Pull Request", "Fechar pull request"), None)?)
        .item(&item("reopen", &tr!("Reopen Pull Request", "Reabrir pull request"), None)?)
        .item(&item("delete-branch", &tr!("Delete Branch…", "Apagar branch…"), None)?)
        .separator()
        .item(&item("rerun-failed", &tr!("Re-run Failed Checks", "Rodar de novo as verificações que falharam"), None)?)
        .separator()
        .item(&item("open-github", &tr!("Open on GitHub", "Abrir no GitHub"), None)?)
        .item(&item("leave", &tr!("Leave This Review…", "Sair desta revisão…"), None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, tr!("Window", "Janela"))
        .item(&PredefinedMenuItem::minimize(app, Some(&tr!("Minimize", "Minimizar")))?)
        .item(&PredefinedMenuItem::maximize(app, Some(&tr!("Zoom", "Zoom")))?)
        .separator()
        .item(&PredefinedMenuItem::bring_all_to_front(app, Some(&tr!("Bring All to Front", "Trazer tudo para a frente")))?)
        .build()?;
    // The system's search field, which finds menu items, and the review window's shortcuts.
    let help = SubmenuBuilder::new(app, tr!("Help", "Ajuda")).item(&item("shortcuts", &tr!("Keyboard Shortcuts", "Atalhos de teclado"), None)?).build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &pull_request, &window, &help]).build()?;
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }
    Ok((menu, items))
}

/// A window came to the front: the review commands follow it.
pub fn focused(app: &AppHandle, label: &str) {
    let Some(review) = app.try_state::<ReviewItems>() else { return };
    let state = review.state.lock().unwrap();
    let mine = label.starts_with("review-").then(|| state.get(label)).map(|s| s.cloned().unwrap_or_default());
    for (id, item) in review.items.lock().unwrap().iter() {
        // A review that hasn't said yet: everything on until it does.
        let _ = item.set_enabled(mine.as_ref().is_some_and(|s| s.get(*id).copied().unwrap_or(true)));
    }
}

/// What a review window can do now, from its page.
#[tauri::command]
pub fn menu_state(app: AppHandle, window: tauri::WebviewWindow, items: HashMap<String, bool>) {
    let label = window.label().to_string();
    // No menu bar (and so nothing to keep) where the app has none: Windows and Linux.
    let Some(review) = app.try_state::<ReviewItems>() else { return };
    review.state.lock().unwrap().insert(label.clone(), items);
    if window.is_focused().unwrap_or(false) {
        focused(&app, &label);
    }
}

pub fn forget(app: &AppHandle, label: &str) {
    if let Some(review) = app.try_state::<ReviewItems>() {
        review.state.lock().unwrap().remove(label);
    }
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "quit" => app.exit(0),
        "settings" => {
            let _ = crate::show_settings(app);
        }
        "about" => crate::about::show(app),
        "updates" => check_for_updates(app),
        _ if REVIEW.contains(&id) => {
            if let Some((label, _)) = app.webview_windows().into_iter().find(|(label, w)| label.starts_with("review-") && w.is_focused().unwrap_or(false)) {
                let _ = app.emit_to(label.as_str(), "menu", id);
            }
        }
        _ => {}
    }
}

/// Check for Updates…: says what it found, and installs a newer version if asked to.
fn check_for_updates(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let name = app.package_info().name.clone();
        let dialog = app.dialog().clone();
        match crate::update::check(&app).await {
            Ok(Some(version)) => {
                let install = tauri::async_runtime::spawn_blocking(move || {
                    dialog
                        .message(tr!("It's downloaded and installed now, then the app restarts.", "Ela é baixada e instalada agora, e o app reinicia."))
                        .title(tr!("{name} {version} is available", "O {name} {version} está disponível"))
                        .buttons(MessageDialogButtons::OkCancelCustom(tr!("Install and Restart", "Instalar e reiniciar"), tr!("Later", "Depois")))
                        .blocking_show()
                })
                .await
                .unwrap_or(false);
                if install && let Err(e) = crate::update::install(&app).await {
                    app.dialog().message(e).title(tr!("The update couldn't be installed", "Não foi possível instalar a atualização")).kind(MessageDialogKind::Warning).show(|_| {});
                }
            }
            Ok(None) => {
                let version = app.package_info().version.to_string();
                dialog.message(tr!("{name} {version} is the newest version.", "O {name} {version} é a versão mais recente.")).title(tr!("You're up to date", "Você está com a versão mais recente")).show(|_| {})
            }
            Err(e) => dialog.message(e).title(tr!("Couldn't check for updates", "Não foi possível buscar atualizações")).kind(MessageDialogKind::Warning).show(|_| {}),
        }
    });
}

/// A yes-or-no question about something that can't be undone, as a native alert on the window
/// that asked (a sheet on the Mac). `ok` names the default button; Cancel answers Esc.
#[tauri::command]
pub async fn confirm(app: AppHandle, window: tauri::WebviewWindow, title: String, message: String, ok: String) -> Result<bool, String> {
    let dialog = app.dialog().message(message).title(title).parent(&window).buttons(MessageDialogButtons::OkCancelCustom(ok, tr!("Cancel", "Cancelar")));
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await.map_err(|e| e.to_string())
}

/// The theme picked in Settings, for every window: the native parts (the panel's material, title
/// bars, scroll bars, form controls and the web views' system colours) follow it, not only the
/// page. "system" follows the Mac again.
pub fn apply_theme(app: &AppHandle, config: &str) {
    let theme = serde_json::from_str::<serde_json::Value>(config).ok().and_then(|c| match c["theme"].as_str() {
        Some("light") => Some(Theme::Light),
        Some("dark") => Some(Theme::Dark),
        _ => None,
    });
    app.set_theme(theme);
}
