//! The app's live state, kept here rather than in a web view so the panel can be closed while
//! hidden: refreshes the queues on the configured rhythm, remembers what's been seen, notifies,
//! and keeps the tray icon current. The panel reads it as a snapshot and follows its changes.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::config::Config;
use crate::engine::{self, Cache, CiMemo, Failure, Gql, Item};
use crate::github;

/// Every pull request in full again this often, changed or not: a safety net for what GitHub
/// doesn't count as an update.
const FULL_EVERY: i64 = 20 * 60_000;
const MAX_NOTIFICATIONS: usize = 4;

pub enum Message {
    Refresh { force: bool },
    /// config.json changed.
    Config,
    /// Signed in or out.
    Auth,
}

/// What's remembered between launches (state.json).
#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Persisted {
    /// Event keys of cards you clicked.
    seen: HashMap<String, bool>,
    /// Every event key last time, to tell what's new. None before the first refresh.
    keys: Option<Vec<String>>,
    ci: HashMap<String, CiMemo>,
    /// "queueId:prId" taken off a queue by hand: merged ones marked as seen, others ignored.
    dismissed: HashMap<String, bool>,
    /// Each queue's search last time: a queue that's new or searches differently starts quietly,
    /// its first results the baseline rather than a burst of notifications.
    searches: HashMap<String, String>,
}

/// A queue's search without the date a merged queue moves along each day.
fn search_key(search: &str) -> String {
    search.split(' ').filter(|p| !p.starts_with("merged:>=")).collect::<Vec<_>>().join(" ")
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    updated_at: i64,
}

struct State {
    ready: bool,
    config: Option<Config>,
    me: Option<String>,
    cache: Cache,
    persisted: Persisted,
    items: Vec<(String, Vec<Item>)>,
    status: Status,
    /// Pull request ids with something new to call out, until the panel shows them.
    arrivals: HashSet<String>,
    last_count: Option<usize>,
    /// GitHub couldn't be reached to tell who's signed in: asked again before the next refresh.
    auth_unknown: bool,
    /// GitHub asked to slow down: no refresh before this (ms), and how long the last wait was.
    retry_at: i64,
    backoff: i64,
}

const FIRST_BACKOFF: i64 = 5 * 60_000;
const LONGEST_BACKOFF: i64 = 30 * 60_000;

pub struct Watch {
    sender: Sender<Message>,
    state: Arc<Mutex<State>>,
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or_default()
}

/// GitHub's GraphQL API, through the signed-in token.
struct Github<'a>(&'a github::Auth);

impl Gql for Github<'_> {
    fn query(&self, query: &str, variables: Value) -> Result<Value, Failure> {
        let body = json!({ "query": query, "variables": variables }).to_string();
        let (status, text) = self.0.request("POST", "/graphql", Some(&body), None).map_err(|message| Failure { status: 0, message })?;
        let mut reply: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
        if status >= 400 {
            let message = reply["message"].as_str().map(String::from).unwrap_or_else(|| format!("GitHub returned {status}"));
            return Err(Failure { status, message });
        }
        if reply["data"].is_null() {
            let message = reply["errors"][0]["message"].as_str().unwrap_or("GitHub returned no data").to_string();
            return Err(Failure { status: 200, message });
        }
        Ok(reply["data"].take())
    }
}

// MARK: Files

fn config_dir<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn cache_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("cache.json"))
}

fn read<T: for<'de> Deserialize<'de>>(path: Option<PathBuf>) -> Option<T> {
    serde_json::from_str(&fs::read_to_string(path?).ok()?).ok()
}

/// Written next to the file and moved into place, so a crash mid-write never leaves half a file.
fn write(path: Option<PathBuf>, contents: &str) {
    let Some(path) = path else { return };
    let temporary = path.with_extension("tmp");
    if fs::write(&temporary, contents).is_ok() {
        let _ = fs::rename(&temporary, &path);
    }
}

fn read_config<R: Runtime>(app: &AppHandle<R>) -> Option<Config> {
    Config::parse(&fs::read_to_string(config_dir(app)?.join("config.json")).ok()?)
}

// MARK: Words

