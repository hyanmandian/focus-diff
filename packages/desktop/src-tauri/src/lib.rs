//! Focus Diff: your pull request reviews from the menu bar (system tray on Windows and Linux).
//!
//! The app is a tray icon and a floating panel under it, plus settings and review windows. The
//! queues live here (watch.rs, engine.rs): fetched, compared and notified about with no web view
//! open, so the panel's web view only exists while it's in use. The pages call in for what needs
//! the system: GitHub with the keychain's token, the app's files, notifications, opening links.

mod actions;
mod ai;
mod avatars;
mod blobs;
mod checkout;
mod config;
#[cfg(any(debug_assertions, feature = "devctl"))]
mod devctl;
mod drafts;
mod engine;
#[cfg(target_os = "macos")]
mod floating;
mod github;
mod i18n;
mod kept;
mod logs;
mod media;
#[cfg(target_os = "macos")]
mod notify;
mod about;
mod menu;
mod outbox;
mod review;
mod sound;
mod tray;
mod update;
mod uploads;
mod watch;
mod web;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, Rect, Runtime, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::{Effect, EffectState};
#[cfg(not(target_os = "macos"))]
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

pub(crate) const PANEL: &str = "panel";
const SETTINGS: &str = "settings";
const SETUP: &str = "setup";
const PANEL_SIZE: (f64, f64) = (470.0, 600.0);
/// The panel's corners, as the page draws them (panel.tsx); what's inside follows them in.
const PANEL_RADIUS: f64 = 18.0;
/// How long a hidden panel's web view is kept, to open again instantly; after that it's closed
/// and its memory given back, and the next click makes a new one.
const PANEL_KEEP: Duration = Duration::from_secs(3 * 60);

pub(crate) struct Tray<R: Runtime>(pub(crate) Mutex<Option<TrayIcon<R>>>);

// MARK: Files

