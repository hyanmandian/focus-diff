// Viewed marks on their way to GitHub. What's marked in the app is what counts: each mark is kept
// on disk and sent until GitHub takes it, through failures, sleep and restarts, the latest mark
// per file winning. Sent as soon as it's made; after a failure, again in 1s, 2s, 4s… up to 30s.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime};

use crate::github;

/// One file to mark viewed, or not, on a pull request (its node id).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    pub pull: String,
    pub path: String,
    pub viewed: bool,
    /// Times GitHub answered but didn't take it, to give up on one it never will.
    #[serde(default)]
    refused: u32,
}

/// A mark GitHub keeps refusing (the file left the pull request, the pull request is gone) is
/// dropped after this many tries.
const MOST_REFUSALS: u32 = 8;
const LONGEST_WAIT: Duration = Duration::from_secs(30);

enum Sent {
    Done,
    /// GitHub couldn't be reached or is busy: try again later.
    Later,
    /// GitHub answered no.
    Refused,
}

#[derive(Default)]
struct Queue {
    marks: Vec<Mark>,
    /// Something new to send: skip the wait.
    woken: bool,
}

pub struct Outbox {
    queue: Arc<(Mutex<Queue>, Condvar)>,
    file: Option<PathBuf>,
}

impl Outbox {
    /// Reads what was left from last time and starts sending it.
    pub fn start<R: Runtime>(app: &AppHandle<R>) -> Outbox {
        let file = app.path().app_config_dir().ok().map(|d| d.join("outbox.json"));
        let marks: Vec<Mark> = file.as_ref().and_then(|f| fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let queue = Arc::new((Mutex::new(Queue { woken: !marks.is_empty(), marks }), Condvar::new()));
        let outbox = Outbox { queue: queue.clone(), file: file.clone() };
        let app = app.clone();
        std::thread::spawn(move || run(&app, &queue, file.as_ref()));
        outbox
    }

    /// Queues a mark, replacing any earlier one for the same file, and sends it now.
    pub fn add(&self, pull: String, path: String, viewed: bool) {
        let (lock, wake) = &*self.queue;
        let mut queue = lock.lock().unwrap();
        queue.marks.retain(|m| !(m.pull == pull && m.path == path));
        queue.marks.push(Mark { pull, path, viewed, refused: 0 });
        queue.woken = true;
        save(self.file.as_ref(), &queue.marks);
        wake.notify_one();
    }

    /// The marks still on their way for a pull request, by path: what GitHub says of these files
    /// is older than what's been marked here.
    pub fn pending(&self, pull: &str) -> HashMap<String, bool> {
        let queue = self.queue.0.lock().unwrap();
        queue.marks.iter().filter(|m| m.pull == pull).map(|m| (m.path.clone(), m.viewed)).collect()
    }
}

fn run<R: Runtime>(app: &AppHandle<R>, queue: &(Mutex<Queue>, Condvar), file: Option<&PathBuf>) {
    let (lock, wake) = queue;
    let mut failures = 0u32;
    loop {
        let next = {
            let mut q = lock.lock().unwrap();
            while q.marks.is_empty() {
                q = wake.wait(q).unwrap();
            }
            q.woken = false;
            q.marks[0].clone()
        };
        let sent = send(&app.state::<github::Auth>(), &next);
        let mut q = lock.lock().unwrap();
        // Only if it's still the latest mark for that file: a newer one made meanwhile stays.
        let still = q.marks.iter().position(|m| m.pull == next.pull && m.path == next.path && m.viewed == next.viewed);
        match sent {
            Sent::Done => {
                failures = 0;
                if let Some(i) = still {
                    q.marks.remove(i);
                }
            }
            Sent::Refused => {
                // Waits like a failure, so it isn't asked again at once.
                failures += 1;
                if let Some(i) = still {
                    q.marks[i].refused += 1;
                    let mark = q.marks.remove(i);
                    // To the back, so one GitHub won't take doesn't hold up the rest.
                    if mark.refused < MOST_REFUSALS {
                        q.marks.push(mark);
                    }
                }
            }
            Sent::Later => failures += 1,
        }
        save(file, &q.marks);
        if failures > 0 && !q.woken {
            let wait = Duration::from_secs(1 << (failures.min(6) - 1)).min(LONGEST_WAIT);
            drop(wake.wait_timeout_while(q, wait, |q| !q.woken).unwrap());
        }
    }
}

fn send(auth: &github::Auth, mark: &Mark) -> Sent {
    let field = if mark.viewed { "markFileAsViewed" } else { "unmarkFileAsViewed" };
    let body = serde_json::json!({
        "query": format!("mutation($id: ID!, $path: String!) {{ {field}(input: {{ pullRequestId: $id, path: $path }}) {{ clientMutationId }} }}"),
        "variables": { "id": mark.pull, "path": mark.path },
    })
    .to_string();
    // As a page's write, so what the pages read next isn't from before it.
    match auth.request_for_page("POST", "/graphql", Some(&body), None) {
        Ok((200, text)) => {
            let reply: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            // A refusal still comes back as 200, with the field empty.
            if reply["data"][field].is_object() { Sent::Done } else { Sent::Refused }
        }
        // Offline, signed out for now, rate limited or GitHub having trouble.
        Err(_) => Sent::Later,
        Ok((status, _)) if status == 401 || status == 403 || status == 429 || status >= 500 => Sent::Later,
        Ok(_) => Sent::Refused,
    }
}

/// Written next to the file and moved into place, so a crash mid-write never leaves half a file.
fn save(file: Option<&PathBuf>, marks: &[Mark]) {
    let Some(file) = file else { return };
    let temporary = file.with_extension("tmp");
    if let Some(dir) = file.parent() {
        let _ = fs::create_dir_all(dir);
    }
    if fs::write(&temporary, serde_json::to_string(marks).unwrap_or_default()).is_ok() {
        let _ = fs::rename(&temporary, file);
    }
}