fn first_name(actor: Option<&engine::Actor>) -> String {
    actor
        .and_then(|a| a.name.as_deref().and_then(|n| n.split_whitespace().next()).map(String::from).or_else(|| (!a.login.is_empty()).then(|| a.login.clone())))
        .unwrap_or_else(|| "Someone".into())
}

fn say(kind: &str, who: &str) -> String {
    match kind {
        "new" => "New in your queue".into(),
        "commits" => format!("{who} pushed changes"),
        "reply" => format!("{who} replied to you"),
        "mention" => format!("{who} mentioned you"),
        "comment" => format!("{who} commented"),
        "rerequest" => "Your review was requested again".into(),
        "approved" => format!("{who} approved"),
        "changes" => format!("{who} requested changes"),
        "ci-failed" => "CI failed".into(),
        "ci-passed" => "CI passed".into(),
        "conflict" => "Merge conflict".into(),
        _ => "Something happened".into(),
    }
}

impl State {
    fn unread(&self, item: &Item) -> bool {
        item.events.iter().any(|e| !self.persisted.seen.contains_key(&e.key))
    }

    fn snapshot(&self) -> Value {
        let items: serde_json::Map<String, Value> = self.items.iter().map(|(id, items)| (id.clone(), serde_json::to_value(items).unwrap_or_default())).collect();
        json!({
            "ready": self.ready,
            "signedIn": self.me.is_some(),
            "me": self.me,
            "items": items,
            "status": self.status,
            "arrivals": self.arrivals,
            "seen": self.persisted.seen,
            "dismissed": self.persisted.dismissed,
        })
    }

    fn find(&self, queue_id: &str, pr_id: &str) -> Option<&Item> {
        self.items.iter().find(|(id, _)| id == queue_id)?.1.iter().find(|i| i.pr.id == pr_id)
    }
}

impl Watch {
    pub fn start<R: Runtime>(app: &AppHandle<R>) -> Watch {
        let (sender, receiver) = mpsc::channel();
        let state = Arc::new(Mutex::new(State {
            ready: false,
            config: None,
            me: None,
            cache: Cache::default(),
            persisted: Persisted::default(),
            items: vec![],
            status: Status { phase: "idle", error: None, updated_at: 0 },
            arrivals: HashSet::new(),
            last_count: None,
            auth_unknown: false,
            retry_at: 0,
            backoff: 0,
        }));
        let watch = Watch { sender, state: state.clone() };
        let app = app.clone();
        std::thread::spawn(move || {
            let worker = Worker { app, state };
            worker.boot();
            loop {
                let wait = Duration::from_secs(worker.state.lock().unwrap().config.as_ref().map_or(60, |c| c.poll_seconds));
                let first = match receiver.recv_timeout(wait) {
                    Ok(message) => message,
                    Err(RecvTimeoutError::Timeout) => Message::Refresh { force: false },
                    Err(RecvTimeoutError::Disconnected) => return,
                };
                // Several requests that piled up during a refresh make one.
                let (mut force, mut config, mut auth) = (false, false, false);
                for message in std::iter::once(first).chain(receiver.try_iter()) {
                    match message {
                        Message::Refresh { force: f } => force |= f,
                        Message::Config => config = true,
                        Message::Auth => auth = true,
                    }
                }
                if auth {
                    worker.check_auth();
                }
                if config {
                    worker.reload_config();
                }
                worker.refresh(force || config || auth);
            }
        });
        watch
    }

    pub fn send(&self, message: Message) {
        let _ = self.sender.send(message);
    }

    pub fn snapshot(&self) -> Value {
        self.state.lock().unwrap().snapshot()
    }

    /// Runs `change` on the state, then saves, updates the tray and tells the panel.
    fn change<R: Runtime>(&self, app: &AppHandle<R>, change: impl FnOnce(&mut State)) {
        let worker = Worker { app: app.clone(), state: self.state.clone() };
        {
            let mut state = self.state.lock().unwrap();
            change(&mut state);
            worker.save_state(&state);
            worker.update_tray(&mut state, false);
        }
        worker.publish();
    }

    /// Clicking a card counts as having looked at it.
    pub fn mark_seen<R: Runtime>(&self, app: &AppHandle<R>, queue_id: &str, pr_id: &str) {
        self.change(app, |state| {
            let keys: Vec<String> = state.find(queue_id, pr_id).map(|i| i.events.iter().map(|e| e.key.clone()).collect()).unwrap_or_default();
            for key in keys {
                state.persisted.seen.insert(key, true);
            }
            state.arrivals.remove(pr_id);
        });
    }