/// The files the pages may read and write, by name: the person's setup. (What's been seen is
/// watch.rs's own.)
fn file_path<R: Runtime>(app: &AppHandle<R>, name: &str) -> Result<PathBuf, String> {
    let file = match name {
        "config" => "config.json",
        "auth" => "auth.json",
        // The reader's review pace, learned from the files they mark as viewed (src/utils/estimate/estimate.ts).
        "pace" => "pace.json",
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
    match name {
        "config" => {
            menu::apply_theme(&app, contents);
            apply_language(&app, contents);
            app.state::<watch::Watch>().send(watch::Message::Config);
        }
        "auth" => app.state::<watch::Watch>().send(watch::Message::Auth),
        _ => {}
    }
    // Other windows (the panel, settings) follow along.
    let _ = app.emit("file-changed", name);
    Ok(())
}

// MARK: Queues

#[tauri::command]
fn snapshot(watch: State<'_, watch::Watch>) -> serde_json::Value {
    watch.snapshot()
}

#[tauri::command]
fn refresh(watch: State<'_, watch::Watch>, force: bool) {
    watch.send(watch::Message::Refresh { force });
}

#[tauri::command]
fn mark_seen(app: AppHandle, watch: State<'_, watch::Watch>, queue_id: String, pr_id: String) {
    watch.mark_seen(&app, &queue_id, &pr_id);
}

#[tauri::command]
fn mark_queue_seen(app: AppHandle, watch: State<'_, watch::Watch>, queue_id: String) {
    watch.mark_queue_seen(&app, &queue_id);
}

#[tauri::command]
fn dismiss(app: AppHandle, watch: State<'_, watch::Watch>, queue_id: String, pr_id: String) {
    watch.dismiss(&app, &queue_id, &pr_id);
}

/// Settings' test: a notification now, to see they get through.
#[tauri::command]
fn test_notification(app: AppHandle, sound: bool) {
    show_notification(&app, i18n::tr!("Notifications work", "As notificações funcionam"), i18n::tr!("Focus Diff will tell you here when something needs you.", "O Focus Diff vai te avisar aqui quando algo precisar de você."), sound);
}

#[tauri::command]
fn reviewed(app: AppHandle, watch: State<'_, watch::Watch>, pr_id: String) {
    watch.reviewed(&app, &pr_id);
}

#[tauri::command]
fn restore(app: AppHandle, watch: State<'_, watch::Watch>, queue_id: String, pr_id: String) {
    watch.restore(&app, &queue_id, &pr_id);
}

/// The panel's End on a review time under way.
#[tauri::command]
fn end_review(watch: State<'_, watch::Watch>) {
    watch.end_review();
}

#[tauri::command]
fn clear_arrival(app: AppHandle, watch: State<'_, watch::Watch>, pr_id: String) {
    watch.clear_arrival(&app, &pr_id);
}

// MARK: GitHub

#[derive(Serialize)]
struct Response {
    status: u16,
    body: String,
}

#[tauri::command]
async fn github(auth: State<'_, github::Auth>, method: String, path: String, body: Option<String>, accept: Option<String>) -> Result<Response, String> {
    let (status, body) = auth.request_for_page(&method, &path, body.as_deref(), accept.as_deref())?;
    Ok(Response { status, body })
}

/// A file at a commit (blobs.rs), as bytes; "absent" when it isn't there.
#[tauri::command]
async fn github_file(app: AppHandle, auth: State<'_, github::Auth>, repo: String, sha: String, path: String) -> Result<tauri::ipc::Response, String> {
    match blobs::file_at(&app, &auth, &repo, &sha, &path)? {
        Some(bytes) => Ok(tauri::ipc::Response::new(bytes)),
        None => Err(blobs::ABSENT.into()),
    }
}

/// A GitHub Actions job's log (logs.rs): its end, when it's long.
#[tauri::command]
async fn job_log(auth: State<'_, github::Auth>, logs: State<'_, logs::Logs>, owner: String, repo: String, job: u64, done: bool) -> Result<logs::Log, String> {
    logs::job_log(&auth, &logs, &owner, &repo, job, done)
}

/// Marks a file viewed, or not, on github.com, through the outbox: kept until GitHub takes it.
#[tauri::command]
fn queue_viewed(outbox: State<'_, outbox::Outbox>, pull: String, path: String, viewed: bool) {
    outbox.add(pull, path, viewed);
}

#[tauri::command]
fn queued_viewed(outbox: State<'_, outbox::Outbox>, pull: String) -> std::collections::HashMap<String, bool> {
    outbox.pending(&pull)
}

/// A comment written or edited for your pending review: kept until GitHub takes it (drafts.rs).
#[tauri::command]
fn drafts_put(drafts: State<'_, drafts::Drafts>, put: drafts::Put) {
    drafts.put(put);
}

#[tauri::command]
fn drafts_remove(drafts: State<'_, drafts::Drafts>, pull: String, key: String, id: Option<String>) {
    drafts.remove(pull, key, id);
}

/// A pull request's pending comments still on their way, and the ids of those that arrived.
#[tauri::command]
fn drafts_state(drafts: State<'_, drafts::Drafts>, pull: String) -> drafts::Pending {
    drafts.pending(&pull)
}

#[tauri::command]
fn drafts_retry(drafts: State<'_, drafts::Drafts>, pull: String) {
    drafts.retry(&pull);
}

#[tauri::command]
fn drafts_forget(drafts: State<'_, drafts::Drafts>, pull: String) {
    drafts.forget(&pull);
}

/// Waits for every pending comment to reach GitHub, before the review is submitted.
#[tauri::command]
async fn drafts_flush(app: AppHandle, pull: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<drafts::Drafts>().flush(&pull)).await.map_err(|e| e.to_string())?
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

// MARK: Attachments

/// Who's signed in on github.com for uploads (web.rs), if anyone.
#[tauri::command]
async fn github_web_session(web: State<'_, web::WebSession>) -> Result<Option<String>, String> {
    Ok(web.login())
}

/// Opens github.com's sign-in page in a window of its own; a "web-session" event says when it's done.
#[tauri::command]
fn sign_in_web(app: AppHandle) -> Result<(), String> {
    web::sign_in(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn sign_out_web(app: AppHandle) {
    web::sign_out(&app);
}

/// A picture or video for a comment, uploaded as github.com does (uploads.rs). The file's bytes
/// are the request's body; which pull request and its name come in its headers.
#[tauri::command]
async fn upload_attachment(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<uploads::Uploaded, uploads::Error> {
    let bad = || uploads::Error::Failed { message: "Bad request".into() };
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err(bad()) };
    let header = |name: &str| request.headers().get(name).and_then(|v| v.to_str().ok()).map(String::from);
    let (Some(repo), Some(number), Some(name)) = (header("x-repo"), header("x-number").and_then(|n| n.parse::<u64>().ok()), header("x-name")) else { return Err(bad()) };
    let Some((owner, repo)) = repo.split_once('/').map(|(o, r)| (o.to_string(), r.to_string())) else { return Err(bad()) };
    let name = media::decode(&name);
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || uploads::upload(&app, &owner, &repo, number, &name, &bytes)).await.map_err(|e| uploads::Error::Failed { message: e.to_string() })?
}

// MARK: AI (optional)

#[tauri::command]
async fn ai_statuses() -> Result<Vec<ai::Status>, String> {
    tauri::async_runtime::spawn_blocking(ai::statuses).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn ai_models(provider: ai::Provider) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || ai::models(provider)).await.map_err(|e| e.to_string())
}

/// The pull request whose code the AI may read.
#[derive(serde::Deserialize)]
struct Project {
    repo: String,
    number: u64,
    head: String,
}

#[derive(Serialize)]
struct Answer {
    text: String,
    /// Whether it could read the project, or only the diff, and why not.
    project: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    note: Option<String>,
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn ai_ask(app: AppHandle, provider: ai::Provider, model: Option<String>, effort: Option<String>, prompt: String, input: String, project: Option<Project>, schema: Option<String>, run: Option<String>) -> Result<Answer, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let run = run.filter(|r| r.len() <= 64 && r.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'));
        let cancel = run.as_deref().map(ai::start_run);
        // The project's code when asked for, if it's ready soon (it's fetched when the pull request
        // opens, see ai_prepare); the diff alone if it can't be had, or not yet: a big repository's
        // new commit can take minutes, and the answer shouldn't wait on it.
        let (folder, note) = match project {
            None => (None, None),
            Some(p) => match project_soon(&app, p) {
                Ok(folder) => (Some(folder), None),
                Err(Some(e)) => (None, Some(i18n::tr!("Read the diff only: couldn't get the project's code ({e})", "Leu só o diff: não foi possível obter o código do projeto ({e})"))),
                Err(None) => (None, Some(i18n::tr!("Read the diff only: the project's code is still downloading. Ask again in a moment to have it read too.", "Leu só o diff: o código do projeto ainda está baixando. Pergunte de novo daqui a pouco para ele ser lido também."))),
            },
        };
        let stopped = cancel.as_ref().is_some_and(|c| c.load(std::sync::atomic::Ordering::Relaxed));
        let text = if stopped {
            Err(i18n::tr!("Stopped", "Interrompido"))
        } else {
            ai::ask(ai::Question {
                provider,
                model: model.as_deref(),
                effort: effort.as_deref(),
                prompt: &prompt,
                input: &input,
                project: folder.as_deref(),
                schema: schema.as_deref(),
                cancel: cancel.as_deref(),
            })
        };
        if let Some(run) = &run {
            ai::end_run(run);
        }
        Ok(Answer { text: text?, project: folder.is_some(), note })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// How long a question waits for the project's code before answering from the diff.
const PROJECT_WAIT: std::time::Duration = std::time::Duration::from_secs(20);

/// The pull request's code checked out, if that's done within PROJECT_WAIT: Err(Some) when it
/// failed, Err(None) when it's still going (it carries on, for the next question).
fn project_soon(app: &AppHandle, p: Project) -> Result<std::path::PathBuf, Option<String>> {
    let token = app.state::<github::Auth>().token_for_git().map_err(Some)?;
    let cache = app.path().app_cache_dir().map_err(|e| Some(e.to_string()))?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(checkout::prepare(&cache, &token, &p.repo, p.number, &p.head));
    });
    match rx.recv_timeout(PROJECT_WAIT) {
        Ok(result) => result.map_err(Some),
        Err(_) => Err(None),
    }
}

/// Gets a pull request's code ready for questions about it, in the background (when its review
/// opens, with the AI set to read the project).
#[tauri::command]
fn ai_prepare(app: AppHandle, project: Project) {
    let Ok(token) = app.state::<github::Auth>().token_for_git() else { return };
    let Ok(cache) = app.path().app_cache_dir() else { return };
    std::thread::spawn(move || {
        let _ = checkout::prepare(&cache, &token, &project.repo, project.number, &project.head);
    });
}

/// Stops a question (the window's Stop button).
#[tauri::command]
fn ai_cancel(run: String) {
    ai::cancel(&run);
}

// MARK: Actions

#[tauri::command]
async fn run_action(app: AppHandle, action: String, name: String, step: usize, pr: actions::Context) -> Result<String, String> {
    let config = file_path(&app, "config")?;
    let trusted = config.with_file_name("allowed-commands.json");
    tauri::async_runtime::spawn_blocking(move || actions::run(&app, config, trusted, &action, &name, step, pr))
        .await
        .map_err(|e| e.to_string())?
}

// MARK: System

pub(crate) fn show_notification<R: Runtime>(app: &AppHandle<R>, title: String, body: String, sound: bool) {
    if cfg!(any(debug_assertions, feature = "devctl")) {
        eprintln!("[notify] {title} | {} | sound {sound}", body.replace('\n', " / "));
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        notify::show(&title, &body, sound);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let builder = app.notification().builder().title(title).body(body);
        let builder = if sound { builder.sound("default") } else { builder };
        let _ = builder.show();
    }
}

pub(crate) fn update_tray<R: Runtime>(app: &AppHandle<R>, count: u32, animate: bool) {
    if cfg!(any(debug_assertions, feature = "devctl")) {
        eprintln!("[tray] {count} waiting, animate {animate}");
    }
    if let Some(icon) = app.state::<Tray<R>>().0.lock().unwrap().as_ref() {
        tray::update(app, icon, count, animate);
    }
}

/// Review time's minutes left beside the tray icon, or none.
pub(crate) fn update_countdown<R: Runtime>(app: &AppHandle<R>, minutes: Option<i64>) {
    if cfg!(any(debug_assertions, feature = "devctl")) {
        eprintln!("[tray] countdown {minutes:?}");
    }
    if let Some(icon) = app.state::<Tray<R>>().0.lock().unwrap().as_ref() {
        tray::countdown(icon, minutes);
    }
}

/// The language picked in Settings (or the Mac's), for what Rust says: the menu bar, the tray and
/// the windows' titles say it again when it changes; notifications use it from then on.
fn apply_language<R: Runtime>(app: &AppHandle<R>, config: &str) {
    let before = i18n::current();
    i18n::apply_config(config);
    if i18n::current() == before {
        return;
    }
    menu::relocalize(app);
    if let Some(icon) = app.state::<Tray<R>>().0.lock().unwrap().as_ref() {
        tray::relocalize(icon);
    }
    if let Some(window) = app.get_webview_window(SETTINGS) {
        let _ = window.set_title(&settings_title());
    }
    if let Some(window) = app.get_webview_window(SETUP) {
        let _ = window.set_title(&setup_title());
    }
}

fn settings_title() -> String {
    i18n::tr!("Focus Diff Settings", "Ajustes do Focus Diff")
}

fn setup_title() -> String {
    i18n::tr!("Welcome to Focus Diff", "Boas-vindas ao Focus Diff")
}

/// Web links only, in the default browser.
#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(i18n::tr!("Only https links open", "Só links https abrem"));
    }
    // Straight to the app the page would only hand it on to, when it's here.
    let url = app_link(&url).filter(|link| can_open(link)).unwrap_or(url);
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// The app link behind a web page that only passes a link on to an app: Cursor Bugbot's "Fix in
/// Cursor" (cursor.com/open), which opens Cursor at cursor://anysphere.cursor-deeplink/createchat
/// with the same query, after a stop in the browser. Cursor checks what it's given itself.
fn app_link(url: &str) -> Option<String> {
    let rest = url.strip_prefix("https://cursor.com/open?").or_else(|| url.strip_prefix("https://www.cursor.com/open?"))?;
    let query = rest.split('#').next()?;
    let safe = query.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_.~=&%+/".contains(&b));
    let carries = query.split('&').any(|pair| pair.starts_with("link=") || pair.starts_with("data="));
    (safe && carries).then(|| format!("cursor://anysphere.cursor-deeplink/createchat?{query}"))
}

