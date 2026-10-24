//! Focus Diff Pro: your pull request reviews from the menu bar (system tray on Windows and Linux).
//!
//! The app is a tray icon and a floating panel under it, plus a settings window. The web views do
//! the work (queues, events, notifications) and call in here for what needs the system: GitHub with
//! the keychain's token, files in the app's config folder, notifications, the tray, opening links.

mod ai;
mod github;
mod tray;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, Rect, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const PANEL: &str = "panel";
const SETTINGS: &str = "settings";
const PANEL_SIZE: (f64, f64) = (420.0, 600.0);
/// How often the panel refreshes, as a nudge from here: timers in a hidden web view get throttled,
/// events don't.
const TICK: Duration = Duration::from_secs(60);

struct Tray(Mutex<Option<TrayIcon>>);

// MARK: Files

/// The few files the app keeps, by name: the person's setup and what's been seen.
fn file_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    let file = match name {
        "config" => "config.json",
        "state" => "state.json",
        "auth" => "auth.json",
        _ => return Err("Unknown file".into()),
    };
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(file))
}

#[tauri::command]
fn read_file(app: AppHandle, name: &str) -> Result<Option<String>, String> {
    match fs::read_to_string(file_path(&app, name)?) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Written to a temporary file first and moved into place, so a crash mid-write never leaves half
/// a file behind.
#[tauri::command]
fn write_file(app: AppHandle, name: &str, contents: &str) -> Result<(), String> {
    let path = file_path(&app, name)?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, contents).map_err(|e| e.to_string())?;
    fs::rename(&temporary, &path).map_err(|e| e.to_string())?;
    // Other windows (the panel, settings) follow along.
    let _ = app.emit("file-changed", name);
    Ok(())
}

// MARK: GitHub

#[derive(Serialize)]
struct Response {
    status: u16,
    body: String,
}

#[tauri::command]
async fn github(auth: State<'_, github::Auth>, method: String, path: String, body: Option<String>, accept: Option<String>) -> Result<Response, String> {
    let (status, body) = auth.request(&method, &path, body.as_deref(), accept.as_deref())?;
    Ok(Response { status, body })
}

#[tauri::command]
async fn auth_status(auth: State<'_, github::Auth>) -> Result<github::Status, String> {
    Ok(auth.status())
}

fn remember_source(app: &AppHandle, source: Option<github::Source>) -> Result<(), String> {
    let contents = serde_json::json!({ "source": source }).to_string();
    write_file(app.clone(), "auth", &contents)
}

#[tauri::command]
async fn auth_use_gh(app: AppHandle, auth: State<'_, github::Auth>) -> Result<(), String> {
    auth.use_gh()?;
    remember_source(&app, Some(github::Source::Gh))
}

#[tauri::command]
async fn auth_use_token(app: AppHandle, auth: State<'_, github::Auth>, token: String) -> Result<(), String> {
    auth.use_token(&token)?;
    remember_source(&app, Some(github::Source::Keychain))
}

#[tauri::command]
async fn auth_device_start() -> Result<github::DeviceCode, String> {
    github::device_start()
}

#[tauri::command]
async fn auth_device_finish(app: AppHandle, auth: State<'_, github::Auth>, device_code: String, interval: u64, expires_in: u64) -> Result<(), String> {
    github::device_finish(&auth, &device_code, interval, expires_in)?;
    remember_source(&app, Some(github::Source::Keychain))
}

#[tauri::command]
async fn auth_sign_out(app: AppHandle, auth: State<'_, github::Auth>) -> Result<(), String> {
    auth.sign_out()?;
    remember_source(&app, None)
}

// MARK: AI (optional)

#[tauri::command]
async fn ai_statuses() -> Result<Vec<ai::Status>, String> {
    tauri::async_runtime::spawn_blocking(ai::statuses).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_ask(provider: ai::Provider, model: Option<String>, prompt: String, input: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || ai::ask(provider, model.as_deref(), &prompt, &input))
        .await
        .map_err(|e| e.to_string())?
}

// MARK: System

#[tauri::command]
fn notify(app: AppHandle, title: String, body: String, sound: bool) -> Result<(), String> {
    let builder = app.notification().builder().title(title).body(body);
    let builder = if sound { builder.sound("default") } else { builder };
    builder.show().map_err(|e| e.to_string())
}