    pub fn mark_queue_seen<R: Runtime>(&self, app: &AppHandle<R>, queue_id: &str) {
        self.change(app, |state| {
            let keys: Vec<String> = state.items.iter().filter(|(id, _)| id == queue_id).flat_map(|(_, items)| items.iter().flat_map(|i| i.events.iter().map(|e| e.key.clone()))).collect();
            for key in keys {
                state.persisted.seen.insert(key, true);
            }
        });
    }

    /// Takes a pull request off a queue by hand (merged: seen; others: ignored), until it leaves
    /// the queue's search.
    pub fn dismiss<R: Runtime>(&self, app: &AppHandle<R>, queue_id: &str, pr_id: &str) {
        self.change(app, |state| {
            let keys: Vec<String> = state.find(queue_id, pr_id).map(|i| i.events.iter().map(|e| e.key.clone()).collect()).unwrap_or_default();
            for key in keys {
                state.persisted.seen.insert(key, true);
            }
            state.persisted.dismissed.insert(format!("{queue_id}:{pr_id}"), true);
            state.arrivals.remove(pr_id);
            for (id, items) in &mut state.items {
                if id == queue_id {
                    items.retain(|i| i.pr.id != pr_id);
                }
            }
        });
    }

    /// Development only (devctl): forgets having seen the latest events of `n` pull requests, so
    /// the next refresh finds them new.
    #[cfg(any(debug_assertions, feature = "devctl"))]
    pub fn forget(&self, n: usize) -> Vec<String> {
        let mut state = self.state.lock().unwrap();
        let picked: Vec<(String, Vec<String>)> = state
            .items
            .iter()
            .flat_map(|(_, items)| items.iter())
            .filter(|i| i.events.iter().any(|e| e.kind != engine::NEW))
            .take(n)
            .map(|i| (i.pr.title.clone(), i.events.iter().filter(|e| e.kind != engine::NEW).map(|e| e.key.clone()).collect()))
            .collect();
        let forget: HashSet<String> = picked.iter().flat_map(|(_, keys)| keys.iter().cloned()).collect();
        if let Some(keys) = &mut state.persisted.keys {
            keys.retain(|k| !forget.contains(k));
        }
        state.persisted.seen.retain(|k, _| !forget.contains(k));
        picked.into_iter().map(|(title, _)| title).collect()
    }

    pub fn clear_arrival<R: Runtime>(&self, app: &AppHandle<R>, pr_id: &str) {
        let removed = self.state.lock().unwrap().arrivals.remove(pr_id);
        if removed {
            Worker { app: app.clone(), state: self.state.clone() }.publish();
        }
    }
}

/// The refreshing thread's side.
struct Worker<R: Runtime> {
    app: AppHandle<R>,
    state: Arc<Mutex<State>>,
}

impl<R: Runtime> Worker<R> {
    /// Last launch's state and pull requests first, so the panel has something to show at once;
    /// then who's signed in, then GitHub.
    fn boot(&self) {
        {
            let mut state = self.state.lock().unwrap();
            state.persisted = read(config_dir(&self.app).map(|d| d.join("state.json"))).unwrap_or_default();
            state.config = read_config(&self.app);
            if let Some(cache) = read::<Cache>(cache_file(&self.app)).filter(|c| c.version == engine::CACHE_VERSION) {
                if !cache.me.is_empty() {
                    state.me = Some(cache.me.clone());
                }
                state.cache = cache;
                self.apply(&mut state);
            }
            state.ready = true;
        }
        self.publish();
        self.check_auth();
        self.refresh(true);
    }

    fn check_auth(&self) {
        let auth = self.app.state::<github::Auth>();
        match auth.login() {
            Ok(login) => {
                let mut state = self.state.lock().unwrap();
                state.auth_unknown = false;
                if state.me != login {
                    state.me = login;
                    state.items.clear();
                    state.arrivals.clear();
                    state.status = Status { phase: "idle", error: None, updated_at: 0 };
                    self.update_tray(&mut state, false);
                }
            }
            // Offline: keep last launch's account and try again on the next refresh.
            Err(message) => {
                let mut state = self.state.lock().unwrap();
                state.auth_unknown = true;
                state.status = Status { phase: "error", error: Some(message), updated_at: state.status.updated_at };
            }
        }
        self.publish();
    }