/// Whether some app on this Mac opens links like this one.
fn can_open(link: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::NSWorkspace;
        use objc2_foundation::{NSString, NSURL};
        NSURL::URLWithString(&NSString::from_str(link)).is_some_and(|url| NSWorkspace::sharedWorkspace().URLForApplicationToOpenURL(&url).is_some())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = link;
        false
    }
}

#[tauri::command]
fn open_settings(app: AppHandle) -> Result<(), String> {
    show_settings(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_setup(app: AppHandle) -> Result<(), String> {
    show_setup(&app).map_err(|e| e.to_string())
}

/// The panel under the tray icon, as a click on it would show it (from setup's last step).
#[tauri::command]
fn open_panel(app: AppHandle, tray: State<'_, Tray<tauri::Wry>>) -> Result<(), String> {
    let rect = tray.0.lock().unwrap().as_ref().and_then(|t| t.rect().ok().flatten());
    let Some(rect) = rect else { return Ok(()) };
    if app.get_webview_window(PANEL).is_some_and(|p| p.is_visible().unwrap_or(false)) {
        return Ok(());
    }
    toggle_panel(&app, &rect).map_err(|e| e.to_string())
}

/// Review windows: which pull request each shows, and the one made ahead of time, loaded and
/// hidden, so a click shows a pull request at once instead of starting a web view.
#[derive(Default)]
pub(crate) struct Reviews {
    open: Mutex<HashMap<String, String>>,
    spare: Mutex<Option<String>>,
    /// Spares whose page is loaded and listening for which pull request to show: one asked of
    /// before that would miss being told.
    ready: Mutex<HashSet<String>>,
}

/// The last copy kept of a pull request's review (kept.rs).
#[tauri::command]
async fn kept_read(app: AppHandle, id: String) -> Result<Option<String>, String> {
    kept::read(&app, &id)
}

#[tauri::command]
async fn kept_write(app: AppHandle, id: String, contents: String) -> Result<(), String> {
    kept::write(&app, &id, &contents)
}

/// A spare's page saying it's ready to be told which pull request to show.
#[tauri::command]
fn spare_ready(app: AppHandle, window: tauri::WebviewWindow) {
    app.state::<Reviews>().ready.lock().unwrap().insert(window.label().to_string());
}

static REVIEW_COUNTER: AtomicU64 = AtomicU64::new(0);

fn review_builder<'a, R: Runtime>(app: &'a AppHandle<R>, label: &str, url: String, title: &str) -> WebviewWindowBuilder<'a, R, AppHandle<R>> {
    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App(url.into())).title(title).min_inner_size(720.0, 480.0);
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    builder
}

