//! The app's live state, kept here rather than in a web view so the panel can be closed while
//! hidden: refreshes the queues on the configured rhythm, remembers what's been seen, notifies (or
//! keeps notifications for review time), runs review time, and keeps the tray icon current. The
//! panel reads it as a snapshot and follows its changes.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::config::{Config, Kind, Session};
use crate::engine::{self, Cache, CiMemo, Failure, Gql, Item};
use crate::review::{self, Candidate, Run};
use crate::i18n::tr;
use crate::{github, sound};

/// Every pull request in full again this often, changed or not: a safety net for what GitHub
/// doesn't count as an update.
const FULL_EVERY: i64 = 20 * 60_000;
const MAX_NOTIFICATIONS: usize = 4;
/// Notifications kept for later, the latest of them.
const MAX_HELD: usize = 50;
/// How often review time's clock is looked at: to start on the minute and count down.
const TICK: Duration = Duration::from_secs(15);
/// Bumped when there are new kinds of event: the first refresh after notifies about none of them,
/// or every comment and draft made ready in the queues would be news at once.
const EVENTS_VERSION: u32 = 1;

pub enum Message {
    Refresh { force: bool },
    /// config.json changed.
    Config,
    /// Signed in or out.
    Auth,
    /// Review time's clock.
    Tick,
    /// The panel's End on a review time under way.
    EndReview,
}

/// What a notification kept for later waits for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Until {
    /// The next review time.
    Review,
    /// The end of the one under way.
    End,
}

/// A notification kept for later, as it would have shown.
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Held {
    key: String,
    title: String,
    body: String,
    until: Until,
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
    /// The kinds of event `keys` knows about (EVENTS_VERSION).
    events_version: u32,
    /// Notifications waiting for review time, or for the end of the one under way.
    held: Vec<Held>,
    /// The review time under way.
    run: Option<Run>,
    /// When review time's schedule was last looked at (ms): one that started since is due.
    review_checked_at: i64,
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
    /// What the tray shows of review time's countdown.
    countdown: Option<i64>,
    /// Pull requests just taken off by hand, with the event keys that counted as seen then, for
    /// Undo to put back as they were. The latest few only.
    dismissed_now: Vec<(String, Item, Vec<String>)>,
}

/// How many pull requests taken off by hand Undo can still put back.
const MOST_UNDONE: usize = 50;
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
            let message = reply["message"].as_str().map(String::from).unwrap_or_else(|| tr!("GitHub returned {status}", "O GitHub respondeu {status}"));
            return Err(Failure { status, message });
        }
        if reply["data"].is_null() {
            let message = reply["errors"][0]["message"].as_str().map(String::from).unwrap_or_else(|| tr!("GitHub returned no data", "O GitHub não mandou nenhum dado"));
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
    if let Some(path) = path {
        let _ = crate::disk::write(&path, contents);
    }
}

fn read_config<R: Runtime>(app: &AppHandle<R>) -> Option<Config> {
    Config::parse(&fs::read_to_string(config_dir(app)?.join("config.json")).ok()?)
}

// MARK: Words

fn first_name(actor: Option<&engine::Actor>) -> String {
    actor
        .and_then(|a| a.name.as_deref().and_then(|n| n.split_whitespace().next()).map(String::from).or_else(|| (!a.login.is_empty()).then(|| a.login.clone())))
        .unwrap_or_else(|| tr!("Someone", "Alguém"))
}

