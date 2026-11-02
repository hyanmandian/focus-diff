use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::ai::Usage;
use crate::disk;
use crate::sync::Locked;

const LARGEST: usize = 4 * 1024 * 1024;
const NOTE: usize = 64 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Running,
    Done,
    Failed,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub kind: String,
    pub key: String,
    pub head: String,
    pub at: u64,
    pub status: Status,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub project: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(default)]
    pub meta: String,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub dismissed: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keep {
    pub pull: String,
    pub kind: String,
    pub key: String,
    pub head: String,
    pub meta: String,
}

pub enum Outcome<'a> {
    Done { text: &'a str, project: bool, note: Option<&'a str>, usage: Option<&'a Usage> },
    Failed(&'a str),
    Stopped,
}

fn lock() -> &'static Mutex<()> {
    static LOCK: Mutex<()> = Mutex::new(());
    &LOCK
}

fn short(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && value.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
}

pub fn valid(keep: &Keep) -> bool {
    short(&keep.pull, 64) && short(&keep.kind, 16) && keep.key.len() <= 512 && keep.head.len() <= 64 && keep.meta.len() <= LARGEST
}

fn file(dir: &Path, pull: &str) -> Option<PathBuf> {
    short(pull, 64).then(|| dir.join(format!("{}.json", disk::name(pull))))
}

fn read(path: &Path) -> Result<Vec<Record>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    serde_json::from_str(&text).or_else(|_| {
        std::fs::rename(path, path.with_extension(format!("{}.bad", now()))).map_err(|e| e.to_string())?;
        Ok(Vec::new())
    })
}

