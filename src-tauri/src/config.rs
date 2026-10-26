//! The part of the person's setup (config.json) that the queue engine needs. The settings window
//! owns the file and writes it complete (src/lib/config.ts); this side only reads it, so anything
//! missing or unknown falls back to the same defaults instead of failing.

use serde::Deserialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Review,
    Involved,
    Authored,
    Merged,
    #[default]
    #[serde(other)]
    Custom,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Drafts {
    Show,
    Only,
    #[default]
    #[serde(other)]
    Hide,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SkipIfI {
    Approved,
    Reviewed,
    #[default]
    #[serde(other)]
    TookPart,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Queue {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub kind: Kind,
    pub repos: Vec<String>,
    pub teams: Vec<String>,
    pub direct_only: bool,
    pub hide_once_reviewed: bool,
    pub only_news: bool,
    pub drafts: Drafts,
    pub hide_bots: bool,
    pub exclude_authors: Vec<String>,
    pub include_labels: Vec<String>,
    pub exclude_labels: Vec<String>,
    pub include_paths: String,
    pub exclude_paths: String,
    pub merged_days: u32,
    pub requested_only: bool,
    pub skip_if_i: SkipIfI,
    pub skip_approved_by: Vec<String>,
    pub skip_merged_by: Vec<String>,
    pub query: String,
    pub notify: Vec<String>,
    /// What to leave out of its notifications: "drafts", "bots", "approved" (ones you approved).
    pub notify_leave_out: Vec<String>,
    /// Notifications only from these repositories ("owner/name" or "owner/*"); empty: all of the queue's.
    pub notify_repos: Vec<String>,
    /// Right away, or kept for the next review time. Missing: review queues wait, others don't.
    pub notify_at: Option<NotifyAt>,
}

impl Default for Queue {
    fn default() -> Self {
        Queue {
            id: String::new(),
            name: "Queue".into(),
            enabled: true,
            kind: Kind::Custom,
            repos: vec![],
            teams: vec![],
            direct_only: false,
            hide_once_reviewed: true,
            only_news: false,
            drafts: Drafts::Hide,
            hide_bots: true,
            exclude_authors: vec![],
            include_labels: vec![],
            exclude_labels: vec![],
            include_paths: String::new(),
            exclude_paths: String::new(),
            merged_days: 7,
            requested_only: false,
            skip_if_i: SkipIfI::TookPart,
            skip_approved_by: vec![],
            skip_merged_by: vec![],
            query: String::new(),
            notify: vec![],
            notify_leave_out: vec![],
            notify_repos: vec![],
            notify_at: None,
        }
    }
}

impl Queue {
    /// Path filters can only be checked against the files GitHub lists.
    pub fn needs_files(&self) -> bool {
        !self.include_paths.is_empty() || !self.exclude_paths.is_empty()
    }

    /// Whether its notifications wait for review time (when there is one to wait for).
    pub fn waits_for_review(&self) -> bool {
        self.notify_at.unwrap_or(if self.kind == Kind::Review { NotifyAt::Review } else { NotifyAt::Now }) == NotifyAt::Review
    }

    pub fn leaves_out(&self, what: &str) -> bool {
        self.notify_leave_out.iter().any(|w| w == what)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NotifyAt {
    Review,
    #[serde(other)]
    Now,
}

/// Which of the pull requests that fit a review time go first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Order {
    Quickest,
    Fill,
    #[default]
    #[serde(other)]
    Oldest,
}

/// A time set aside to review, like weekdays at 15:00 for half an hour.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Session {
    pub id: String,
    pub name: String,
    pub on: bool,
    /// Days of the week, 0 for Sunday.
    pub days: Vec<u8>,
    /// "HH:MM", local time.
    pub times: Vec<String>,
    pub minutes: u32,
    pub order: Order,
    /// The queues it picks from, by id; empty: every review queue.
    pub queues: Vec<String>,
    pub drafts: bool,
}

impl Default for Session {
    fn default() -> Self {
        Session { id: String::new(), name: String::new(), on: true, days: vec![1, 2, 3, 4, 5], times: vec!["15:00".into()], minutes: 30, order: Order::Oldest, queues: vec![], drafts: false }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviewTime {
    pub enabled: bool,
    pub sessions: Vec<Session>,
    /// Pull requests you were asked to review again go first, when they fit.
    pub again_first: bool,
    /// A notification when the time's up, saying how far it got.
    pub remind_end: bool,
    /// With nothing to review, the time passes without a word.
    pub skip_empty: bool,
    /// While reviewing, every notification waits for the time to be up.
    pub hold_while_reviewing: bool,
}

impl Default for ReviewTime {
    fn default() -> Self {
        ReviewTime { enabled: false, sessions: vec![], again_first: true, remind_end: true, skip_empty: true, hold_while_reviewing: false }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub queues: Vec<Queue>,
    pub poll_seconds: u64,
    pub sound: bool,
    pub review_time: ReviewTime,
}

impl Default for Config {
    fn default() -> Self {
        Config { queues: vec![], poll_seconds: 60, sound: false, review_time: ReviewTime::default() }
    }
}

impl Config {
    pub fn parse(text: &str) -> Option<Config> {
        let mut config: Config = serde_json::from_str(text).ok()?;
        config.poll_seconds = config.poll_seconds.clamp(30, 900);
        config.queues.retain(|q| !q.id.is_empty());
        for session in &mut config.review_time.sessions {
            session.minutes = session.minutes.clamp(5, 240);
            session.days.retain(|d| *d <= 6);
            session.times.retain(|t| crate::review::minutes_of(t).is_some());
        }
        Some(config)
    }

    pub fn enabled(&self) -> impl Iterator<Item = &Queue> {
        self.queues.iter().filter(|q| q.enabled)
    }
}