/// What a notification says: what happened, by whom (and for a review request, whether it's asked
/// of you or your team, or again), then what a comment or review said, if anything, over the pull
/// request it's on.
fn words(fresh: &engine::Fresh, kind: Option<Kind>) -> (String, String) {
    let pr = &fresh.item.pr;
    let who = first_name(fresh.event.who.as_ref());
    let teams = fresh.item.via_teams.as_deref().unwrap_or_default();
    let reviewing = kind == Some(Kind::Review);
    // The extension's words (its pt_BR notify*), so both products say it the same way.
    let title = match fresh.event.kind {
        "new" if reviewing && !teams.is_empty() => tr!("{who} asked your team for a review", "{who} pediu revisão ao seu time"),
        "new" if reviewing => tr!("{who} asked for your review", "{who} pediu sua revisão"),
        "new" => tr!("New in your queue", "Novo na sua fila"),
        "rerequest" => tr!("{who} asked you to review again", "{who} pediu para você revisar de novo"),
        "ready" if reviewing => tr!("{who}'s pull request is ready for your review", "O pull request de {who} está pronto para sua revisão"),
        "ready" => tr!("{who} marked it ready for review", "{who} marcou como pronto para revisão"),
        "commits" => tr!("{who} pushed changes", "{who} enviou mudanças"),
        "reply" => tr!("{who} replied to you", "{who} respondeu você"),
        "mention" => tr!("{who} mentioned you", "{who} mencionou você"),
        "comment" if kind == Some(Kind::Authored) => tr!("{who} commented on your pull request", "{who} comentou no seu pull request"),
        "comment" if reviewing => tr!("{who} commented on a pull request you review", "{who} comentou num pull request que você revisa"),
        "comment" => tr!("{who} commented", "{who} comentou"),
        "approved" => tr!("{who} approved your pull request", "{who} aprovou seu pull request"),
        "changes" => tr!("{who} requested changes on your pull request", "{who} pediu mudanças no seu pull request"),
        "ci-failed" => tr!("CI failed", "O CI falhou"),
        "ci-passed" => tr!("CI passed", "O CI passou"),
        "conflict" => tr!("Merge conflict", "Conflito de merge"),
        _ => tr!("Something happened", "Aconteceu algo"),
    };
    let mut place = format!("{}#{}", pr.repository.name_with_owner, pr.number);
    if let Some(team) = teams.first() {
        let team = team.split_once('/').map_or(team.as_str(), |(_, slug)| slug);
        place.push_str(&tr!(" · for {team}", " · para {team}"));
    }
    let title_of_pr = &pr.title;
    let body = match &fresh.event.text {
        Some(text) => format!("“{text}”\n{place} · {title_of_pr}"),
        None if fresh.event.kind == "new" && !reviewing => {
            let author = first_name(pr.author.as_ref());
            tr!("{title_of_pr}\n{place} · by {author}", "{title_of_pr}\n{place} · de {author}")
        }
        None => format!("{title_of_pr}\n{place}"),
    };
    (title, body)
}

/// Why notifications were kept, for the one that sums them up.
#[derive(Clone, Copy)]
enum Why {
    /// No review time is coming any more.
    CameIn,
    WaitedForReview,
    CameInWhileReviewing,
}