/// Fills the main screen's usable area (not full screen).
fn fill_screen<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>) {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let area = monitor.work_area();
        let _ = window.set_position(area.position);
        let _ = window.set_size(area.size);
    }
}

/// Makes the spare review window, hidden, if there isn't one. Main thread.
fn prepare_spare<R: Runtime>(app: &AppHandle<R>) {
    let reviews = app.state::<Reviews>();
    if reviews.spare.lock().unwrap().is_some() {
        return;
    }
    let label = format!("review-{}", REVIEW_COUNTER.fetch_add(1, Ordering::SeqCst));
    if let Ok(window) = review_builder(app, &label, "review.html".into(), "Focus Diff").visible(false).build() {
        native_toolbar(&window);
        fill_screen(app, &window);
        *reviews.spare.lock().unwrap() = Some(label);
    }
}

/// Soon, off the click that asked: making a web view takes the main thread for a moment.
fn prepare_spare_soon<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(400));
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || prepare_spare(&handle));
    });
}

fn drop_spare<R: Runtime>(app: &AppHandle<R>) {
    if let Some(label) = app.state::<Reviews>().spare.lock().unwrap().take()
        && let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
}

/// In the Dock and the app switcher while a window of its own is open (a review, settings, setup);
/// only in the menu bar otherwise.
pub(crate) fn update_presence<R: Runtime>(app: &AppHandle<R>) {
    #[cfg(target_os = "macos")]
    {
        let spare = app.state::<Reviews>().spare.lock().unwrap().clone();
        let windowed = app.webview_windows().into_iter().any(|(label, w)| label != PANEL && Some(&label) != spare.as_ref() && w.is_visible().unwrap_or(false));
        let _ = app.set_activation_policy(if windowed { tauri::ActivationPolicy::Regular } else { tauri::ActivationPolicy::Accessory });
    }
}

#[derive(Clone, Serialize)]
struct ReviewTarget {
    id: String,
    repo: String,
    number: u64,
    teams: Vec<String>,
    /// The queue it was opened from, whose next one the window offers.
    queue: Option<String>,
}

/// Whether a pull request's id, repository, teams and queue are what GitHub and the app make: they
/// go into a window's address and events.
fn plausible(id: &str, repo: &str, teams: &[String], queue: Option<&str>) -> bool {
    let token = |s: &str| s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    let name = |s: &str| s.chars().all(|c| c.is_ascii_alphanumeric() || "-_./".contains(c));
    token(id) && name(repo) && teams.iter().all(|t| name(t)) && queue.is_none_or(token)
}

/// A pull request in its own window, one per pull request; opening one that's already open brings
/// it back.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn open_review(app: AppHandle, id: String, repo: String, number: u64, title: String, teams: Vec<String>, queue: Option<String>, from: Option<Card>) -> Result<(), String> {
    if !plausible(&id, &repo, &teams, queue.as_deref()) {
        return Err("Bad pull request".into());
    }
    let reviews = app.state::<Reviews>();
    let existing = reviews.open.lock().unwrap().get(&id).cloned();
    if let Some(window) = existing.and_then(|label| app.get_webview_window(&label)) {
        let _ = window.unminimize();
        window.show().map_err(|e| e.to_string())?;
        update_presence(&app);
        activate();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let target = ReviewTarget { id: id.clone(), repo: repo.clone(), number, teams: teams.clone(), queue: queue.clone() };
    // Only a spare that's listening; one still loading stays for the next click.
    let spare = {
        let mut spare = reviews.spare.lock().unwrap();
        let ready = spare.as_ref().is_some_and(|label| reviews.ready.lock().unwrap().remove(label));
        if ready { spare.take() } else { None }
    }
    .and_then(|label| app.get_webview_window(&label));
    let window = match spare {
        // The spare, already loaded: told which pull request it is now.
        Some(window) => {
            window.emit_to(window.label(), "review-open", target).map_err(|e| e.to_string())?;
            let _ = window.set_title(&title);
            window
        }
        None => {
            let encode = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
            let url = format!("review.html?id={}&repo={}&number={number}&teams={}&queue={}", encode(&id), encode(&repo), encode(&teams.join(",")), encode(queue.as_deref().unwrap_or("")));
            let label = format!("review-{}", REVIEW_COUNTER.fetch_add(1, Ordering::SeqCst));
            let window = review_builder(&app, &label, url, &title).build().map_err(|e| e.to_string())?;
            native_toolbar(&window);
            fill_screen(&app, &window);
            window
        }
    };
    reviews.open.lock().unwrap().insert(id, window.label().to_string());
    show_growing(&app, &window, from).map_err(|e| e.to_string())?;
    update_presence(&app);
    // The next one ready too, while the panel's in use.
    if app.get_webview_window(PANEL).is_some() {
        prepare_spare_soon(&app);
    }
    activate();
    window.set_focus().map_err(|e| e.to_string())
}


