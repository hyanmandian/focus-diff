//! Pending review comments on their way to GitHub. A comment written in a review window goes into
//! your pending review on github.com, so the site has it too and it outlives the window, but the
//! window never waits for that: each change is kept on disk here and sent until GitHub takes it,
//! through failures, sleep and restarts, as the viewed marks are (outbox.rs). What GitHub refuses
//! is kept, with why, until it's changed, removed or tried again: what someone wrote is never
//! dropped. Sent as soon as it's made; after a failure, again in 1s, 2s, 4s… up to 30s.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::github;
use crate::i18n::tr;
use crate::sync::Locked;

const LONGEST_WAIT: Duration = Duration::from_secs(30);
/// How long submitting the review waits for its comments to reach GitHub.
const FLUSH_FOR: Duration = Duration::from_secs(20);

/// A comment written or edited: into the pending review if it's new, its text changed if it's
/// there already.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Put {
    /// The window's name for it, until GitHub gives it an id.
    pub key: String,
    /// The pull request's node id.
    pub pull: String,
    pub path: String,
    pub line: u32,
    /// "additions" or "deletions", as the window has it.
    pub side: String,
    #[serde(default)]
    pub start_line: Option<u32>,
    /// The side several lines start on, when it's the other one (across the two).
    #[serde(default)]
    pub start_side: Option<String>,
    /// On the file as a whole.
    #[serde(default)]
    pub file: bool,
    pub body: String,
    /// Its id on GitHub, when the window knows it (one started on github.com).
    #[serde(default)]
    pub id: Option<String>,
    /// A reply to this conversation (its node id), rather than a new one.
    #[serde(default)]
    pub reply_to: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Change {
    Put(Put),
    Remove {
        key: String,
        pull: String,
        #[serde(default)]
        id: Option<String>,
    },
}

impl Change {
    fn key(&self) -> &str {
        match self {
            Change::Put(p) => &p.key,
            Change::Remove { key, .. } => key,
        }
    }

