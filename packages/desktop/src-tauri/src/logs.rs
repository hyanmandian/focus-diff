//! A GitHub Actions job's log, for a check opened in the review window. GitHub answers the API with
//! a redirect to a short-lived download on its storage; that's followed here without the token, and
//! only to GitHub's own storage hosts. A long log is read through and only its end is kept (where a
//! failure is), so a huge one never fills memory. Finished jobs' logs don't change: they're kept.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::github::{self, name_ok, Auth};
use crate::i18n::tr;
use crate::sync::Locked;

/// The most of a log kept: its last megabyte.
const TAIL: usize = 1024 * 1024;
/// The most read through to find the end, so a runaway log can't keep a download going.
const READ_AT_MOST: u64 = 512 * 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct Log {
    pub text: String,
    /// Only its end is here.
    pub truncated: bool,
}

/// Finished jobs' logs, by job id; the oldest go past a few.
#[derive(Default)]
pub struct Logs {
    kept: Mutex<(HashMap<u64, Log>, VecDeque<u64>)>,
}

impl Logs {
    const MOST: usize = 12;

    fn get(&self, job: u64) -> Option<Log> {
        self.kept.held().0.get(&job).cloned()
    }

    fn put(&self, job: u64, log: Log) {
        let mut kept = self.kept.held();
        let (map, order) = &mut *kept;
        if map.insert(job, log).is_none() {
            order.push_back(job);
        }
        while order.len() > Self::MOST {
            if let Some(old) = order.pop_front() {
                map.remove(&old);
            }
        }
    }
}

/// Only GitHub's storage for Actions logs, over https: whatever else a redirect says isn't followed.
fn trusted(url: &str) -> bool {
    github::https_host(url).is_some_and(|host| [".blob.core.windows.net", ".actions.githubusercontent.com", ".githubusercontent.com"].iter().any(|s| host.ends_with(s)))
}

/// The last `max` bytes of what `reader` gives, and whether there was more before them. When cut,
/// it starts at a line's start, so the first line shown is whole.
pub fn tail(reader: impl Read, max: usize) -> std::io::Result<(Vec<u8>, bool)> {
    let mut reader = reader;
    let mut kept: VecDeque<u8> = VecDeque::with_capacity(max.min(64 * 1024));
    let mut cut = false;
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        kept.extend(&buffer[..n]);
        if kept.len() > max {
            kept.drain(..kept.len() - max);
            cut = true;
        }
    }
    let mut bytes: Vec<u8> = kept.into();
    if cut && let Some(newline) = bytes.iter().position(|b| *b == b'\n') {
        bytes.drain(..=newline);
    }
    Ok((bytes, cut))
}

pub fn job_log(auth: &Auth, logs: &Logs, owner: &str, repo: &str, job: u64, done: bool) -> Result<Log, String> {
    if !name_ok(owner) || !name_ok(repo) {
        return Err("Bad request".into());
    }
    if done && let Some(log) = logs.get(job) {
        return Ok(log);
    }
    let (status, location) = auth.redirect(&format!("/repos/{owner}/{repo}/actions/jobs/{job}/logs"))?;
    let location = match (status, location) {
        (300..=399, Some(location)) => location,
        (404 | 410, _) => return Err(tr!("This job's log isn't available (yet, or any more).", "O log deste job não está disponível (ainda, ou não mais).")),
        (403, _) => return Err(tr!("You can't read this job's log.", "Você não pode ler o log deste job.")),
        _ => return Err(tr!("GitHub returned {status}", "O GitHub respondeu {status}")),
    };
    if !trusted(&location) {
        return Err(tr!("GitHub sent the log from somewhere unexpected.", "O GitHub mandou o log de um lugar inesperado."));
    }
    let response = github::agent()
        .get(&location)
        .config()
        .max_redirects(0)
        .timeout_global(Some(Duration::from_secs(120)))
        .build()
        .call()
        .map_err(|e| tr!("Couldn't download the log: {e}", "Não foi possível baixar o log: {e}"))?;
    if response.status().as_u16() != 200 {
        let status = response.status().as_u16();
        return Err(tr!("GitHub returned {status}", "O GitHub respondeu {status}"));
    }
    let (bytes, truncated) = tail(response.into_body().into_reader().take(READ_AT_MOST), TAIL).map_err(|e| e.to_string())?;
    let log = Log { text: String::from_utf8_lossy(&bytes).into_owned(), truncated };
    if done {
        logs.put(job, log.clone());
    }
    Ok(log)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_short_log_whole() {
        let (bytes, cut) = tail(&b"one\ntwo\n"[..], 100).unwrap();
        assert_eq!(bytes, b"one\ntwo\n");
        assert!(!cut);
    }

    #[test]
    fn keeps_the_end_of_a_long_one_from_a_line_start() {
        let log = (0..1000).map(|i| format!("line {i}\n")).collect::<String>();
        let (bytes, cut) = tail(log.as_bytes(), 50).unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(cut);
        assert!(text.ends_with("line 999\n"));
        assert!(text.starts_with("line "));
        assert!(text.len() <= 50);
    }

    #[test]
    fn follows_only_github_storage() {
        assert!(trusted("https://productionresultssa11.blob.core.windows.net/actions-results/x?sig=1"));
        assert!(trusted("https://pipelines.actions.githubusercontent.com/abc"));
        assert!(!trusted("http://productionresultssa11.blob.core.windows.net/x"));
        assert!(!trusted("https://evil.com/.blob.core.windows.net"));
        assert!(!trusted("https://user@x.blob.core.windows.net/"));
        assert!(!trusted("https://blob.core.windows.net.evil.com/"));
    }
}