/// A review window moving on to the next pull request of its queue: the same window shows it, so
/// going through a queue leaves one window, not one per pull request. One already open in a window
/// of its own is brought forward instead.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn switch_review(app: AppHandle, window: tauri::WebviewWindow, id: String, repo: String, number: u64, title: String, teams: Vec<String>, queue: Option<String>) -> Result<(), String> {
    if !plausible(&id, &repo, &teams, queue.as_deref()) {
        return Err("Bad pull request".into());
    }
    let reviews = app.state::<Reviews>();
    let elsewhere = reviews.open.lock().unwrap().get(&id).cloned().filter(|label| label != window.label());
    if let Some(other) = elsewhere.and_then(|label| app.get_webview_window(&label)) {
        let _ = other.unminimize();
        other.show().map_err(|e| e.to_string())?;
        activate();
        return other.set_focus().map_err(|e| e.to_string());
    }
    {
        let mut open = reviews.open.lock().unwrap();
        open.retain(|_, label| label != window.label());
        open.insert(id.clone(), window.label().to_string());
    }
    let _ = window.set_title(&title);
    window.emit_to(window.label(), "review-open", ReviewTarget { id, repo, number, teams, queue }).map_err(|e| e.to_string())
}

/// The card a review was opened from, in the panel's points from its top left.
#[derive(Clone, Copy, serde::Deserialize)]
struct Card {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Shows a review window growing out of the card that was clicked to its full size, the way a Mac
/// window zooms from where it came from; with Reduce Motion it only fades in. Main thread.
fn show_growing<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>, from: Option<Card>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    if let (Some(card), Some(panel)) = (from, app.get_webview_window(PANEL)) {
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        let mut start = None;
        with_ns_window(&panel, |p| {
            // AppKit counts from the bottom left.
            let f = p.frame();
            start = Some(NSRect::new(NSPoint::new(f.origin.x + card.x, f.origin.y + f.size.height - card.y - card.height), NSSize::new(card.width, card.height)));
        });
        if let Some(start) = start {
            with_ns_window(window, |w| w.setAlphaValue(0.0));
            window.show()?;
            let mut target = None;
            with_ns_window(window, |w| target = Some(w.frame()));
            if let Some(target) = target {
                grow(app, window, start, target);
                return Ok(());
            }
        }
    }
    window.show()
}

// The stand-in that grows out of the card: a plain window-colored shape, so nothing has to lay out
// on the way. Kept here (main thread only) until the window it stood in for has faded in over it.
#[cfg(target_os = "macos")]
thread_local! {
    static STAND_IN: std::cell::RefCell<Option<objc2::rc::Retained<objc2_app_kit::NSWindow>>> = const { std::cell::RefCell::new(None) };
}

/// Grows a stand-in from the card to the review window's frame, then fades the review window in
/// over it (drawn by then, where it'll stay) and takes the stand-in away. Resizing the review window
/// itself would lay its page out again every frame. With Reduce Motion, only the fade.
#[cfg(target_os = "macos")]
fn grow<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>, from: objc2_foundation::NSRect, to: objc2_foundation::NSRect) {
    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext, NSAutoresizingMaskOptions, NSBackingStoreType, NSBox, NSBoxType, NSColor, NSTitlePosition, NSWindow, NSWindowStyleMask, NSWorkspace};
    use objc2_quartz_core::CAMediaTimingFunction;
    const GROW: f64 = 0.34;
    const FADE: f64 = 0.14;

    let fade_in = |window: &tauri::WebviewWindow<R>, duration: f64| {
        with_ns_window(window, |w| {
            NSAnimationContext::beginGrouping();
            NSAnimationContext::currentContext().setDuration(duration);
            w.animator().setAlphaValue(1.0);
            NSAnimationContext::endGrouping();
        });
    };
    let Some(main) = objc2::MainThreadMarker::new() else { return fade_in(window, FADE) };
    if NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceMotion() {
        return fade_in(window, 0.2);
    }

    // SAFETY: a new borderless window on the main thread, kept alive by STAND_IN (not released on close).
    let stand_in = unsafe { NSWindow::initWithContentRect_styleMask_backing_defer(main.alloc::<NSWindow>(), from, NSWindowStyleMask::Borderless, NSBackingStoreType::Buffered, false) };
    unsafe { stand_in.setReleasedWhenClosed(false) };
    stand_in.setOpaque(false);
    stand_in.setBackgroundColor(Some(&NSColor::clearColor()));
    stand_in.setHasShadow(true);
    stand_in.setIgnoresMouseEvents(true);
    let shape = NSBox::initWithFrame(main.alloc::<NSBox>(), objc2_foundation::NSRect::new(objc2_foundation::NSPoint::new(0.0, 0.0), from.size));
    shape.setBoxType(NSBoxType::Custom);
    shape.setTitlePosition(NSTitlePosition::NoTitle);
    shape.setBorderWidth(0.0);
    shape.setCornerRadius(14.0);
    shape.setFillColor(&NSColor::windowBackgroundColor());
    shape.setContentViewMargins(objc2_foundation::NSSize::new(0.0, 0.0));
    shape.setAutoresizingMask(NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable);
    stand_in.setContentView(Some(&shape));
    // Over the review window, which is up already but still clear.
    stand_in.orderFront(None);

    NSAnimationContext::beginGrouping();
    let context = NSAnimationContext::currentContext();
    context.setDuration(GROW);
    // Quick out of the card, settling gently: the curve the app's own transitions use.
    context.setTimingFunction(Some(&CAMediaTimingFunction::functionWithControlPoints(0.16, 1.0, 0.3, 1.0)));
    stand_in.animator().setFrame_display(to, true);
    NSAnimationContext::endGrouping();
    STAND_IN.with(|s| {
        if let Some(old) = s.borrow_mut().replace(stand_in) {
            old.orderOut(None);
        }
    });

    let (app, window) = (app.clone(), window.clone());
    thread::spawn(move || {
        thread::sleep(Duration::from_secs_f64(GROW * 0.85));
        let w = window.clone();
        let _ = app.run_on_main_thread(move || fade_in(&w, FADE));
        thread::sleep(Duration::from_secs_f64(FADE + 0.05));
        let _ = app.run_on_main_thread(|| STAND_IN.with(|s| s.borrow_mut().take().map(|w| w.orderOut(None))).unwrap_or_default());
    });
}

