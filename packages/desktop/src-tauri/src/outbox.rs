use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::github;
use crate::sync::Locked;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    pub pull: String,
    pub path: String,
    pub viewed: bool,
    #[serde(default)]
    refused: u32,
}

const MOST_REFUSALS: u32 = 8;
const LONGEST_WAIT: Duration = Duration::from_secs(30);

enum Sent {
    Done,
    Later,
    Refused,
}

#[derive(Default)]
struct Queue {
    marks: Vec<Mark>,
    woken: bool,
}

pub struct Outbox {
    queue: Arc<(Mutex<Queue>, Condvar)>,
    file: Option<PathBuf>,
}

impl Outbox {
    pub fn start(app: &AppHandle) -> Outbox {
        let file = app.path().app_config_dir().ok().map(|d| d.join("outbox.json"));
        let marks: Vec<Mark> = file.as_ref().and_then(|f| fs::read_to_string(f).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        let queue = Arc::new((Mutex::new(Queue { woken: !marks.is_empty(), marks }), Condvar::new()));
        let outbox = Outbox { queue: queue.clone(), file: file.clone() };
        let app = app.clone();
        std::thread::spawn(move || run(&app, &queue, file.as_deref()));
        outbox
    }

    pub fn add(&self, pull: String, path: String, viewed: bool) {
        let (lock, wake) = &*self.queue;
        let mut queue = lock.held();
        queue.marks.retain(|m| !(m.pull == pull && m.path == path));
        queue.marks.push(Mark { pull, path, viewed, refused: 0 });
        queue.woken = true;
        crate::disk::save_json(self.file.as_deref(), &queue.marks);
        wake.notify_one();
    }

    pub fn pending(&self, pull: &str) -> HashMap<String, bool> {
        let queue = self.queue.0.held();
        queue.marks.iter().filter(|m| m.pull == pull).map(|m| (m.path.clone(), m.viewed)).collect()
    }
}

fn run(app: &AppHandle, queue: &(Mutex<Queue>, Condvar), file: Option<&Path>) {
    let (lock, wake) = queue;
    let mut failures = 0u32;
    loop {
        let next = {
            let mut q = lock.held();
            while q.marks.is_empty() {
                q = wake.wait(q).unwrap();
            }
            q.woken = false;
            q.marks[0].clone()
        };
        let sent = send(&app.state::<github::Auth>(), &next);
        let mut q = lock.held();
        let still = q.marks.iter().position(|m| m.pull == next.pull && m.path == next.path && m.viewed == next.viewed);
        match sent {
            Sent::Done => {
                failures = 0;
                if let Some(i) = still {
                    q.marks.remove(i);
                }
            }
            Sent::Refused => {
                failures += 1;
                if let Some(i) = still {
                    q.marks[i].refused += 1;
                    let mark = q.marks.remove(i);
                    if mark.refused < MOST_REFUSALS {
                        q.marks.push(mark);
                    }
                }
            }
            Sent::Later => failures += 1,
        }
        crate::disk::save_json(file, &q.marks);
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
    match auth.request_for_page("POST", "/graphql", Some(&body), None) {
        Ok((200, text)) => {
            let reply: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
            if reply["data"][field].is_object() { Sent::Done } else { Sent::Refused }
        }
        Err(_) => Sent::Later,
        Ok((status, _)) if status == 401 || status == 403 || status == 429 || status >= 500 => Sent::Later,
        Ok(_) => Sent::Refused,
    }
}