    fn pull(&self) -> &str {
        match self {
            Change::Put(p) => &p.pull,
            Change::Remove { pull, .. } => pull,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Job {
    pub change: Change,
    /// Why GitHub refused it: it waits for the person, not sent again on its own.
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Synced {
    pull: String,
    comment: String,
}

/// What's kept on disk: the changes still to send, and the ids GitHub gave the comments sent.
#[derive(Default, Debug, Serialize, Deserialize)]
struct Saved {
    jobs: Vec<Job>,
    #[serde(default)]
    ids: HashMap<String, Synced>,
}

/// A pull request's comments as this side has them, for its window to show.
#[derive(Serialize)]
pub struct Pending {
    pub jobs: Vec<Job>,
    /// GitHub's id for each comment sent, by the window's key.
    pub ids: HashMap<String, String>,
}

#[derive(Default)]
struct Queue {
    saved: Saved,
    /// Something new to send: skip the wait.
    woken: bool,
    /// Sends that couldn't reach GitHub, counted, so a submit waiting on them stops waiting.
    unreachable: u64,
    last_failure: Option<String>,
}

impl Queue {
    /// The latest text wins: an earlier change to the same comment that hasn't gone yet is replaced.
    fn put(&mut self, put: Put) {
        self.saved.jobs.retain(|j| !(matches!(j.change, Change::Put(_)) && j.change.key() == put.key));
        self.saved.jobs.push(Job { change: Change::Put(put), error: None });
    }

    /// A comment never sent just goes; one on GitHub is deleted there.
    fn remove(&mut self, pull: String, key: String, id: Option<String>) {
        self.saved.jobs.retain(|j| j.change.key() != key);
        self.saved.jobs.push(Job { change: Change::Remove { key, pull, id }, error: None });
    }

    fn next(&self) -> Option<Job> {
        self.saved.jobs.iter().find(|j| j.error.is_none()).cloned()
    }

    /// After a job is sent. Only the job as it was sent is settled: a newer change made meanwhile
    /// stays to be sent (with the id this one got).
    fn settle(&mut self, job: &Job, sent: &Sent) {
        let still = self.saved.jobs.iter().position(|j| j == job);
        match sent {
            Sent::Done(id) => {
                match (&job.change, id) {
                    (Change::Put(p), Some(id)) => {
                        self.saved.ids.insert(p.key.clone(), Synced { pull: p.pull.clone(), comment: id.clone() });
                    }
                    (Change::Remove { key, .. }, _) => {
                        self.saved.ids.remove(key);
                    }
                    _ => {}
                }
                if let Some(i) = still {
                    self.saved.jobs.remove(i);
                }
            }
            Sent::Refused(why) => {
                if let Some(i) = still {
                    self.saved.jobs[i].error = Some(why.clone());
                }
            }
            Sent::Later(why) => {
                self.unreachable += 1;
                self.last_failure = Some(why.clone());
            }
        }
    }

    fn pending(&self, pull: &str) -> Pending {
        Pending {
            jobs: self.saved.jobs.iter().filter(|j| j.change.pull() == pull).cloned().collect(),
            ids: self.saved.ids.iter().filter(|(_, s)| s.pull == pull).map(|(k, s)| (k.clone(), s.comment.clone())).collect(),
        }
    }

    /// Refused changes get another go.
    fn retry(&mut self, pull: Option<&str>) {
        for job in &mut self.saved.jobs {
            if pull.is_none_or(|p| job.change.pull() == p) {
                job.error = None;
            }
        }
    }

    /// The review was sent or thrown away: nothing of it is left to send or to know.
    fn forget(&mut self, pull: &str) {
        self.saved.jobs.retain(|j| j.change.pull() != pull);
        self.saved.ids.retain(|_, s| s.pull != pull);
    }
}

#[derive(Debug, PartialEq)]
enum Sent {
    /// GitHub took it; a new comment's id.
    Done(Option<String>),
    /// GitHub couldn't be reached or is busy: try again later.
    Later(String),
    /// GitHub answered no, and why.
    Refused(String),
}

pub struct Drafts {
    queue: Arc<(Mutex<Queue>, Condvar, Condvar)>,
    file: Option<PathBuf>,
}

impl Drafts {
    /// Reads what was left from last time and starts sending it; what GitHub refused before gets
    /// one more go.
    pub fn start(app: &AppHandle) -> Drafts {
        let file = app.path().app_config_dir().ok().map(|d| d.join("drafts.json"));
        let saved: Saved = file.as_ref().and_then(|f| fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let mut queue = Queue { woken: !saved.jobs.is_empty(), saved, ..Queue::default() };
        queue.retry(None);
        let queue = Arc::new((Mutex::new(queue), Condvar::new(), Condvar::new()));
        let drafts = Drafts { queue: queue.clone(), file: file.clone() };
        let app = app.clone();
        std::thread::spawn(move || run(&app, &queue, file.as_deref()));
        drafts
    }

    fn change(&self, f: impl FnOnce(&mut Queue)) {
        let (lock, wake, _) = &*self.queue;
        let mut queue = lock.held();
        f(&mut queue);
        queue.woken = true;
        crate::disk::save_json(self.file.as_deref(), &queue.saved);
        wake.notify_one();
    }

    pub fn put(&self, put: Put) {
        self.change(|q| q.put(put));
    }

    pub fn remove(&self, pull: String, key: String, id: Option<String>) {
        self.change(|q| q.remove(pull, key, id));
    }

    pub fn retry(&self, pull: &str) {
        self.change(|q| q.retry(Some(pull)));
    }

    pub fn forget(&self, pull: &str) {
        self.change(|q| q.forget(pull));
    }

    pub fn pending(&self, pull: &str) -> Pending {
        self.queue.0.held().pending(pull)
    }

    /// Waits until every change to a pull request's comments is on GitHub, to submit the review
    /// with all of them. Blocking: run it off the main thread. Fails at once with what GitHub
    /// refused, or when it can't be reached.
    pub fn flush(&self, pull: &str) -> Result<(), String> {
        let (lock, wake, done) = &*self.queue;
        let deadline = Instant::now() + FLUSH_FOR;
        let mut queue = lock.held();
        let unreachable = queue.unreachable;
        loop {
            let jobs: Vec<&Job> = queue.saved.jobs.iter().filter(|j| j.change.pull() == pull).collect();
            if let Some(why) = jobs.iter().find_map(|j| j.error.clone()) {
                return Err(why);
            }
            if jobs.is_empty() {
                return Ok(());
            }
            if queue.unreachable > unreachable {
                return Err(queue.last_failure.clone().unwrap_or_else(|| tr!("Couldn't reach GitHub", "Não foi possível falar com o GitHub")));
            }
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err(tr!("GitHub is taking too long: your comments are kept, try again", "O GitHub está demorando: seus comentários estão guardados, tente de novo"));
            }
            queue.woken = true;
            wake.notify_one();
            queue = done.wait_timeout(queue, left).unwrap().0;
        }
    }
}

fn run(app: &AppHandle, queue: &(Mutex<Queue>, Condvar, Condvar), file: Option<&Path>) {
    let (lock, wake, done) = queue;
    let mut failures = 0u32;
    loop {
        let (job, synced) = {
            let mut q = lock.held();
            loop {
                if let Some(job) = q.next() {
                    q.woken = false;
                    let synced = q.saved.ids.get(job.change.key()).map(|s| s.comment.clone());
                    break (job, synced);
                }
                q = wake.wait(q).unwrap();
            }
        };
        let sent = send(&app.state::<github::Auth>(), &job, synced);
        let mut q = lock.held();
        failures = if matches!(sent, Sent::Later(_)) { failures + 1 } else { 0 };
        q.settle(&job, &sent);
        crate::disk::save_json(file, &q.saved);
        done.notify_all();
        // The window showing this pull request reads what changed.
        let _ = app.emit("drafts", job.change.pull());
        if failures > 0 && !q.woken {
            let wait = Duration::from_secs(1 << (failures.min(6) - 1)).min(LONGEST_WAIT);
            drop(wake.wait_timeout_while(q, wait, |q| !q.woken).unwrap());
        }
    }
}

fn send(auth: &github::Auth, job: &Job, synced: Option<String>) -> Sent {
    match &job.change {
        Change::Put(put) => match put.id.clone().or(synced) {
            Some(id) => match graphql(
                auth,
                "mutation($id: ID!, $body: String!) { updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) { pullRequestReviewComment { id } } }",
                json!({ "id": id, "body": put.body }),
            ) {
                Ok(_) => Sent::Done(Some(id)),
                Err(sent) => sent,
            },
            None => create(auth, put).unwrap_or_else(|sent| sent),
        },
        Change::Remove { id, .. } => {
            let Some(id) = id.clone().or(synced) else { return Sent::Done(None) };
            match graphql(auth, "mutation($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }", json!({ "id": id })) {
                // Refused: already gone (deleted or sent on github.com), or never to be; either way
                // there's nothing more to do here.
                Ok(_) | Err(Sent::Refused(_)) => Sent::Done(None),
                Err(sent) => sent,
            }
        }
    }
}

/// A new comment: into your pending review (started now if there's none), unless a send that
/// seemed to fail did reach GitHub and it's there already.
fn create(auth: &github::Auth, put: &Put) -> Result<Sent, Sent> {
    let data = graphql(
        auth,
        "query($id: ID!) { node(id: $id) { ... on PullRequest { reviews(states: PENDING, first: 5) { nodes { id viewerDidAuthor comments(first: 100) { nodes { id body path line } } } } } } }",
        json!({ "id": put.pull }),
    )?;
    let reviews = data["node"]["reviews"]["nodes"].as_array().cloned().unwrap_or_default();
    let review = match reviews.iter().find(|r| r["viewerDidAuthor"].as_bool() == Some(true)) {
        Some(review) => {
            let twin = review["comments"]["nodes"].as_array().and_then(|comments| {
                comments.iter().find(|c| c["body"].as_str() == Some(&put.body) && c["path"].as_str() == Some(&put.path) && (put.file || c["line"].as_u64() == Some(put.line.into())))
            });
            if let Some(id) = twin.and_then(|c| c["id"].as_str()) {
                return Ok(Sent::Done(Some(id.to_string())));
            }
            review["id"].as_str().unwrap_or_default().to_string()
        }
        None => {
            let data = graphql(auth, "mutation($id: ID!) { addPullRequestReview(input: { pullRequestId: $id }) { pullRequestReview { id } } }", json!({ "id": put.pull }))?;
            data["addPullRequestReview"]["pullRequestReview"]["id"].as_str().unwrap_or_default().to_string()
        }
    };
    let id = match &put.reply_to {
        Some(thread) => {
            let data = graphql(
                auth,
                "mutation($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id } } }",
                json!({ "review": review, "thread": thread, "body": put.body }),
            )?;
            data["addPullRequestReviewThreadReply"]["comment"]["id"].as_str().map(String::from)
        }
        None => {
            let side_of = |s: &str| if s == "deletions" { "LEFT" } else { "RIGHT" };
            let side = side_of(&put.side);
            let start_side = put.start_side.as_deref().map_or(side, side_of);
            let mut input = json!({ "pullRequestReviewId": review, "path": put.path, "body": put.body });
            if put.file {
                input["subjectType"] = json!("FILE");
            } else {
                input["line"] = json!(put.line);
                input["side"] = json!(side);
                if let Some(start) = put.start_line.filter(|s| *s != put.line || start_side != side) {
                    input["startLine"] = json!(start);
                    input["startSide"] = json!(start_side);
                }
            }
            let data = graphql(
                auth,
                "mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { comments(first: 1) { nodes { id } } } } }",
                json!({ "input": input }),
            )?;
            data["addPullRequestReviewThread"]["thread"]["comments"]["nodes"][0]["id"].as_str().map(String::from)
        }
    };
    Ok(Sent::Done(id))
}

/// A GraphQL call as a page's write (so what the pages read next isn't from before it). Errors in
/// the answer are GitHub's no.
fn graphql(auth: &github::Auth, query: &str, variables: Value) -> Result<Value, Sent> {
    let body = json!({ "query": query, "variables": variables }).to_string();
    match auth.request_for_page("POST", "/graphql", Some(&body), None) {
        Ok((200, text)) => {
            let reply: Value = serde_json::from_str(&text).unwrap_or_default();
            match reply["errors"].as_array().and_then(|e| e.first()) {
                Some(error) => Err(Sent::Refused(error["message"].as_str().unwrap_or("GitHub refused it").to_string())),
                None => Ok(reply["data"].clone()),
            }
        }
        // Offline, signed out for now, rate limited or GitHub having trouble.
        Err(e) => Err(Sent::Later(e)),
        Ok((status, _)) if status == 401 || status == 403 || status == 429 || status >= 500 => Err(Sent::Later(tr!("GitHub returned {status}", "O GitHub respondeu {status}"))),
        Ok((status, text)) => {
            let reply: Value = serde_json::from_str(&text).unwrap_or_default();
            Err(Sent::Refused(reply["message"].as_str().map(String::from).unwrap_or_else(|| tr!("GitHub returned {status}", "O GitHub respondeu {status}"))))
        }
    }
}


#[cfg(test)]
mod tests {
    use super::*;

    fn put(key: &str, body: &str) -> Put {
        Put { key: key.into(), pull: "PR_1".into(), path: "a.ts".into(), line: 3, side: "additions".into(), start_line: None, start_side: None, file: false, body: body.into(), id: None, reply_to: None }
    }

    #[test]
    fn the_latest_text_wins() {
        let mut q = Queue::default();
        q.put(put("k1", "first"));
        q.put(put("k2", "other"));
        q.put(put("k1", "second"));
        let bodies: Vec<_> = q.saved.jobs.iter().map(|j| match &j.change { Change::Put(p) => p.body.clone(), _ => String::new() }).collect();
        assert_eq!(bodies, ["other", "second"]);
    }

    #[test]
    fn a_change_made_while_sending_stays_and_gets_the_id() {
        let mut q = Queue::default();
        q.put(put("k1", "first"));
        let sending = q.next().unwrap();
        q.put(put("k1", "second"));
        q.settle(&sending, &Sent::Done(Some("C_1".into())));
        assert_eq!(q.saved.jobs.len(), 1);
        assert_eq!(q.pending("PR_1").ids.get("k1").map(String::as_str), Some("C_1"));
    }

    #[test]
    fn removing_drops_what_wasnt_sent_and_forgets_the_id_once_deleted() {
        let mut q = Queue::default();
        q.put(put("k1", "first"));
        let sending = q.next().unwrap();
        q.settle(&sending, &Sent::Done(Some("C_1".into())));
        q.put(put("k1", "edit"));
        q.remove("PR_1".into(), "k1".into(), None);
        assert_eq!(q.saved.jobs.len(), 1);
        let removing = q.next().unwrap();
        assert!(matches!(removing.change, Change::Remove { .. }));
        q.settle(&removing, &Sent::Done(None));
        assert!(q.saved.jobs.is_empty() && q.saved.ids.is_empty());
    }

    #[test]
    fn a_refusal_is_kept_with_why_and_waits_for_the_person() {
        let mut q = Queue::default();
        q.put(put("k1", "first"));
        q.put(put("k2", "second"));
        let first = q.next().unwrap();
        q.settle(&first, &Sent::Refused("line must be part of the diff".into()));
        assert_eq!(q.saved.jobs[0].error.as_deref(), Some("line must be part of the diff"));
        // The next one isn't held up by it.
        assert!(matches!(q.next().unwrap().change, Change::Put(ref p) if p.key == "k2"));
        q.retry(Some("PR_1"));
        assert!(q.saved.jobs.iter().all(|j| j.error.is_none()));
    }

    #[test]
    fn failing_to_reach_github_keeps_the_job() {
        let mut q = Queue::default();
        q.put(put("k1", "first"));
        let first = q.next().unwrap();
        q.settle(&first, &Sent::Later("offline".into()));
        assert_eq!(q.saved.jobs.len(), 1);
        assert_eq!(q.unreachable, 1);
    }

    #[test]
    fn forgetting_a_pull_request_leaves_the_others() {
        let mut q = Queue::default();
        q.put(put("k1", "first"));
        q.put(Put { pull: "PR_2".into(), ..put("k2", "second") });
        q.forget("PR_1");
        assert_eq!(q.saved.jobs.len(), 1);
        assert_eq!(q.saved.jobs[0].change.pull(), "PR_2");
    }

    #[test]
    fn reads_what_the_window_sends() {
        let change: Change = serde_json::from_str(r#"{"op":"put","key":"k","pull":"PR_1","path":"a.ts","line":0,"side":"additions","file":true,"body":"x"}"#).unwrap();
        assert!(matches!(change, Change::Put(Put { file: true, .. })));
    }
}