#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<String>, String> {
    update::check(&app).await
}

#[tauri::command]
fn update_offered(app: AppHandle) -> Option<String> {
    update::offered(&app)
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    update::install(&app).await
}

#[tauri::command]
fn hide_panel(app: AppHandle) {
    hide(&app);
}

/// Development only: the web views' errors in the terminal that runs `tauri dev`.
#[tauri::command]
fn log(window: tauri::Window, message: String) {
    if cfg!(any(debug_assertions, feature = "devctl")) {
        eprintln!("[{}] {}", window.label(), message.chars().take(2000).collect::<String>());
    }
}

#[tauri::command]
fn quit(app: AppHandle) {
    app.exit(0);
}

// MARK: Windows

pub(crate) fn show_settings<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETTINGS) {
        window.show()?;
        return window.set_focus();
    }
    // The system's sidebar material behind the whole page: the sidebar floats over it as a pane of
    // glass, the desktop showing through, and the content side paints the window's own colour.
    let builder = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title(settings_title())
        .inner_size(880.0, 640.0)
        .min_inner_size(780.0, 540.0)
        .center()
        .transparent(true)
        .effects(WindowEffectsConfig {
            effects: vec![
                #[cfg(target_os = "macos")]
                Effect::Sidebar,
                #[cfg(windows)]
                Effect::Mica,
            ],
            state: Some(EffectState::FollowsWindowActiveState),
            radius: None,
            color: None,
            interactive: false,
        });
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay).hidden_title(true);
    let window = builder.build()?;
    native_toolbar(&window);
    update_presence(app);
    window.set_focus()
}

/// First run (or "Run setup again"): connect GitHub, pick queues, notifications, AI.
pub(crate) fn show_setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(SETUP) {
        window.show()?;
        return window.set_focus();
    }
    let window = WebviewWindowBuilder::new(app, SETUP, WebviewUrl::App("setup.html".into()))
        .title(setup_title())
        .inner_size(600.0, 640.0)
        .min_inner_size(520.0, 560.0)
        .center()
        .build()?;
    update_presence(app);
    window.set_focus()
}

/// The panel floats under the tray icon (over it, when the taskbar is at the bottom of the screen),
/// its leading edge on the icon's as a menu bar extra's menu is, kept inside the screen it's on.
fn place_panel<R: Runtime>(panel: &tauri::WebviewWindow<R>, rect: &Rect) -> tauri::Result<()> {
    // In points: with screens of different scales (a 1x display beside a Retina one) each screen's
    // "physical" coordinates use its own scale, so mixing them puts the panel off the icon. The
    // icon's rect comes scaled by its own screen's factor; the screen it's on is the one that
    // contains it once divided back.
    let (rx, ry, rw, rh) = match (rect.position, rect.size) {
        (tauri::Position::Physical(p), tauri::Size::Physical(s)) => (p.x as f64, p.y as f64, s.width as f64, s.height as f64),
        (position, size) => {
            let scale = panel.scale_factor()?;
            let (p, s) = (position.to_physical::<f64>(scale), size.to_physical::<f64>(scale));
            (p.x, p.y, s.width, s.height)
        }
    };
    let screens: Vec<(f64, f64, f64, f64, f64)> = panel
        .available_monitors()?
        .iter()
        .map(|m| {
            let (f, p, s) = (m.scale_factor(), m.position(), m.size());
            (f, p.x as f64 / f, p.y as f64 / f, s.width as f64 / f, s.height as f64 / f)
        })
        .collect();
    let (scale, mx, my, mw, mh) = screens
        .iter()
        .copied()
        .find(|&(f, x, y, w, h)| {
            let (cx, cy) = ((rx + rw / 2.0) / f, (ry + rh / 2.0) / f);
            cx >= x && cx < x + w && cy >= y - 50.0 && cy < y + h
        })
        .or_else(|| screens.first().copied())
        .unwrap_or((1.0, 0.0, 0.0, f64::MAX, f64::MAX));
    let (ix, iy, ih) = (rx / scale, ry / scale, rh / scale);
    let (width, height) = PANEL_SIZE;
    let gap = 6.0;
    let below = iy < my + mh / 2.0;
    let x = ix.clamp(mx + gap, mx + mw - width - gap);
    let y = if below { iy + ih + gap } else { iy - height - gap };
    panel.set_position(tauri::LogicalPosition::new(x.round(), y.round()))
}

/// Bumped whenever the panel shows or hides, so only the latest hide closes it.
static PANEL_GENERATION: AtomicU64 = AtomicU64::new(0);

pub(crate) fn hide<R: Runtime>(app: &AppHandle<R>) {
    let Some(panel) = app.get_webview_window(PANEL) else { return };
    let _ = panel.hide();
    let generation = PANEL_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(PANEL_KEEP);
        if PANEL_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        if let Some(panel) = app.get_webview_window(PANEL)
            && !panel.is_visible().unwrap_or(true) {
                // Back to the window Tauri made before it's taken apart (floating.rs).
                let _ = app.run_on_main_thread(move || {
                    #[cfg(target_os = "macos")]
                    // SAFETY: the live panel window, on the main thread.
                    with_ns_window(&panel, |ns| unsafe { floating::unmake(ns) });
                    let _ = panel.destroy();
                });
                drop_spare(&app);
            }
    });
}