    fn reload_config(&self) {
        let mut state = self.state.lock().unwrap();
        state.config = read_config(&self.app);
        // The new rules on what's known already, before GitHub answers.
        self.apply(&mut state);
        drop(state);
        self.publish();
    }

    fn refresh(&self, force: bool) {
        let auth_unknown = self.state.lock().unwrap().auth_unknown;
        if auth_unknown {
            self.check_auth();
        }
        let (config, me, mut cache, full) = {
            let mut state = self.state.lock().unwrap();
            let (Some(config), Some(me)) = (state.config.clone(), state.me.clone()) else { return };
            if state.auth_unknown || now() < state.retry_at {
                return;
            }
            let fresh = now() - state.status.updated_at < (config.poll_seconds * 1000) as i64 - 5_000;
            if !force && fresh && state.status.phase != "error" {
                return;
            }
            state.status.phase = "loading";
            let full = now() - state.cache.full_at > FULL_EVERY;
            (config, me, std::mem::take(&mut state.cache), full)
        };
        self.publish();

        let auth = self.app.state::<github::Auth>();
        let queues: Vec<&crate::config::Queue> = config.enabled().collect();
        let started = std::time::Instant::now();
        let result = engine::sync(&Github(&auth), &queues, &me, &mut cache, force, full, now());
        if cfg!(any(debug_assertions, feature = "devctl")) {
            let fetched = result.as_ref().map(|n| n.to_string()).unwrap_or_else(|e| e.message.clone());
            eprintln!("[watch] refresh (force {force}, full {full}) in {:?}: {fetched} fetched in full, {} known", started.elapsed(), cache.prs.len());
        }

        let mut state = self.state.lock().unwrap();
        state.cache = cache;
        match result {
            Ok(_) => {
                state.backoff = 0;
                if full {
                    state.cache.full_at = now();
                }
                state.status = Status { phase: "idle", error: None, updated_at: now() };
                self.apply(&mut state);
                write(cache_file(&self.app), &serde_json::to_string(&state.cache).unwrap_or_default());
            }
            Err(failure) => {
                // What came in before GitHub refused is kept (the cache was updated as it went).
                write(cache_file(&self.app), &serde_json::to_string(&state.cache).unwrap_or_default());
                let message = if failure.status == 401 {
                    "GitHub signed you out".to_string()
                } else if failure.rate_limited() {
                    // Waiting longer each time it asks again, up to half an hour.
                    state.backoff = (state.backoff * 2).clamp(FIRST_BACKOFF, LONGEST_BACKOFF);
                    state.retry_at = now() + state.backoff;
                    format!("GitHub asked Focus Diff to slow down: trying again in {} minutes", state.backoff / 60_000)
                } else {
                    failure.message
                };
                eprintln!("Refreshing failed: {message}");
                state.status = Status { phase: "error", error: Some(message), updated_at: state.status.updated_at };
                if failure.status == 401 {
                    drop(state);
                    self.check_auth();
                    return;
                }
            }
        }
        drop(state);
        self.publish();
    }

