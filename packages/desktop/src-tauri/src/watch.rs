use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};

use crate::config::{Config, Kind, Session};
use crate::engine::{self, Cache, CiMemo, Failure, Gql, Item};
use crate::review::{self, Candidate, Run};
use crate::i18n::tr;
use crate::{github, sound};
use crate::sync::Locked;

const FULL_EVERY: i64 = 20 * 60_000;
const MAX_NOTIFICATIONS: usize = 4;
const MAX_HELD: usize = 50;
const TICK: Duration = Duration::from_secs(15);
const EVENTS_VERSION: u32 = 1;

pub enum Message {
    Refresh { force: bool },
    Config,
    Auth,
    Tick,
    EndReview,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Until {
    Review,
    End,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Held {
    key: String,
    title: String,
    body: String,
    until: Until,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
struct Persisted {
    seen: HashMap<String, bool>,
    keys: Option<Vec<String>>,
    ci: HashMap<String, CiMemo>,
    dismissed: HashMap<String, bool>,
    searches: HashMap<String, String>,
    events_version: u32,
    held: Vec<Held>,
    run: Option<Run>,
    review_checked_at: i64,
}

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
    arrivals: HashSet<String>,
    last_count: Option<usize>,
    auth_unknown: bool,
    retry_at: i64,
    backoff: i64,
    countdown: Option<i64>,
    dismissed_now: Vec<(String, Item, Vec<String>)>,
}

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

fn config_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok()
}

fn cache_file(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_cache_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    Some(dir.join("cache.json"))
}

fn read<T: for<'de> Deserialize<'de>>(path: Option<PathBuf>) -> Option<T> {
    serde_json::from_str(&fs::read_to_string(path?).ok()?).ok()
}

fn write(path: Option<PathBuf>, contents: &str) {
    if let Some(path) = path {
        let _ = crate::disk::write(&path, contents);
    }
}

fn read_config(app: &AppHandle) -> Option<Config> {
    Config::parse(&fs::read_to_string(config_dir(app)?.join("config.json")).ok()?)
}

fn first_name(actor: Option<&engine::Actor>) -> String {
    actor
        .and_then(|a| a.name.as_deref().and_then(|n| n.split_whitespace().next()).map(String::from).or_else(|| (!a.login.is_empty()).then(|| a.login.clone())))
        .unwrap_or_else(|| tr!("Someone", "Alguém"))
}

fn words(fresh: &engine::Fresh, kind: Option<Kind>) -> (String, String) {
    let pr = &fresh.item.pr;
    let who = first_name(fresh.event.who.as_ref());
    let teams = fresh.item.via_teams.as_deref().unwrap_or_default();
    let reviewing = kind == Some(Kind::Review);
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

#[derive(Clone, Copy)]
enum Why {
    CameIn,
    WaitedForReview,
    CameInWhileReviewing,
}

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
    pub fn start(app: &AppHandle) -> Watch {
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
            let rhythm = |worker: &Worker| Duration::from_secs(worker.state.held().config.as_ref().map_or(60, |c| c.poll_seconds));
            let mut next = Instant::now() + rhythm(&worker);
            loop {
                let first = match receiver.recv_timeout(next.saturating_duration_since(Instant::now())) {
                    Ok(message) => message,
                    Err(RecvTimeoutError::Timeout) => Message::Refresh { force: false },
                    Err(RecvTimeoutError::Disconnected) => return,
                };
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
        self.state.held().snapshot()
    }

    fn change(&self, app: &AppHandle, change: impl FnOnce(&mut State)) {
        let worker = Worker { app: app.clone(), state: self.state.clone() };
        {
            let mut state = self.state.held();
            change(&mut state);
            worker.save_state(&state);
            worker.update_tray(&mut state, false);
        }
        worker.publish();
    }

    pub fn mark_seen(&self, app: &AppHandle, queue_id: &str, pr_id: &str) {
        self.change(app, |state| {
            let keys: Vec<String> = state.find(queue_id, pr_id).map(|i| i.events.iter().map(|e| e.key.clone()).collect()).unwrap_or_default();
            for key in keys {
                state.persisted.seen.insert(key, true);
            }
            state.arrivals.remove(pr_id);
        });
    }

    pub fn mark_queue_seen(&self, app: &AppHandle, queue_id: &str) {
        self.change(app, |state| {
            let keys: Vec<String> = state.items.iter().filter(|(id, _)| id == queue_id).flat_map(|(_, items)| items.iter().flat_map(|i| i.events.iter().map(|e| e.key.clone()))).collect();
            for key in keys {
                state.persisted.seen.insert(key, true);
            }
        });
    }

    pub fn dismiss(&self, app: &AppHandle, queue_id: &str, pr_id: &str) {
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

    pub fn reviewed(&self, app: &AppHandle, pr_id: &str) {
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

    pub fn restore(&self, app: &AppHandle, queue_id: &str, pr_id: &str) {
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

    #[cfg(any(debug_assertions, feature = "devctl"))]
    pub fn forget(&self, n: usize) -> Vec<String> {
        let mut state = self.state.held();
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

    pub fn end_review(&self) {
        self.send(Message::EndReview);
    }

    pub fn clear_arrival(&self, app: &AppHandle, pr_id: &str) {
        let removed = self.state.held().arrivals.remove(pr_id);
        if removed {
            Worker { app: app.clone(), state: self.state.clone() }.publish();
        }
    }
}

fn take_held(state: &mut State, until: Until) -> Vec<Held> {
    let (taken, kept) = std::mem::take(&mut state.persisted.held).into_iter().partition(|h| h.until == until);
    state.persisted.held = kept;
    taken
}

struct Worker {
    app: AppHandle,
    state: Arc<Mutex<State>>,
}

impl Worker {
    fn boot(&self) {
        {
            let mut state = self.state.held();
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
                let mut state = self.state.held();
                state.auth_unknown = false;
                if state.me != login {
                    state.me = login;
                    state.items.clear();
                    state.arrivals.clear();
                    state.status = Status { phase: "idle", error: None, updated_at: 0 };
                    self.update_tray(&mut state, false);
                }
            }
            Err(message) => {
                let mut state = self.state.held();
                state.auth_unknown = true;
                state.status = Status { phase: "error", error: Some(message), updated_at: state.status.updated_at };
            }
        }
        self.publish();
    }

    fn reload_config(&self) {
        let mut state = self.state.held();
        state.config = read_config(&self.app);
        self.apply(&mut state);
        drop(state);
        self.publish();
    }

    fn refresh(&self, force: bool) {
        let auth_unknown = self.state.held().auth_unknown;
        if auth_unknown {
            self.check_auth();
        }
        let (config, me, mut cache, full) = {
            let mut state = self.state.held();
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

        let mut state = self.state.held();
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
                write(cache_file(&self.app), &serde_json::to_string(&state.cache).unwrap_or_default());
                let message = if failure.status == 401 {
                    tr!("GitHub signed you out", "O GitHub desconectou você")
                } else if failure.rate_limited() {
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
        let reviewing: HashSet<String> = queues.iter().filter(|q| q.kind == Kind::Review).flat_map(|q| items.iter().filter(|(id, _)| *id == q.id).flat_map(|(_, i)| i.iter().map(|i| i.pr.id.clone()))).collect();
        for (id, list) in &mut items {
            if queues.iter().any(|q| q.id == *id && q.kind == Kind::Involved) {
                list.retain(|i| !reviewing.contains(&i.pr.id));
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
            animate = self.notify(state, &config, &fresh) > 0;
        }
        if !searches.is_empty() {
            state.persisted.searches = searches;
            state.persisted.events_version = EVENTS_VERSION;
        }
        state.persisted.keys = Some(keys.iter().cloned().collect());
        state.persisted.seen.retain(|k, _| keys.contains(k));
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

    fn chime(&self, config: &Config, title: String, body: String) {
        crate::show_notification(&self.app, title, body, config.sound && !sound::OWN);
        if config.sound {
            sound::play(&self.app);
        }
    }

    fn review_tick(&self) {
        let now = now();
        let over = self.state.held().persisted.run.as_ref().is_some_and(|r| now >= r.ends_at());
        if over {
            self.refresh(true);
            let mut state = self.state.held();
            self.end_run(&mut state, true);
        }
        let due = {
            let mut state = self.state.held();
            let Some(config) = state.config.clone() else { return };
            if !review::is_scheduled(&config.review_time) && state.persisted.run.is_none() && state.persisted.held.iter().any(|h| h.until == Until::Review) {
                let waiting = take_held(&mut state, Until::Review);
                self.release(waiting, Why::CameIn, config.sound);
                self.save_state(&state);
            }
            let last = std::mem::replace(&mut state.persisted.review_checked_at, now);
            let due = (last > 0).then(|| review::due(&config.review_time, last, now, &review::local_offset)).flatten().map(|d| d.session.clone());
            due.filter(|_| state.persisted.run.is_none() && state.me.is_some())
        };
        let started = due.is_some();
        if let Some(session) = due {
            self.refresh(true);
            let mut state = self.state.held();
            self.start_run(&mut state, &session, now);
        }
        let mut state = self.state.held();
        self.update_countdown(&mut state, now);
        drop(state);
        if over || started {
            self.publish();
        }
    }

    fn session_items<'a>(state: &'a State, session: Option<&Session>) -> Vec<&'a Item> {
        let config = state.config.as_ref();
        let picks = |id: &str| match session.filter(|s| !s.queues.is_empty()) {
            Some(s) => s.queues.iter().any(|q| q == id),
            None => config.is_some_and(|c| c.queues.iter().any(|q| q.id == id && q.kind == Kind::Review)),
        };
        state.items.iter().filter(|(id, _)| picks(id)).flat_map(|(_, items)| items.iter()).collect()
    }

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
        if !run.pulls.is_empty() {
            state.persisted.run = Some(run);
        }
        self.save_state(state);
    }

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
        let mut state = self.state.held();
        self.end_run(&mut state, false);
        self.update_countdown(&mut state, now());
        drop(state);
        self.publish();
    }

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

    fn publish(&self) {
        if self.app.get_webview_window(crate::PANEL).is_some() {
            let snapshot = self.state.held().snapshot();
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