pub(crate) fn toggle_panel<R: Runtime>(app: &AppHandle<R>, rect: &Rect) -> tauri::Result<()> {
    let panel = match app.get_webview_window(PANEL) {
        Some(panel) if panel.is_visible()? => {
            hide(app);
            return Ok(());
        }
        Some(panel) => panel,
        None => create_panel(app)?,
    };
    PANEL_GENERATION.fetch_add(1, Ordering::SeqCst);
    place_panel(&panel, rect)?;
    panel.show()?;
    // A non-activating panel takes the keyboard without the app being made active, which macOS
    // won't do from a tray click (floating.rs).
    #[cfg(target_os = "macos")]
    with_ns_window(&panel, floating::show);
    #[cfg(not(target_os = "macos"))]
    panel.set_focus()?;
    let _ = panel.emit("panel-shown", ());
    reshadow(app, &panel);
    keep_focus(app, &panel);
    prepare_spare_soon(app);
    Ok(())
}

/// Makes Focus Diff the active app, so the panel takes the keyboard and closes when you click
/// elsewhere. The older call Tauri makes is only a request on current macOS and is often ignored
/// for an app without a Dock icon.
fn activate() {
    #[cfg(target_os = "macos")]
    if let Some(main) = objc2::MainThreadMarker::new() {
        objc2_app_kit::NSApplication::sharedApplication(main).activate();
    }
}

/// The page draws the window's toolbar under a see-through title bar. An empty native toolbar
/// makes that bar the toolbar's height, so macOS itself centres the window buttons in it (as in
/// Finder or Mail) rather than leaving them up at the top; the page's bar is TOOLBAR tall.
fn native_toolbar<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let window = window.clone();
        let _ = window.clone().run_on_main_thread(move || {
            let Some(main) = objc2::MainThreadMarker::new() else { return };
            let Ok(pointer) = window.ns_window() else { return };
            // SAFETY: Tauri's live NSWindow, on the main thread.
            let ns = unsafe { &*(pointer as *const objc2_app_kit::NSWindow) };
            ns.setToolbar(Some(&objc2_app_kit::NSToolbar::new(main)));
            ns.setToolbarStyle(objc2_app_kit::NSWindowToolbarStyle::Unified);
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

/// macOS can turn an activation down, or finish it only after the panel was shown, leaving the
/// panel up but not taking the keyboard or the pointer's hover until it's clicked. Asked once more,
/// shortly after, if that's what happened.
fn keep_focus<R: Runtime>(app: &AppHandle<R>, panel: &tauri::WebviewWindow<R>) {
    let (app, panel) = (app.clone(), panel.clone());
    thread::spawn(move || {
        for wait in [60, 200] {
            thread::sleep(Duration::from_millis(wait));
            let panel = panel.clone();
            let _ = app.run_on_main_thread(move || {
                if panel.is_visible().unwrap_or(false) && !panel.is_focused().unwrap_or(true) {
                    #[cfg(target_os = "macos")]
                    with_ns_window(&panel, floating::show);
                    #[cfg(not(target_os = "macos"))]
                    let _ = panel.set_focus();
                }
            });
        }
    });
}

/// The panel's NSWindow, for what Tauri doesn't do (floating.rs). On the main thread only.
#[cfg(target_os = "macos")]
fn with_ns_window<R: Runtime>(window: &tauri::WebviewWindow<R>, f: impl FnOnce(&objc2_app_kit::NSWindow)) {
    if objc2::MainThreadMarker::new().is_none() {
        return;
    }
    if let Ok(pointer) = window.ns_window() {
        // SAFETY: Tauri's live NSWindow, on the main thread (checked above).
        f(unsafe { &*(pointer as *const objc2_app_kit::NSWindow) });
    }
}

/// Whether Focus Diff is the active app (for devctl).
#[cfg(any(debug_assertions, feature = "devctl"))]
pub(crate) fn is_active() -> bool {
    #[cfg(target_os = "macos")]
    if let Some(main) = objc2::MainThreadMarker::new() {
        return objc2_app_kit::NSApplication::sharedApplication(main).isActive();
    }
    false
}

/// The shadow of a see-through window follows what was drawn when it was worked out; worked out
/// before the page drew its rounded corners, it's a rectangle that squares them off. Worked out
/// again now and once the page has drawn.
fn reshadow<R: Runtime>(app: &AppHandle<R>, window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    {
        let now = |window: &tauri::WebviewWindow<R>| {
            if let Ok(pointer) = window.ns_window() {
                // SAFETY: Tauri hands out its live NSWindow; this runs on the main thread.
                unsafe { (*(pointer as *const objc2_app_kit::NSWindow)).invalidateShadow() };
            }
        };
        now(window);
        let (app, window) = (app.clone(), window.clone());
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(150));
            let _ = app.run_on_main_thread(move || now(&window));
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, window);
}

fn create_panel<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::WebviewWindow<R>> {
    let builder = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("index.html".into()))
        .title("Focus Diff")
        .inner_size(PANEL_SIZE.0, PANEL_SIZE.1)
        .resizable(false)
        .decorations(false)
        // A click on a row opens it even while the app isn't the active one, instead of only
        // activating it.
        .accept_first_mouse(true)
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
            radius: Some(PANEL_RADIUS),
            color: None,
            interactive: false,
        });
    let panel = builder.build()?;
    #[cfg(target_os = "macos")]
    // SAFETY: the window Tauri just made, on the main thread (with_ns_window checks).
    with_ns_window(&panel, |ns| unsafe { floating::make(ns) });
    Ok(panel)
}

fn create_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    tray::prepare();
    let builder = TrayIconBuilder::with_id("main")
        .icon(tray::frame(0.0, false))
        .tooltip("Focus Diff")
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