    /// The items of every queue from the cache, and what's new since last time.
    fn apply(&self, state: &mut State) {
        let (Some(config), Some(me)) = (state.config.clone(), state.me.clone()) else { return };
        let queues: Vec<&crate::config::Queue> = config.enabled().collect();
        let mut items = Vec::new();
        let mut problems = Vec::new();
        for queue in &queues {
            let Some(list) = state.cache.lists.get(&queue.id) else {
                items.push((queue.id.clone(), vec![]));
                continue;
            };
            let prs: Vec<Arc<engine::PullRequest>> = list.ids.iter().filter_map(|id| state.cache.prs.get(id)).map(|c| c.pr.clone()).collect();
            match engine::items_for(queue, &prs, &me, &state.persisted.ci) {
                Ok(found) => items.push((queue.id.clone(), found.into_iter().filter(|i| !state.persisted.dismissed.contains_key(&format!("{}:{}", queue.id, i.pr.id))).collect())),
                Err(problem) => {
                    problems.push(problem);
                    items.push((queue.id.clone(), vec![]));
                }
            }
        }
        let all: Vec<Item> = items.iter().flat_map(|(_, i)| i.iter().cloned()).collect();
        let keys: HashSet<String> = all.iter().flat_map(|i| i.events.iter().map(|e| e.key.clone())).collect();
        let searches: HashMap<String, String> = queues.iter().filter_map(|q| state.cache.lists.get(&q.id).map(|l| (q.id.clone(), search_key(&l.search)))).collect();
        let settled = |id: &str| searches.get(id).is_some_and(|s| state.persisted.searches.get(id) == Some(s));
        let mut animate = false;
        if let Some(previous) = &state.persisted.keys {
            let previous: HashSet<String> = previous.iter().cloned().collect();
            let audible: Vec<Item> = all.iter().filter(|i| settled(&i.queue_id)).cloned().collect();
            let fresh = engine::fresh_events(&audible, &queues, &previous, &state.persisted.seen, now());
            self.notify(&fresh, config.sound);
            for f in &fresh {
                state.arrivals.insert(f.item.pr.id.clone());
            }
            animate = !fresh.is_empty();
        }
        // Only once GitHub answered for them: before that a queue has no results to start from.
        if !searches.is_empty() {
            state.persisted.searches = searches;
        }
        // The first refresh notifies about nothing: it's all old news. Cards still show as unclicked.
        state.persisted.keys = Some(keys.iter().cloned().collect());
        // Forget what's gone, so the state stays small.
        state.persisted.seen.retain(|k, _| keys.contains(k));
        // A pull request taken off a queue by hand stays off while it still turns up in its search.
        let lists = &state.cache.lists;
        state.persisted.dismissed.retain(|key, _| {
            let (queue_id, pr_id) = key.split_once(':').unwrap_or((key, ""));
            lists.get(queue_id).is_none_or(|l| l.ids.iter().any(|id| id == pr_id))
        });
        state.persisted.ci = all.iter().map(|i| (i.pr.id.clone(), CiMemo { oid: i.pr.head_ref_oid.clone(), state: i.ci.clone() })).collect();
        if let Some(problem) = problems.into_iter().next() {
            state.status = Status { phase: "error", error: Some(problem), updated_at: state.status.updated_at };
        }
        state.items = items;
        self.save_state(state);
        self.update_tray(state, animate);
    }

    fn notify(&self, fresh: &[engine::Fresh], sound: bool) {
        // One sound for the batch, not one per notification.
        let mut sound = sound;
        for f in fresh.iter().take(MAX_NOTIFICATIONS) {
            let pr = &f.item.pr;
            let by = if f.event.kind == engine::NEW { format!(" · by {}", first_name(pr.author.as_ref())) } else { String::new() };
            let title = say(f.event.kind, &first_name(f.event.who.as_ref()));
            crate::show_notification(&self.app, title, format!("{}\n{}#{}{by}", pr.title, pr.repository.name_with_owner, pr.number), sound);
            sound = false;
        }
        if fresh.len() > MAX_NOTIFICATIONS {
            crate::show_notification(&self.app, format!("{} more pull request updates", fresh.len() - MAX_NOTIFICATIONS), "Open Focus Diff to see them".into(), sound);
        }
    }

    fn save_state(&self, state: &State) {
        write(config_dir(&self.app).map(|d| d.join("state.json")), &serde_json::to_string(&state.persisted).unwrap_or_default());
    }

    fn update_tray(&self, state: &mut State, animate: bool) {
        let count = state.items.iter().flat_map(|(_, items)| items.iter()).filter(|i| state.unread(i)).map(|i| i.pr.id.as_str()).collect::<HashSet<_>>().len();
        if state.last_count == Some(count) && !animate {
            return;
        }
        state.last_count = Some(count);
        crate::update_tray(&self.app, count as u32, animate);
    }

    /// The panel, when it's open, gets the new state. Nothing is serialized when it's closed.
    fn publish(&self) {
        if self.app.get_webview_window(crate::PANEL).is_some() {
            let snapshot = self.state.lock().unwrap().snapshot();
            let _ = self.app.emit_to(crate::PANEL, "snapshot", snapshot);
        }
    }
}
