//! The menu bar, while a window of the app's own is open (the app is in the Dock then): the Mac's
//! standard menus, which text fields need for ⌘C, ⌘V, ⌘A and ⌘Z, plus every command of the review
//! window's toolbar, as the HIG asks. A command for a review goes to the window that's in front
//! (as a "menu" event, src/review/Review.tsx); its items are dimmed when no review is, and the
//! review says which of them apply to its pull request.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{Menu, MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, Theme};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

/// The commands that act on the review in front.
const REVIEW: &[&str] = &["find", "overview", "diff", "wrap", "next-file", "next-comment", "previous-comment", "ai-review", "submit", "merge", "open-github", "leave"];

/// The review commands' items, and what each review window last said applies to it.
pub struct ReviewItems<R: Runtime> {
    items: HashMap<&'static str, MenuItem<R>>,
    /// By window label: the commands it can do now.
    state: Mutex<HashMap<String, HashMap<String, bool>>>,
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<(Menu<R>, ReviewItems<R>)> {
    let name = app.package_info().name.clone();
    let mut items = HashMap::new();
    let mut item = |id: &'static str, text: &str, accelerator: Option<&str>| -> tauri::Result<MenuItem<R>> {
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

    let app_menu = SubmenuBuilder::new(app, &name)
        .item(&PredefinedMenuItem::about(app, Some(&format!("About {name}")), None)?)
        .item(&item("updates", "Check for Updates…", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        // The app's own Quit: the run loop keeps a tray app alive through the system's.
        .item(&item("quit", &format!("Quit {name}"), Some("CmdOrCtrl+Q"))?)
        .build()?;
    let file = SubmenuBuilder::new(app, "File").item(&PredefinedMenuItem::close_window(app, None)?).build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&item("find", "Find Files…", Some("CmdOrCtrl+F"))?)
        .build()?;
    // n, p and ⌥⇧J are the page's own keys (they'd type into a field as menu shortcuts), so these
    // items name no shortcut.
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("overview", "Overview", Some("CmdOrCtrl+1"))?)
        .item(&item("diff", "Diff", Some("CmdOrCtrl+2"))?)
        .separator()
        .item(&item("wrap", "Wrap Long Lines", None)?)
        .separator()
        .item(&item("next-file", "Next File to Review", None)?)
        .item(&item("next-comment", "Next Comment", None)?)
        .item(&item("previous-comment", "Previous Comment", None)?)
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let pull_request = SubmenuBuilder::new(app, "Pull Request")
        .item(&item("ai-review", "Review with AI", None)?)
        .item(&item("submit", "Submit Review…", None)?)
        .item(&item("merge", "Merge…", None)?)
        .separator()
        .item(&item("open-github", "Open on GitHub", None)?)
        .item(&item("leave", "Leave This Review…", None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .separator()
        .item(&PredefinedMenuItem::bring_all_to_front(app, None)?)
        .build()?;
    // Empty but for the system's search field, which finds menu items.
    let help = SubmenuBuilder::new(app, "Help").build()?;
    let menu = MenuBuilder::new(app).items(&[&app_menu, &file, &edit, &view, &pull_request, &window, &help]).build()?;
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }
    Ok((menu, ReviewItems { items, state: Mutex::new(HashMap::new()) }))
}

/// A window came to the front: the review commands follow it.
pub fn focused<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let Some(review) = app.try_state::<ReviewItems<R>>() else { return };
    let state = review.state.lock().unwrap();
    let mine = label.starts_with("review-").then(|| state.get(label)).map(|s| s.cloned().unwrap_or_default());
    for (id, item) in &review.items {
        // A review that hasn't said yet: everything on until it does.
        let _ = item.set_enabled(mine.as_ref().is_some_and(|s| s.get(*id).copied().unwrap_or(true)));
    }
}

/// What a review window can do now, from its page.
#[tauri::command]
pub fn menu_state(app: AppHandle, window: tauri::WebviewWindow, items: HashMap<String, bool>) {
    let label = window.label().to_string();
    app.state::<ReviewItems<tauri::Wry>>().state.lock().unwrap().insert(label.clone(), items);
    if window.is_focused().unwrap_or(false) {
        focused(&app, &label);
    }
}

pub fn forget<R: Runtime>(app: &AppHandle<R>, label: &str) {
    if let Some(review) = app.try_state::<ReviewItems<R>>() {
        review.state.lock().unwrap().remove(label);
    }
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        "quit" => app.exit(0),
        "settings" => {
            let _ = crate::show_settings(app);
        }
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
fn check_for_updates<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let name = app.package_info().name.clone();
        let dialog = app.dialog().clone();
        match crate::update::check(&app).await {
            Ok(Some(version)) => {
                let install = tauri::async_runtime::spawn_blocking(move || {
                    dialog
                        .message("It's downloaded and installed now, then the app restarts.")
                        .title(format!("{name} {version} is available"))
                        .buttons(MessageDialogButtons::OkCancelCustom("Install and Restart".into(), "Later".into()))
                        .blocking_show()
                })
                .await
                .unwrap_or(false);
                if install && let Err(e) = crate::update::install(&app).await {
                    app.dialog().message(e).title("The update couldn't be installed").kind(MessageDialogKind::Warning).show(|_| {});
                }
            }
            Ok(None) => dialog.message(format!("{name} {} is the newest version.", app.package_info().version)).title("You're up to date").show(|_| {}),
            Err(e) => dialog.message(e).title("Couldn't check for updates").kind(MessageDialogKind::Warning).show(|_| {}),
        }
    });
}

/// A yes-or-no question about something that can't be undone, as a native alert on the window
/// that asked (a sheet on the Mac). `ok` names the default button; Cancel answers Esc.
#[tauri::command]
pub async fn confirm(app: AppHandle, window: tauri::WebviewWindow, title: String, message: String, ok: String) -> Result<bool, String> {
    let dialog = app.dialog().message(message).title(title).parent(&window).buttons(MessageDialogButtons::OkCancelCustom(ok, "Cancel".into()));
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show()).await.map_err(|e| e.to_string())
}

/// The theme picked in Settings, for every window: the native parts (the panel's material, title
/// bars, scroll bars, form controls and the web views' system colours) follow it, not only the
/// page. "system" follows the Mac again.
pub fn apply_theme<R: Runtime>(app: &AppHandle<R>, config: &str) {
    let theme = serde_json::from_str::<serde_json::Value>(config).ok().and_then(|c| match c["theme"].as_str() {
        Some("light") => Some(Theme::Light),
        Some("dark") => Some(Theme::Dark),
        _ => None,
    });
    app.set_theme(theme);
}
