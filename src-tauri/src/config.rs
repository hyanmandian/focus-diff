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
        }
    }
}

impl Queue {
    /// Path filters can only be checked against the files GitHub lists.
    pub fn needs_files(&self) -> bool {
        !self.include_paths.is_empty() || !self.exclude_paths.is_empty()
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub queues: Vec<Queue>,
    pub poll_seconds: u64,
    pub sound: bool,
}

impl Default for Config {
    fn default() -> Self {
        Config { queues: vec![], poll_seconds: 60, sound: false }
    }
}

impl Config {
    pub fn parse(text: &str) -> Option<Config> {
        let mut config: Config = serde_json::from_str(text).ok()?;
        config.poll_seconds = config.poll_seconds.clamp(30, 900);
        config.queues.retain(|q| !q.id.is_empty());
        Some(config)
    }

    pub fn enabled(&self) -> impl Iterator<Item = &Queue> {
        self.queues.iter().filter(|q| q.enabled)
    }
}