/// Several notifications as one: how many, and a line each for the first few.
fn summary(notes: &[Held], why: Why) -> (String, String) {
    let lines: Vec<String> = notes.iter().take(5).map(|n| format!("{}: {}", n.title, n.body.lines().next().unwrap_or(""))).collect();
    let more = if notes.len() > 5 {
        let n = notes.len() - 5;
        tr!("\nand {n} more", "\ne mais {n}")
    } else {
        String::new()
    };
    let n = notes.len();
    let title = match why {
        Why::CameIn => tr!("{n} updates came in", "{n} atualizações chegaram"),
        Why::WaitedForReview => tr!("{n} updates waited for review time", "{n} atualizações guardadas para o review time"),
        Why::CameInWhileReviewing => tr!("{n} updates came in while you reviewed", "{n} atualizações chegaram enquanto você revisava"),
    };
    (title, format!("{}{more}", lines.join("\n")))
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
            "review": self.persisted.run.as_ref().map(|run| json!({ "run": run, "endsAt": run.ends_at() })),
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
            countdown: None,
            dismissed_now: vec![],
        }));
        let watch = Watch { sender: sender.clone(), state: state.clone() };
        let app = app.clone();
        std::thread::spawn(move || {
            let worker = Worker { app, state };
            worker.boot();
            let rhythm = |worker: &Worker<R>| Duration::from_secs(worker.state.lock().unwrap().config.as_ref().map_or(60, |c| c.poll_seconds));
            let mut next = Instant::now() + rhythm(&worker);
            loop {
                let first = match receiver.recv_timeout(next.saturating_duration_since(Instant::now())) {
                    Ok(message) => message,
                    Err(RecvTimeoutError::Timeout) => Message::Refresh { force: false },
                    Err(RecvTimeoutError::Disconnected) => return,
                };
                // Several requests that piled up during a refresh make one.
                let (mut refresh, mut force, mut config, mut auth, mut end) = (false, false, false, false, false);
                for message in std::iter::once(first).chain(receiver.try_iter()) {
                    match message {
                        Message::Refresh { force: f } => (refresh, force) = (true, force | f),
                        Message::Config => config = true,
                        Message::Auth => auth = true,
                        Message::Tick => {}
                        Message::EndReview => end = true,
                    }
                }
                if auth {
                    worker.check_auth();
                }
                if config {
                    worker.reload_config();
                }
                if end {
                    worker.end_review();
                }
                // The clock's ticks alone don't refresh: GitHub is asked on its own rhythm.
                if refresh || config || auth {
                    worker.refresh(force || config || auth);
                    next = Instant::now() + rhythm(&worker);
                }
                worker.review_tick();
            }
        });
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(TICK);
                if sender.send(Message::Tick).is_err() {
                    return;
                }
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
            if let Some(item) = state.find(queue_id, pr_id).cloned() {
                let fresh: Vec<String> = item.events.iter().map(|e| e.key.clone()).filter(|k| !state.persisted.seen.contains_key(k)).collect();
                for key in &fresh {
                    state.persisted.seen.insert(key.clone(), true);
                }
                state.dismissed_now.push((queue_id.to_string(), item, fresh));
                let extra = state.dismissed_now.len().saturating_sub(MOST_UNDONE);
                state.dismissed_now.drain(..extra);
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

    /// Your review sent, or you off its reviewers: off the queues waiting on your review at once,
    /// not at the next refresh, and kept off while GitHub's search, a while behind, still has it.
    pub fn reviewed<R: Runtime>(&self, app: &AppHandle<R>, pr_id: &str) {
        self.change(app, |state| {
            let queues: Vec<String> = state.config.iter().flat_map(|c| c.enabled()).filter(|q| q.kind == crate::config::Kind::Review).map(|q| q.id.clone()).collect();
            for queue_id in queues {
                state.persisted.dismissed.insert(format!("{queue_id}:{pr_id}"), true);
                if let Some((_, items)) = state.items.iter_mut().find(|(id, _)| *id == queue_id) {
                    items.retain(|i| i.pr.id != pr_id);
                }
            }
            state.arrivals.remove(pr_id);
        });
    }

    /// Undo for `dismiss`: the pull request back on its queue, as unread as it was.
    pub fn restore<R: Runtime>(&self, app: &AppHandle<R>, queue_id: &str, pr_id: &str) {
        self.change(app, |state| {
            state.persisted.dismissed.remove(&format!("{queue_id}:{pr_id}"));
            let Some(at) = state.dismissed_now.iter().position(|(q, i, _)| q == queue_id && i.pr.id == pr_id) else { return };
            let (_, item, fresh) = state.dismissed_now.remove(at);
            for key in fresh {
                state.persisted.seen.remove(&key);
            }
            if let Some((_, items)) = state.items.iter_mut().find(|(id, _)| id == queue_id)
                && !items.iter().any(|i| i.pr.id == pr_id)
            {
                items.push(item);
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

    /// Ends the review time under way, on the refreshing thread.
    pub fn end_review(&self) {
        self.send(Message::EndReview);
    }

    pub fn clear_arrival<R: Runtime>(&self, app: &AppHandle<R>, pr_id: &str) {
        let removed = self.state.lock().unwrap().arrivals.remove(pr_id);
        if removed {
            Worker { app: app.clone(), state: self.state.clone() }.publish();
        }
    }
}

/// Takes the notifications kept for this, in the order they came.
fn take_held(state: &mut State, until: Until) -> Vec<Held> {
    let (taken, kept) = std::mem::take(&mut state.persisted.held).into_iter().partition(|h| h.until == until);
    state.persisted.held = kept;
    taken
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
        self.review_tick();
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
                    tr!("GitHub signed you out", "O GitHub desconectou você")
                } else if failure.rate_limited() {
                    // Waiting longer each time it asks again, up to half an hour.
                    state.backoff = (state.backoff * 2).clamp(FIRST_BACKOFF, LONGEST_BACKOFF);
                    state.retry_at = now() + state.backoff;
                    let minutes = state.backoff / 60_000;
                    tr!("GitHub asked Focus Diff to slow down: trying again in {minutes} minutes", "O GitHub pediu para o Focus Diff ir mais devagar: tentando de novo em {minutes} minutos")
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
        let known = state.persisted.events_version == EVENTS_VERSION;
        if let Some(previous) = state.persisted.keys.as_ref().filter(|_| known) {
            let previous: HashSet<String> = previous.iter().cloned().collect();
            let audible: Vec<Item> = all.iter().filter(|i| settled(&i.queue_id)).cloned().collect();
            let fresh = engine::fresh_events(&audible, &queues, &previous, &state.persisted.seen, now());
            for f in &fresh {
                state.arrivals.insert(f.item.pr.id.clone());
            }
            // Only what shows now draws the eye: what's kept waits quietly.
            animate = self.notify(state, &config, &fresh) > 0;
        }
        // Only once GitHub answered for them: before that a queue has no results to start from.
        if !searches.is_empty() {
            state.persisted.searches = searches;
            state.persisted.events_version = EVENTS_VERSION;
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

    /// Shows what's new, or keeps it: for the next review time when its queue says so (and there is
    /// one coming), or for the end of the one under way when everything waits while reviewing.
    /// Returns how many showed now.
    fn notify(&self, state: &mut State, config: &Config, fresh: &[engine::Fresh]) -> usize {
        let reviewing = state.persisted.run.is_some();
        let scheduled = review::is_scheduled(&config.review_time);
        let mut now = Vec::new();
        for f in fresh {
            let queue = config.queues.iter().find(|q| q.id == f.item.queue_id);
            let (title, body) = words(f, queue.map(|q| q.kind));
            let until = if reviewing && config.review_time.hold_while_reviewing {
                Some(Until::End)
            } else if scheduled && queue.is_some_and(|q| q.waits_for_review()) {
                Some(Until::Review)
            } else {
                None
            };
            let note = Held { key: f.event.key.clone(), title, body, until: until.unwrap_or(Until::Review) };
            match until {
                Some(_) => {
                    state.persisted.held.retain(|h| h.key != note.key);
                    state.persisted.held.push(note);
                }
                None => now.push(note),
            }
        }
        let overflow = state.persisted.held.len().saturating_sub(MAX_HELD);
        state.persisted.held.drain(..overflow);
        self.show(&now, config.sound);
        now.len()
    }

    /// Notifications, a few at most, with one sound for the batch, not one per notification.
    fn show(&self, notes: &[Held], sound: bool) {
        let mut sound = sound;
        for note in notes.iter().take(MAX_NOTIFICATIONS) {
            crate::show_notification(&self.app, note.title.clone(), note.body.clone(), sound);
            sound = false;
        }
        if notes.len() > MAX_NOTIFICATIONS {
            let n = notes.len() - MAX_NOTIFICATIONS;
            let title = tr!("{n} more pull request updates", "Mais {n} atualizações nos seus pull requests");
            crate::show_notification(&self.app, title, tr!("Open Focus Diff to see them", "Abra o Focus Diff para ver"), sound);
        }
    }

    /// Notifications that were kept: as they were if just one, summed up in one otherwise.
    fn release(&self, notes: Vec<Held>, why: Why, sound: bool) {
        match notes.len() {
            0 => {}
            1 => self.show(&notes, sound),
            _ => {
                let (title, body) = summary(&notes, why);
                crate::show_notification(&self.app, title, body, sound);
            }
        }
    }

    /// Review time's own notification: its own sound where there is one, else the system's.
    fn chime(&self, config: &Config, title: String, body: String) {
        crate::show_notification(&self.app, title, body, config.sound && !sound::OWN);
        if config.sound {
            sound::play(&self.app);
        }
    }

    /// Review time's clock: the one under way ends when its time is up, one that's due starts, and
    /// the tray counts down. What was kept for review times that won't come any more shows now.
    fn review_tick(&self) {
        let now = now();
        let over = self.state.lock().unwrap().persisted.run.as_ref().is_some_and(|r| now >= r.ends_at());
        if over {
            // How far it got, from the queues as they are now.
            self.refresh(true);
            let mut state = self.state.lock().unwrap();
            self.end_run(&mut state, true);
        }
        let due = {
            let mut state = self.state.lock().unwrap();
            let Some(config) = state.config.clone() else { return };
            if !review::is_scheduled(&config.review_time) && state.persisted.run.is_none() && state.persisted.held.iter().any(|h| h.until == Until::Review) {
                let waiting = take_held(&mut state, Until::Review);
                self.release(waiting, Why::CameIn, config.sound);
                self.save_state(&state);
            }
            let last = std::mem::replace(&mut state.persisted.review_checked_at, now);
            // The first look starts the clock: nothing from before counts.
            let due = (last > 0).then(|| review::due(&config.review_time, last, now, &review::local_offset)).flatten().map(|d| d.session.clone());
            due.filter(|_| state.persisted.run.is_none() && state.me.is_some())
        };
        let started = due.is_some();
        if let Some(session) = due {
            // What's waiting as it stands now, not as of the last refresh.
            self.refresh(true);
            let mut state = self.state.lock().unwrap();
            self.start_run(&mut state, &session, now);
        }
        let mut state = self.state.lock().unwrap();
        self.update_countdown(&mut state, now);
        drop(state);
        if over || started {
            self.publish();
        }
    }

    /// The items of the queues a session picks from: the ones it names, or every review queue.
    fn session_items<'a>(state: &'a State, session: Option<&Session>) -> Vec<&'a Item> {
        let config = state.config.as_ref();
        let picks = |id: &str| match session.filter(|s| !s.queues.is_empty()) {
            Some(s) => s.queues.iter().any(|q| q == id),
            None => config.is_some_and(|c| c.queues.iter().any(|q| q.id == id && q.kind == Kind::Review)),
        };
        state.items.iter().filter(|(id, _)| picks(id)).flat_map(|(_, items)| items.iter()).collect()
    }

    /// Starts a review time: picks what fits and says so, with what waited for it.
    fn start_run(&self, state: &mut State, session: &Session, now: i64) {
        let Some(config) = state.config.clone() else { return };
        let mut ids = HashSet::new();
        let pace = review::pace_factor(&read(config_dir(&self.app).map(|d| d.join("pace.json"))).unwrap_or_default());
        let candidates: Vec<Candidate> = Self::session_items(state, Some(session))
            .into_iter()
            .filter(|i| (session.drafts || !i.pr.is_draft) && ids.insert(i.pr.id.as_str()))
            .map(|i| Candidate::new(&i.pr, i.events.iter().any(|e| e.kind == "rerequest"), pace))
            .collect();
        let plan = review::plan(candidates, session.minutes, session.order, config.review_time.again_first);
        let waited = take_held(state, Until::Review);
        let name = if session.name.trim().is_empty() { tr!("Review time", "Review time") } else { session.name.trim().to_string() };
        let run = Run { session: session.id.clone(), name, minutes: session.minutes, started_at: now, pulls: plan.picked, left: plan.left, over_by: plan.over_by };
        if !run.pulls.is_empty() || !config.review_time.skip_empty {
            let (title, body) = review::offer_words(&run);
            self.chime(&config, title, body);
            self.release(waited, Why::WaitedForReview, false);
        } else {
            self.release(waited, Why::WaitedForReview, config.sound);
        }
        // Nothing to review: nothing to count down.
        if !run.pulls.is_empty() {
            state.persisted.run = Some(run);
        }
        self.save_state(state);
    }

    /// Ends the review time under way: its time is up (said, if asked), or it was ended by hand.
    /// What waited for the end of it shows now.
    fn end_run(&self, state: &mut State, time_up: bool) {
        let Some(config) = state.config.clone() else { return };
        let Some(run) = state.persisted.run.take() else { return };
        let waited = take_held(state, Until::End);
        let told = time_up && config.review_time.remind_end && !run.pulls.is_empty();
        if told {
            let session = config.review_time.sessions.iter().find(|s| s.id == run.session);
            let waiting: HashSet<&str> = Self::session_items(state, session).into_iter().map(|i| i.pr.id.as_str()).collect();
            let (title, body) = review::end_words(&run, run.pulls.iter().filter(|p| waiting.contains(p.id.as_str())).count());
            self.chime(&config, title, body);
        }
        self.release(waited, Why::CameInWhileReviewing, config.sound && !told);
        self.save_state(state);
    }

    fn end_review(&self) {
        let mut state = self.state.lock().unwrap();
        self.end_run(&mut state, false);
        self.update_countdown(&mut state, now());
        drop(state);
        self.publish();
    }

    /// The minutes left beside the tray icon, while a review time is under way.
    fn update_countdown(&self, state: &mut State, now: i64) {
        let minutes = state.persisted.run.as_ref().map(|r| r.minutes_left(now));
        if state.countdown != minutes {
            state.countdown = minutes;
            crate::update_countdown(&self.app, minutes);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{Event, Fresh, PullRequest};
    use crate::i18n::{in_locale, Locale};

    fn item(via_teams: Option<Vec<String>>) -> Item {
        let pr: PullRequest = serde_json::from_value(json!({
            "id": "PR_1", "number": 7, "title": "Fix login", "repository": { "nameWithOwner": "acme/web" },
            "author": { "login": "ana", "name": "Ana Lima" },
        }))
        .unwrap();
        Item { queue_id: "q".into(), pr: Arc::new(pr), events: vec![], status: None, via_teams, ci: None, passed: false, waiting_since: None }
    }

    fn said(item: &Item, kind: &'static str, text: Option<&str>, kind_of_queue: Kind) -> (String, String) {
        let who = Some(engine::Actor { login: "bruno".into(), name: Some("Bruno Costa".into()), ..Default::default() });
        let event = Event { key: "k".into(), kind, at: 0, who, text: text.map(String::from) };
        words(&Fresh { item, event }, Some(kind_of_queue))
    }

    #[test]
    fn says_what_happened() {
        let mine = item(Some(vec![]));
        let team = item(Some(vec!["acme/web-platform".into()]));
        in_locale(Locale::En, || {
            assert_eq!(said(&mine, "new", None, Kind::Review), ("Bruno asked for your review".into(), "Fix login\nacme/web#7".into()));
            assert_eq!(said(&team, "new", None, Kind::Review), ("Bruno asked your team for a review".into(), "Fix login\nacme/web#7 · for web-platform".into()));
            assert_eq!(said(&mine, "rerequest", None, Kind::Review).0, "Bruno asked you to review again");
            assert_eq!(said(&mine, "ready", None, Kind::Review).0, "Bruno's pull request is ready for your review");
            assert_eq!(said(&item(None), "comment", Some("Can you look?"), Kind::Authored), ("Bruno commented on your pull request".into(), "“Can you look?”\nacme/web#7 · Fix login".into()));
            assert_eq!(said(&item(None), "new", None, Kind::Custom).1, "Fix login\nacme/web#7 · by Ana");
        });
    }

    #[test]
    fn says_it_in_portuguese() {
        let mine = item(Some(vec![]));
        let team = item(Some(vec!["acme/web-platform".into()]));
        in_locale(Locale::PtBr, || {
            assert_eq!(said(&mine, "new", None, Kind::Review).0, "Bruno pediu sua revisão");
            assert_eq!(said(&team, "new", None, Kind::Review), ("Bruno pediu revisão ao seu time".into(), "Fix login\nacme/web#7 · para web-platform".into()));
            assert_eq!(said(&mine, "rerequest", None, Kind::Review).0, "Bruno pediu para você revisar de novo");
            assert_eq!(said(&mine, "ready", None, Kind::Review).0, "O pull request de Bruno está pronto para sua revisão");
            assert_eq!(said(&item(None), "comment", None, Kind::Authored).0, "Bruno comentou no seu pull request");
            assert_eq!(said(&item(None), "new", None, Kind::Custom).1, "Fix login\nacme/web#7 · de Ana");
        });
    }

    #[test]
    fn several_kept_as_one() {
        let note = |title: &str| Held { key: title.into(), title: title.into(), body: "Fix login\nacme/web#7".into(), until: Until::Review };
        let notes: Vec<Held> = ["A", "B", "C", "D", "E", "F", "G"].into_iter().map(note).collect();
        in_locale(Locale::En, || {
            let (title, body) = summary(&notes, Why::WaitedForReview);
            assert_eq!(title, "7 updates waited for review time");
            assert_eq!(body.lines().next(), Some("A: Fix login"));
            assert!(body.ends_with("and 2 more"), "{body}");
        });
        in_locale(Locale::PtBr, || {
            let (title, body) = summary(&notes, Why::WaitedForReview);
            assert_eq!(title, "7 atualizações guardadas para o review time");
            assert!(body.ends_with("e mais 2"), "{body}");
        });
    }
}