/// Before the rename to Focus Diff the app's folder was com.focusdiff.pro: its files move over once.
fn move_old_files<R: Runtime>(app: &AppHandle<R>) {
    let Ok(dir) = app.path().app_config_dir() else { return };
    let old = dir.with_file_name("com.focusdiff.pro");
    // A folder without state.json hasn't been used yet (at most a default config.json was written).
    if dir.join("state.json").exists() || !old.is_dir() {
        return;
    }
    if fs::create_dir_all(&dir).is_ok() {
        for name in ["config.json", "state.json", "auth.json", "allowed-commands.json"] {
            let _ = fs::copy(old.join(name), dir.join(name));
        }
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(menu::on_event)
        .register_asynchronous_uri_scheme_protocol("avatar", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            thread::spawn(move || responder.respond(avatars::serve(&app, &request)));
        })
        .register_asynchronous_uri_scheme_protocol("media", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            thread::spawn(move || responder.respond(media::serve(&app, &request)));
        })
        .manage(update::Pending::default())
        .manage(github::Auth::default())
        .manage(logs::Logs::default())
        .manage(web::WebSession::default())
        .manage(Tray::<tauri::Wry>(Mutex::new(None)))
        .manage(Reviews::default())
        .invoke_handler(tauri::generate_handler![
            queue_viewed,
            queued_viewed,
            drafts_put,
            drafts_remove,
            drafts_state,
            drafts_retry,
            drafts_forget,
            drafts_flush,
            read_file,
            write_file,
            snapshot,
            refresh,
            mark_seen,
            mark_queue_seen,
            dismiss,
            reviewed,
            test_notification,
            restore,
            end_review,
            clear_arrival,
            github,
            github_file,
            job_log,
            spare_ready,
            kept_read,
            kept_write,
            auth_status,
            auth_use_gh,
            auth_use_token,
            auth_device_start,
            auth_device_finish,
            auth_sign_out,
            github_web_session,
            sign_in_web,
            sign_out_web,
            upload_attachment,
            ai_statuses,
            ai_models,
            ai_ask,
            ai_prepare,
            ai_cancel,
            run_action,
            open_url,
            open_settings,
            open_setup,
            open_panel,
            check_update,
            update_offered,
            install_update,
            open_review,
            switch_review,
            hide_panel,
            log,
            quit,
            menu::confirm,
            menu::menu_state,
        ])
        .setup(|app| {
            // A tray app: no Dock icon, no app switcher entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            // The system asks the first time whether Focus Diff may notify.
            #[cfg(target_os = "macos")]
            notify::ask();

            let handle = app.handle().clone();
            move_old_files(&handle);
            // The theme and language picked last time, before any window or menu shows.
            match read_file(handle.clone(), "config") {
                Ok(Some(text)) => {
                    menu::apply_theme(&handle, &text);
                    i18n::apply_config(&text);
                }
                _ => i18n::apply_config(""),
            }
            #[cfg(target_os = "macos")]
            {
                let (bar, items) = menu::build(&handle)?;
                app.set_menu(bar)?;
                app.manage(items);
            }
            // Where GitHub's token comes from, as chosen last time.
            if let Ok(Some(text)) = read_file(handle.clone(), "auth") {
                let source = serde_json::from_str::<serde_json::Value>(&text)
                    .ok()
                    .and_then(|v| serde_json::from_value::<Option<github::Source>>(v["source"].clone()).ok())
                    .flatten();
                app.state::<github::Auth>().set_source(source);
            }

            let icon = create_tray(&handle)?;
            *app.state::<Tray<tauri::Wry>>().0.lock().unwrap() = Some(icon);
            app.manage(watch::Watch::start(&handle));
            app.manage(outbox::Outbox::start(&handle));
            app.manage(drafts::Drafts::start(&handle));
            update::watch(&handle);
            #[cfg(any(debug_assertions, feature = "devctl"))]
            devctl::start(&handle);
            if let Ok(cache) = handle.path().app_cache_dir() {
                let app = handle.clone();
                thread::spawn(move || {
                    checkout::sweep(&cache);
                    avatars::sweep(&app);
                    media::sweep(&app);
                    kept::sweep(&app);
                    blobs::sweep(&app);
                });
            }
            // No setup yet: the first thing to see is how to start.
            if file_path(&handle, "config").is_ok_and(|p| !p.exists()) {
                show_setup(&handle)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // The panel goes away when you click elsewhere, like a menu.
            if window.label() == PANEL
                && let WindowEvent::Focused(false) = event {
                    hide(window.app_handle());
                }
            if let WindowEvent::Focused(true) = event {
                menu::focused(window.app_handle(), window.label());
            }
            if let WindowEvent::Destroyed = event {
                let app = window.app_handle();
                let label = window.label().to_string();
                menu::forget(app, &label);
                app.state::<Reviews>().open.lock().unwrap().retain(|_, l| *l != label);
                app.state::<Reviews>().ready.lock().unwrap().remove(&label);
                {
                    let reviews = app.state::<Reviews>();
                    let mut spare = reviews.spare.lock().unwrap();
                    if spare.as_deref() == Some(label.as_str()) {
                        *spare = None;
                    }
                }
                update_presence(app);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running Focus Diff")
        .run(|_, event| {
            // A tray app lives on with no window open (the panel's web view is closed when it's
            // not in use): only Quit, which exits with a code, ends it.
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = event {
                api.prevent_exit();
            }
        });
}

#[cfg(test)]
mod tests {
    use super::app_link;

    #[test]
    fn fix_in_cursor_opens_cursor() {
        assert_eq!(app_link("https://cursor.com/open?link=eyJ2Zm9v").as_deref(), Some("cursor://anysphere.cursor-deeplink/createchat?link=eyJ2Zm9v"));
        assert_eq!(app_link("https://www.cursor.com/open?data=a%2Bb&bugId=1").as_deref(), Some("cursor://anysphere.cursor-deeplink/createchat?data=a%2Bb&bugId=1"));
    }

    #[test]
    fn other_links_stay_web_links() {
        assert_eq!(app_link("https://cursor.com/agents?link=eyJ2"), None);
        assert_eq!(app_link("https://cursor.com/open?x=1"), None);
        assert_eq!(app_link("https://cursor.com/open?link=a\"b"), None);
        assert_eq!(app_link("https://evil.com/open?link=a"), None);
        assert_eq!(app_link("https://cursor.com.evil.com/open?link=a"), None);
    }
}