fn write(path: &Path, records: &[Record]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    disk::write(path, serde_json::to_string(records).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn change(dir: &Path, pull: &str, edit: impl FnOnce(&mut Vec<Record>)) -> Result<(), String> {
    let path = file(dir, pull).ok_or("Bad pull request")?;
    let _held = lock().held();
    let mut records = read(&path)?;
    edit(&mut records);
    write(&path, &records)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

fn clip(text: &str, limit: usize) -> String {
    let mut end = text.len().min(limit);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_string()
}

pub fn begin(dir: &Path, keep: &Keep, run: &str) -> Result<(), String> {
    change(dir, &keep.pull, |records| {
        records.retain(|r| r.id != run);
        records.push(Record {
            id: run.to_string(),
            kind: keep.kind.clone(),
            key: keep.key.clone(),
            head: keep.head.clone(),
            at: now(),
            status: Status::Running,
            text: None,
            error: None,
            project: false,
            note: None,
            usage: None,
            meta: keep.meta.clone(),
            archived: false,
            dismissed: Vec::new(),
        });
    })
}

pub fn finish(dir: &Path, pull: &str, run: &str, outcome: &Outcome) -> Result<(), String> {
    change(dir, pull, |records| {
        let Some(record) = records.iter_mut().find(|r| r.id == run) else { return };
        match outcome {
            Outcome::Done { text, project, note, usage } => {
                record.status = Status::Done;
                record.text = Some(clip(text, LARGEST));
                record.project = *project;
                record.note = note.map(|n| clip(n, NOTE));
                record.usage = usage.cloned();
            }
            Outcome::Failed(error) => {
                record.status = Status::Failed;
                record.error = Some(clip(error, NOTE));
            }
            Outcome::Stopped => record.status = Status::Stopped,
        }
    })
}

pub fn list(dir: &Path, pull: &str, running: impl Fn(&str) -> bool, interrupted: &str) -> Result<Vec<Record>, String> {
    let Some(path) = file(dir, pull) else { return Ok(Vec::new()) };
    let _held = lock().held();
    let mut records = read(&path)?;
    let mut lost = false;
    for record in records.iter_mut().filter(|r| r.status == Status::Running && !running(&r.id)) {
        record.status = Status::Failed;
        record.error = Some(interrupted.to_string());
        lost = true;
    }
    if lost {
        write(&path, &records)?;
    }
    Ok(records)
}

pub fn mark(dir: &Path, pull: &str, id: &str, archived: Option<bool>, dismiss: Option<String>) -> Result<(), String> {
    change(dir, pull, |records| {
        for record in records.iter_mut().filter(|r| r.id == id) {
            if let Some(archived) = archived {
                record.archived = archived;
            }
            if let Some(key) = dismiss.as_ref().filter(|d| d.len() <= NOTE)
                && !record.dismissed.contains(key)
                && record.dismissed.len() < 1000
            {
                record.dismissed.push(key.clone());
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("fd-saved-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn keep(pull: &str) -> Keep {
        Keep { pull: pull.into(), kind: "analysis".into(), key: String::new(), head: "abc".into(), meta: "{}".into() }
    }

    #[test]
    fn keeps_a_run_from_start_to_finish() {
        let dir = folder("finish");
        begin(&dir, &keep("PR_1"), "run-1").unwrap();
        let running = list(&dir, "PR_1", |_| true, "Lost").unwrap();
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].status, Status::Running);
        let usage = Usage { output: 7, ..Usage::default() };
        finish(&dir, "PR_1", "run-1", &Outcome::Done { text: "{}", project: true, note: Some("Read the diff only"), usage: Some(&usage) }).unwrap();
        let done = &list(&dir, "PR_1", |_| false, "Lost").unwrap()[0];
        assert_eq!((done.status, done.text.as_deref(), done.project, done.note.as_deref()), (Status::Done, Some("{}"), true, Some("Read the diff only")));
        assert_eq!(done.usage.as_ref().map(|u| u.output), Some(7));
        assert_eq!(list(&dir, "PR_2", |_| false, "Lost").unwrap(), Vec::<Record>::new());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn says_why_a_run_ended_without_an_answer() {
        let dir = folder("ended");
        begin(&dir, &keep("PR_1"), "a").unwrap();
        begin(&dir, &keep("PR_1"), "b").unwrap();
        begin(&dir, &keep("PR_1"), "c").unwrap();
        finish(&dir, "PR_1", "a", &Outcome::Failed("No quota")).unwrap();
        finish(&dir, "PR_1", "b", &Outcome::Stopped).unwrap();
        finish(&dir, "PR_1", "missing", &Outcome::Stopped).unwrap();
        let records = list(&dir, "PR_1", |_| false, "The app quit first").unwrap();
        let ends: Vec<_> = records.iter().map(|r| (r.status, r.error.as_deref())).collect();
        assert_eq!(ends, [(Status::Failed, Some("No quota")), (Status::Stopped, None), (Status::Failed, Some("The app quit first"))]);
        assert_eq!(list(&dir, "PR_1", |_| true, "Other").unwrap()[2].error.as_deref(), Some("The app quit first"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn archives_and_dismisses_without_losing_the_answer() {
        let dir = folder("mark");
        begin(&dir, &keep("PR_1"), "a").unwrap();
        begin(&dir, &keep("PR_1"), "a").unwrap();
        mark(&dir, "PR_1", "a", Some(true), Some("src/a.ts:3".into())).unwrap();
        mark(&dir, "PR_1", "a", None, Some("src/b.ts:4".into())).unwrap();
        mark(&dir, "PR_1", "a", None, Some("src/a.ts:3".into())).unwrap();
        mark(&dir, "PR_1", "a", None, None).unwrap();
        let records = list(&dir, "PR_1", |_| true, "Lost").unwrap();
        assert_eq!(records.len(), 1);
        assert!(records[0].archived);
        assert_eq!(records[0].dismissed, ["src/a.ts:3", "src/b.ts:4"]);
        mark(&dir, "PR_1", "a", Some(false), None).unwrap();
        assert!(!list(&dir, "PR_1", |_| true, "Lost").unwrap()[0].archived);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn refuses_what_it_shouldnt_keep() {
        let dir = folder("refuse");
        assert!(valid(&keep("PR_1")));
        assert!(!valid(&keep("../etc")));
        assert!(!valid(&Keep { kind: String::new(), ..keep("PR_1") }));
        assert!(!valid(&Keep { head: "x".repeat(65), ..keep("PR_1") }));
        assert!(begin(&dir, &keep("a/b"), "a").is_err());
        assert_eq!(list(&dir, "", |_| true, "Lost").unwrap(), Vec::<Record>::new());
        assert_eq!(clip("ãbc", 1), "");
        assert_eq!(clip("abc", 2), "ab");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(file(&dir, "PR_1").unwrap(), "not json").unwrap();
        assert_eq!(list(&dir, "PR_1", |_| true, "Lost").unwrap(), Vec::<Record>::new());
        let kept: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(Result::ok).filter(|e| e.path().extension().is_some_and(|x| x == "bad")).collect();
        assert_eq!(kept.len(), 1);
        assert_eq!(std::fs::read_to_string(kept[0].path()).unwrap(), "not json");
        let _ = std::fs::remove_dir_all(dir);
    }
}