/// Web links only, in the default browser.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links open".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
fn tray_update(app: AppHandle, tray: State<'_, Tray>, count: u32, animate: bool) {
    if let Some(icon) = tray.0.lock().unwrap().as_ref() {
        tray::update(&app, icon, count, animate);
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

/// A pull request's diff in its own window, one per pull request, filling the main screen's usable
/// area (not full screen). Opening one that's already open brings it back.
#[tauri::command]
fn open_review(app: AppHandle, id: String, repo: String, number: u64, title: String) -> Result<(), String> {
    // Window labels allow letters, digits and a few separators; GitHub node ids are safe as they are.
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') || !repo.chars().all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c)) {
        return Err("Bad pull request".into());
    }
    let label = format!("review-{id}");
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let encode = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    let url = format!("review.html?id={}&repo={}&number={number}", encode(&id), encode(&repo));
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(&title)
        .min_inner_size(720.0, 480.0);
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
    let window = builder.build().map_err(|e| e.to_string())?;
    if let Some(monitor) = app.primary_monitor().map_err(|e| e.to_string())? {
        let area = monitor.work_area();
        let _ = window.set_position(area.position);
        let _ = window.set_size(area.size);
    }
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    if let Some(panel) = app.get_webview_window(PANEL) {
        let _ = panel.hide();
    }
}

/// Development only: the web views' errors in the terminal that runs `tauri dev`.
#[tauri::command]
fn log(window: tauri::Window, message: String) {
    if cfg!(debug_assertions) {
        eprintln!("[{}] {}", window.label(), message.chars().take(2000).collect::<String>());
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// MARK: Windows

fn show_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS) {
        window.show()?;
        return window.set_focus();
    }
    let window = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title("Focus Diff Pro Settings")
        .inner_size(760.0, 620.0)
        .min_inner_size(620.0, 480.0)
        .center()
        .build()?;
    window.set_focus()
}

/// The panel floats under the tray icon (over it, when the taskbar is at the bottom of the screen),
/// kept inside the screen it's on.
fn place_panel<R: Runtime>(panel: &tauri::WebviewWindow<R>, rect: &Rect) -> tauri::Result<()> {
    let scale = panel.scale_factor()?;
    let position = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let (width, height) = (PANEL_SIZE.0 * scale, PANEL_SIZE.1 * scale);
    let gap = 6.0 * scale;
    let monitor = panel
        .monitor_from_point(position.x, position.y)?
        .or(panel.primary_monitor()?);
    let (mx, my, mw, mh) = monitor
        .map(|m| {
            let (p, s) = (m.position(), m.size());
            (p.x as f64, p.y as f64, s.width as f64, s.height as f64)
        })
        .unwrap_or((0.0, 0.0, f64::MAX, f64::MAX));
    let below = position.y < my + mh / 2.0;
    let x = (position.x + size.width / 2.0 - width / 2.0).clamp(mx + gap, mx + mw - width - gap);
    let y = if below { position.y + size.height + gap } else { position.y - height - gap };
    panel.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
}

fn toggle_panel<R: Runtime>(app: &AppHandle<R>, rect: &Rect) -> tauri::Result<()> {
    let Some(panel) = app.get_webview_window(PANEL) else { return Ok(()) };
    if panel.is_visible()? {
        return panel.hide();
    }
    place_panel(&panel, rect)?;
    panel.show()?;
    panel.set_focus()?;
    let _ = panel.emit("panel-shown", ());
    Ok(())
}

fn create_panel<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let builder = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("index.html".into()))
        .title("Focus Diff Pro")
        .inner_size(PANEL_SIZE.0, PANEL_SIZE.1)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        // The system's own popover material behind the page, like a menu bar extra's.
        .effects(WindowEffectsConfig {
            effects: vec![
                #[cfg(target_os = "macos")]
                Effect::Popover,
                #[cfg(windows)]
                Effect::Acrylic,
            ],
            state: Some(EffectState::Active),
            radius: Some(12.0),
            color: None,
            interactive: false,
        });
    builder.build()?;
    Ok(())
}

fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let builder = TrayIconBuilder::with_id("main")
        .icon(tray::frame(0.0, false))
        .tooltip("Focus Diff Pro")
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|icon, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                let _ = toggle_panel(icon.app_handle(), &rect);
            }
        });
    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);
    builder.build(app)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(github::Auth::default())
        .manage(Tray(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            github,
            auth_status,
            auth_use_gh,
            auth_use_token,
            auth_device_start,
            auth_device_finish,
            auth_sign_out,
            ai_statuses,
            ai_ask,
            notify,
            open_url,
            tray_update,
            open_settings,
            open_review,
            hide_panel,
            log,
            quit,
        ])
        .setup(|app| {
            // A tray app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            // Where GitHub's token comes from, as chosen last time.
            if let Ok(Some(text)) = read_file(handle.clone(), "auth") {
                let source = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| serde_json::from_value::<Option<github::Source>>(v["source"].clone()).ok())
                    .flatten();
                app.state::<github::Auth>().set_source(source);
            }

            create_panel(&handle)?;
            let icon = create_tray(&handle)?;
            *app.state::<Tray>().0.lock().unwrap() = Some(icon);

            thread::spawn(move || loop {
                thread::sleep(TICK);
                let _ = handle.emit_to(PANEL, "tick", ());
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // The panel goes away when you click elsewhere, like a menu.
            if window.label() == PANEL {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Focus Diff Pro");
}
