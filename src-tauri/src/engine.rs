//! Turns the person's queues into GitHub searches, and the pull requests found into items with
//! events: what's new on each one since they last looked.
//!
//! Fetching is in two steps, to keep GitHub fast and cheap: every refresh runs a light search per
//! queue (ids, last update, head commit, CI), and only the pull requests that changed since last
//! time are fetched in full. The full ones are kept in a `Cache`, saved between launches, so the
//! panel has something to show the moment it opens.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, OnceLock};

use regex::Regex;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};

use crate::config::{Drafts, Kind, Queue, SkipIfI};
use crate::i18n::tr;

// MARK: GitHub data

/// A GraphQL connection's nodes. GitHub can return nulls in them (things the token can't read)
/// and, in a mixed search, empty objects: those are dropped rather than failing the whole page.
#[derive(Clone, Debug, Serialize)]
pub struct Nodes<T> {
    pub nodes: Vec<T>,
}

impl<T> Default for Nodes<T> {
    fn default() -> Self {
        Nodes { nodes: vec![] }
    }
}

impl<'de, T: DeserializeOwned> Deserialize<'de> for Nodes<T> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct Raw {
            #[serde(default)]
            nodes: Vec<Value>,
        }
        let raw = Option::<Raw>::deserialize(deserializer)?;
        let nodes = raw.map(|r| r.nodes).unwrap_or_default();
        Ok(Nodes { nodes: nodes.into_iter().filter(|v| !v.is_null()).filter_map(|v| serde_json::from_value(v).ok()).collect() })
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Actor {
    #[serde(rename = "__typename", default, skip_serializing_if = "Option::is_none")]
    pub typename: Option<String>,
    #[serde(default)]
    pub login: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Comment {
    pub author: Option<Actor>,
    pub created_at: Option<String>,
    pub body: Option<String>,
    pub url: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Review {
    pub author: Option<Actor>,
    pub state: String,
    pub submitted_at: Option<String>,
    pub url: String,
    /// What the review said, if anything (not sent to the panel).
    #[serde(skip_serializing)]
    pub body: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Oid {
    pub oid: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MyReview {
    pub state: String,
    pub submitted_at: Option<String>,
    pub commit: Option<Oid>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Thread {
    pub comments: Nodes<Comment>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct State {
    pub state: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Commit {
    pub committed_date: Option<String>,
    pub status_check_rollup: Option<State>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct CommitNode {
    pub commit: Commit,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Login {
    pub login: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Removed {
    pub actor: Option<Login>,
}

/// A draft marked ready for review, and when.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Ready {
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Path {
    pub path: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Name {
    pub name: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Count {
    pub total_count: u32,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Repository {
    pub name_with_owner: String,
}

/// A user or a team asked to review (or something else GitHub may add, kept as its type name).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Reviewer {
    #[serde(rename = "__typename")]
    pub typename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub login: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization: Option<Login>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub members: Option<Nodes<Login>>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReviewRequest {
    pub requested_reviewer: Option<Reviewer>,
    /// On review request events: when it was asked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PullRequest {
    pub id: String,
    pub number: u64,
    pub title: String,
    pub url: String,
    pub is_draft: bool,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub merged_at: Option<String>,
    pub head_ref_oid: String,
    pub mergeable: String,
    pub additions: i64,
    pub deletions: i64,
    pub changed_files: i64,
    pub repository: Repository,
    pub author: Option<Actor>,
    pub merged_by: Option<Actor>,
    pub labels: Nodes<Name>,
    pub review_requests: Nodes<ReviewRequest>,
    pub latest_opinionated_reviews: Nodes<Review>,
    pub mine: Nodes<MyReview>,
    pub review_comments: Nodes<Comment>,
    pub comments: Nodes<Comment>,
    pub review_threads: Nodes<Thread>,
    pub commits: Nodes<CommitNode>,
    pub participants: Nodes<Login>,
    pub removed: Nodes<Removed>,
    pub ready: Nodes<Ready>,
    pub comment_count: Count,
    pub thread_count: Count,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub files: Option<Nodes<Path>>,
    /// Review and merged queues: everyone ever asked to review and when, and whether you're in the
    /// teams asked.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requested: Option<Nodes<ReviewRequest>>,
}

/// What the panel shows of a pull request: the rest only feeds the rules here.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PanelPr<'a> {
    id: &'a str,
    number: u64,
    title: &'a str,
    url: &'a str,
    is_draft: bool,
    state: &'a str,
    created_at: &'a str,
    updated_at: &'a str,
    merged_at: &'a Option<String>,
    head_ref_oid: &'a str,
    additions: i64,
    deletions: i64,
    changed_files: i64,
    repository: &'a Repository,
    author: &'a Option<Actor>,
    merged_by: &'a Option<Actor>,
    labels: &'a Nodes<Name>,
    review_requests: &'a Nodes<ReviewRequest>,
    latest_opinionated_reviews: &'a Nodes<Review>,
    /// Comments and review conversations.
    comments: u32,
}

const ACTOR: &str = "__typename login avatarUrl(size: 64) ... on User { name }";

fn fragment(files: bool, requests: bool) -> String {
    let comment = format!("author {{ {ACTOR} }} createdAt body url");
    let mut f = format!(
        "id number title url isDraft state createdAt updatedAt mergedAt headRefOid mergeable additions deletions changedFiles
        repository {{ nameWithOwner }}
        author {{ {ACTOR} }}
        mergedBy {{ {ACTOR} }}
        labels(first: 20) {{ nodes {{ name }} }}
        reviewRequests(first: 20) {{ nodes {{ requestedReviewer {{ __typename ... on User {{ login avatarUrl(size: 64) }} ... on Team {{ slug organization {{ login }} }} }} }} }}
        latestOpinionatedReviews(first: 20) {{ nodes {{ author {{ {ACTOR} }} state submittedAt url body }} }}
        mine: reviews(last: 20, author: $login) {{ nodes {{ state submittedAt commit {{ oid }} }} }}
        reviewComments: reviews(last: 10, states: [COMMENTED]) {{ nodes {{ author {{ {ACTOR} }} createdAt: submittedAt body url }} }}
        comments(last: 20) {{ nodes {{ {comment} }} }}
        reviewThreads(last: 20) {{ nodes {{ comments(last: 5) {{ nodes {{ {comment} }} }} }} }}
        commits(last: 1) {{ nodes {{ commit {{ committedDate statusCheckRollup {{ state }} }} }} }}
        participants(first: 50) {{ nodes {{ login }} }}
        commentCount: comments {{ totalCount }}
        threadCount: reviewThreads {{ totalCount }}
        removed: timelineItems(first: 20, itemTypes: [REVIEW_REQUEST_REMOVED_EVENT]) {{ nodes {{ ... on ReviewRequestRemovedEvent {{ actor {{ login }} }} }} }}
        ready: timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) {{ nodes {{ ... on ReadyForReviewEvent {{ createdAt }} }} }}"
    );
    if files {
        f.push_str(" files(first: 100) { nodes { path } }");
    }
    if requests {
        f.push_str(" requested: timelineItems(last: 30, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } members(query: $login, first: 10) { nodes { login } } } } } } }");
    }
    f
}

/// What the light search reads: enough to tell whether a pull request changed. GitHub bumps
/// `updatedAt` for pushes, comments, reviews, requests and labels, but not for CI or
/// mergeability; those cost GitHub seconds to work out for a whole search, so they're only asked
/// where they make events (your own pull requests). Elsewhere the periodic full fetch catches up.
const LIGHT: &str = "id updatedAt";
const LIGHT_WITH_CHECKS: &str = "id updatedAt headRefOid mergeable commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Light {
    id: String,
    updated_at: String,
    head_ref_oid: String,
    mergeable: String,
    commits: Nodes<CommitNode>,
}

impl Light {
    /// Changes whenever anything this app shows changes (see LIGHT).
    fn fingerprint(&self) -> String {
        let ci = self.commits.nodes.first().and_then(|c| c.commit.status_check_rollup.as_ref()).map(|s| s.state.as_str()).unwrap_or("");
        format!("{}|{}|{}|{}", self.updated_at, self.head_ref_oid, self.mergeable, ci)
    }
}

// MARK: Dates

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * ((m + 9) % 12) + 2) / 5 + d - 1;
    era * 146_097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// Milliseconds since the epoch of one of GitHub's timestamps ("2026-01-01T12:00:00Z"); 0 if none.
pub fn time(iso: Option<&str>) -> i64 {
    let Some(s) = iso else { return 0 };
    let n = |a: usize, b: usize| s.get(a..b).and_then(|p| p.parse::<i64>().ok());
    match (n(0, 4), n(5, 7), n(8, 10), n(11, 13), n(14, 16), n(17, 19)) {
        (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(se)) => (days_from_civil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se) * 1000,
        _ => 0,
    }
}

// MARK: Searches

fn quote(s: &str) -> String {
    if s.chars().any(|c| c.is_whitespace() || c == '"') { format!("\"{}\"", s.replace('"', "")) } else { s.to_string() }
}

/// The GitHub search for a queue. What search can't express (paths, teams…) is filtered after.
/// `orgs`: the person's organizations, where a merged queue with no repositories looks (merged
/// pull requests anywhere on GitHub would be millions).
pub fn search_for(queue: &Queue, me: &str, now: i64, orgs: &[String]) -> String {
    let mut parts: Vec<String> = vec!["is:pr".into(), "archived:false".into()];
    match queue.kind {
        Kind::Review => parts.extend(["is:open".into(), format!("review-requested:{me}")]),
        Kind::Involved => parts.extend(["is:open".into(), format!("involves:{me}"), format!("-author:{me}")]),
        Kind::Authored => parts.extend(["is:open".into(), format!("author:{me}")]),
        Kind::Merged => {
            let (y, m, d) = civil_from_days((now - i64::from(queue.merged_days) * 86_400_000).div_euclid(86_400_000));
            parts.extend(["is:merged".into(), format!("merged:>={y:04}-{m:02}-{d:02}"), format!("-author:{me}")]);
            if queue.skip_if_i != SkipIfI::Approved {
                parts.push(format!("-reviewed-by:{me}"));
            }
        }
        Kind::Custom => {
            // The person's own qualifiers, minus anything that would leave pull requests.
            static ISSUE: OnceLock<Regex> = OnceLock::new();
            let query = ISSUE.get_or_init(|| Regex::new(r"\bis:issue\b").unwrap()).replace_all(&queue.query, "");
            let query = query.trim();
            parts.push(if query.is_empty() { "is:open".into() } else { query.to_string() });
        }
    }
    // Several repo:/user: qualifiers are ORed by GitHub.
    for repo in &queue.repos {
        parts.push(match repo.strip_suffix("/*") {
            Some(owner) => format!("user:{owner}"),
            None => format!("repo:{repo}"),
        });
    }
    if queue.kind == Kind::Merged && queue.repos.is_empty() {
        parts.push(format!("user:{me}"));
        parts.extend(orgs.iter().map(|o| format!("org:{o}")));
    }
    if queue.drafts == Drafts::Hide && queue.kind != Kind::Merged {
        parts.push("draft:false".into());
    }
    if queue.drafts == Drafts::Only {
        parts.push("draft:true".into());
    }
    parts.extend(queue.include_labels.iter().map(|l| format!("label:{}", quote(l))));
    parts.extend(queue.exclude_labels.iter().map(|l| format!("-label:{}", quote(l))));
    parts.extend(queue.exclude_authors.iter().map(|a| format!("-author:{a}")));
    parts.push("sort:updated-desc".into());
    parts.join(" ")
}

// MARK: Fetching

#[derive(Debug, Clone, PartialEq)]
pub struct Failure {
    pub status: u16,
    pub message: String,
}

impl Failure {
    /// GitHub asking to slow down (its secondary rate limits, or the hourly one run out).
    pub fn rate_limited(&self) -> bool {
        let m = self.message.to_lowercase();
        self.status == 429 || m.contains("rate limit")
    }

    /// GitHub refuses queries that would cost it too much: a smaller one may still go through.
    fn too_big(&self) -> bool {
        let m = self.message.to_lowercase();
        m.contains("resource limits") || m.contains("timeout") || m.contains("timed out")
    }
}

/// Runs a GraphQL query and returns its `data`. Partial data (some nulls, with errors) comes back
/// as is; no data at all is a `Failure`.
pub trait Gql: Sync {
    fn query(&self, query: &str, variables: Value) -> Result<Value, Failure>;
}

/// Light searches are cheap: whole queues, a hundred at a time, up to a few hundred.
const PAGE: usize = 100;
const OPEN_PAGES: usize = 3;
const MERGED_PAGES: usize = 2;
/// Full pull requests per request, and requests at once.
const BATCH: usize = 10;
/// GitHub's secondary rate limits are about bursts: full pull requests are costly to it.
const PARALLEL: usize = 3;

/// One page of a light search: (pull requests, next page's cursor).
fn search_page(gql: &dyn Gql, q: &str, checks: bool, size: usize, after: Option<&str>) -> Result<(Vec<Light>, Option<String>), Failure> {
    let query = format!(
        "query($q: String!, $size: Int!, $after: String) {{ search(type: ISSUE, query: $q, first: $size, after: $after) {{ pageInfo {{ hasNextPage endCursor }} nodes {{ ... on PullRequest {{ {} }} }} }} }}",
        if checks { LIGHT_WITH_CHECKS } else { LIGHT }
    );
    let smaller = (size / 2).max(5);
    let data = match gql.query(&query, json!({ "q": q, "size": size, "after": after })) {
        Ok(data) => data,
        Err(e) if size > 5 && e.too_big() => return search_page(gql, q, checks, smaller, after),
        Err(e) => return Err(e),
    };
    let search = &data["search"];
    let nodes = search["nodes"].as_array();
    if (search.is_null() || nodes.is_some_and(|n| n.iter().any(Value::is_null))) && size > 5 {
        return search_page(gql, q, checks, smaller, after);
    }
    let Some(nodes) = nodes else {
        return Err(Failure { status: 200, message: "GitHub couldn't run the search".into() });
    };
    let prs = nodes.iter().filter_map(|n| serde_json::from_value::<Light>(n.clone()).ok()).filter(|l| !l.id.is_empty()).collect();
    let next = (search["pageInfo"]["hasNextPage"].as_bool() == Some(true)).then(|| search["pageInfo"]["endCursor"].as_str().map(String::from)).flatten();
    Ok((prs, next))
}

fn search(gql: &dyn Gql, queue: &Queue, me: &str, now: i64, orgs: &[String]) -> Result<Vec<Light>, Failure> {
    let q = search_for(queue, me, now, orgs);
    let pages = if queue.kind == Kind::Merged { MERGED_PAGES } else { OPEN_PAGES };
    let mut found = Vec::new();
    let mut after: Option<String> = None;
    for _ in 0..pages {
        let (prs, next) = search_page(gql, &q, queue.kind == Kind::Authored, PAGE, after.as_deref())?;
        found.extend(prs);
        match next {
            Some(cursor) => after = Some(cursor),
            None => break,
        }
    }
    Ok(found)
}

/// Pull requests in full, by id. A batch GitHub finds too costly is split; one it can't read at
/// all (deleted, or no longer visible to the token) is left out.
fn details(gql: &dyn Gql, ids: &[String], me: &str, files: bool, requests: bool) -> Result<Vec<PullRequest>, Failure> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let query = format!("query($login: String!, $ids: [ID!]!) {{ nodes(ids: $ids) {{ ... on PullRequest {{ {} }} }} }}", fragment(files, requests));
    let split = |gql: &dyn Gql| -> Result<Vec<PullRequest>, Failure> {
        let (a, b) = ids.split_at(ids.len() / 2);
        let mut prs = details(gql, a, me, files, requests)?;
        prs.extend(details(gql, b, me, files, requests)?);
        Ok(prs)
    };
    match gql.query(&query, json!({ "login": me, "ids": ids })) {
        Ok(data) => {
            let nodes = data["nodes"].as_array().cloned().unwrap_or_default();
            // Nulls come with GitHub's resource limits too: smaller batches may get through.
            if ids.len() > 1 && nodes.iter().any(Value::is_null) {
                return split(gql);
            }
            Ok(nodes.into_iter().filter_map(|n| serde_json::from_value::<PullRequest>(n).ok()).filter(|pr| !pr.id.is_empty()).collect())
        }
        Err(e) if ids.len() > 1 && e.too_big() => split(gql),
        Err(e) => Err(e),
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Cached {
    pub fingerprint: String,
    pub files: bool,
    pub requests: bool,
    pub pr: Arc<PullRequest>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct List {
    pub search: String,
    pub ids: Vec<String>,
    /// When it was searched (ms): merged queues are searched less often.
    pub at: i64,
}

/// What GitHub said last time: each queue's search and the pull requests in full. Saved between
/// launches (cache.json), for the signed-in login only.
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Cache {
    /// What's cached changes shape with the app: an older cache starts over.
    #[serde(default)]
    pub version: u32,
    pub me: String,
    pub lists: HashMap<String, List>,
    pub prs: HashMap<String, Cached>,
    /// When every pull request was last fetched in full (ms).
    #[serde(default)]
    pub full_at: i64,
    /// The person's organizations, for merged queues with no repositories, and when they were read.
    #[serde(default)]
    pub orgs: Vec<String>,
    #[serde(default)]
    pub orgs_at: i64,
}

const ORGS_EVERY: i64 = 24 * 3600 * 1000;

/// The organizations the person belongs to (needs the read:org scope; none without it).
fn organizations(gql: &dyn Gql) -> Result<Vec<String>, Failure> {
    let data = gql.query("query { viewer { organizations(first: 100) { nodes { login } } } }", json!({}))?;
    Ok(data["viewer"]["organizations"]["nodes"].as_array().map(|n| n.iter().filter_map(|o| o["login"].as_str().map(String::from)).collect()).unwrap_or_default())
}

pub const MERGED_EVERY: i64 = 5 * 60_000;
pub const CACHE_VERSION: u32 = 3;

/// Brings the cache up to date with GitHub. `force` searches merged queues again too; `full`
/// fetches every pull request in full, changed or not (a periodic safety net for what GitHub
/// doesn't count as an update, like team membership). Returns how many were fetched in full.
pub fn sync(gql: &dyn Gql, queues: &[&Queue], me: &str, cache: &mut Cache, force: bool, full: bool, now: i64) -> Result<usize, Failure> {
    if cache.me != me || cache.version != CACHE_VERSION {
        *cache = Cache { version: CACHE_VERSION, me: me.to_string(), ..Cache::default() };
    }
    if queues.iter().any(|q| q.kind == Kind::Merged && q.repos.is_empty()) && now - cache.orgs_at > ORGS_EVERY {
        // Kept as they were if GitHub can't say now.
        if let Ok(orgs) = organizations(gql) {
            cache.orgs = orgs;
            cache.orgs_at = now;
        }
    }
    let orgs = cache.orgs.clone();
    // 1. The light searches, all at once.
    let due: Vec<&Queue> = queues
        .iter()
        .copied()
        .filter(|q| {
            if q.kind != Kind::Merged || force {
                return true;
            }
            let list = cache.lists.get(&q.id);
            list.is_none_or(|l| l.search != search_for(q, me, now, &orgs) || now - l.at > MERGED_EVERY)
        })
        .collect();
    let results: Vec<Result<Vec<Light>, Failure>> = std::thread::scope(|s| {
        let orgs = &orgs;
        let handles: Vec<_> = due.iter().map(|q| s.spawn(move || search(gql, q, me, now, orgs))).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_else(|_| Err(Failure { status: 0, message: tr!("Searching failed", "A busca falhou") }))).collect()
    });
    let mut fresh: HashMap<String, String> = HashMap::new();
    for (queue, result) in due.iter().zip(results) {
        let found = result?;
        for light in &found {
            // In several queues, the fuller fingerprint wins, so it doesn't flip between the two.
            let fingerprint = light.fingerprint();
            if fresh.get(&light.id).is_none_or(|f| f.len() < fingerprint.len()) {
                fresh.insert(light.id.clone(), fingerprint);
            }
        }
        cache.lists.insert(queue.id.clone(), List { search: search_for(queue, me, now, &orgs), ids: found.into_iter().map(|l| l.id).collect(), at: now });
    }
    let wanted: HashSet<&str> = queues.iter().map(|q| q.id.as_str()).collect();
    cache.lists.retain(|id, _| wanted.contains(id.as_str()));

    // 2. What each pull request needs: files for path filters (and merged queues, to show them),
    //    review requests for merged queues that ask.
    let mut needs: HashMap<String, (bool, bool)> = HashMap::new();
    // The full pass is for open pull requests: merged ones don't change in ways the rules read.
    let mut open: HashSet<&str> = HashSet::new();
    for queue in queues.iter().filter(|q| q.kind != Kind::Merged) {
        open.extend(cache.lists.get(&queue.id).map(|l| l.ids.iter().map(String::as_str).collect::<Vec<_>>()).unwrap_or_default());
    }
    for queue in queues {
        let files = queue.needs_files() || queue.kind == Kind::Merged;
        let requests = queue.kind == Kind::Review || (queue.kind == Kind::Merged && queue.requested_only);
        for id in cache.lists.get(&queue.id).map(|l| l.ids.as_slice()).unwrap_or_default() {
            let need = needs.entry(id.clone()).or_default();
            need.0 |= files;
            need.1 |= requests;
        }
    }

    // 3. Fetch in full what changed, or isn't known well enough.
    let mut stale: HashMap<(bool, bool), Vec<String>> = HashMap::new();
    for (id, &(files, requests)) in &needs {
        let changed = match cache.prs.get(id) {
            None => true,
            Some(c) => (full && open.contains(id.as_str()) && fresh.contains_key(id)) || fresh.get(id).is_some_and(|f| *f != c.fingerprint) || (files && !c.files) || (requests && !c.requests),
        };
        if changed {
            stale.entry((files, requests)).or_default().push(id.clone());
        }
    }
    let fetched = stale.values().map(Vec::len).sum();
    let jobs: Vec<((bool, bool), Vec<String>)> = stale.into_iter().flat_map(|(need, ids)| ids.chunks(BATCH).map(|c| (need, c.to_vec())).collect::<Vec<_>>()).collect();
    for wave in jobs.chunks(PARALLEL) {
        let results: Vec<(bool, bool, Result<Vec<PullRequest>, Failure>)> = std::thread::scope(|s| {
            let handles: Vec<_> = wave.iter().map(|((files, requests), ids)| (*files, *requests, s.spawn(move || details(gql, ids, me, *files, *requests)))).collect();
            handles
                .into_iter()
                .map(|(f, r, h)| (f, r, h.join().unwrap_or_else(|_| Err(Failure { status: 0, message: tr!("Fetching failed", "Não foi possível buscar os pull requests") }))))
                .collect()
        });
        for (files, requests, result) in results {
            for pr in result? {
                let fingerprint = fresh.get(&pr.id).cloned().or_else(|| cache.prs.get(&pr.id).map(|c| c.fingerprint.clone())).unwrap_or_default();
                cache.prs.insert(pr.id.clone(), Cached { fingerprint, files, requests, pr: Arc::new(pr) });
            }
        }
    }

    // 4. Forget what no queue has any more.
    cache.prs.retain(|id, _| needs.contains_key(id));
    Ok(fetched)
}

// MARK: Reading a pull request

pub const NEW: &str = "new";

#[derive(Clone, Debug, Serialize)]
pub struct Event {
    pub key: String,
    pub kind: &'static str,
    pub at: i64,
    pub who: Option<Actor>,
    /// The start of what a comment or review said, for its notification.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Item {
    pub queue_id: String,
    pub pr: Arc<PullRequest>,
    pub events: Vec<Event>,
    /// How you left it (involved queues).
    pub status: Option<&'static str>,
    /// Review queues: requested through these teams rather than you.
    pub via_teams: Option<Vec<String>>,
    pub ci: Option<String>,
    /// CI went green again on the same commit since last time: worth a notification only.
    pub passed: bool,
    /// Review queues: since when it's been waiting on you (ms), from the last time you (or your
    /// team) were asked.
    pub waiting_since: Option<i64>,
}

impl Serialize for Item {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Out<'a> {
            queue_id: &'a str,
            pr: PanelPr<'a>,
            events: &'a [Event],
            #[serde(skip_serializing_if = "Option::is_none")]
            status: Option<&'static str>,
            #[serde(skip_serializing_if = "Option::is_none")]
            via_teams: &'a Option<Vec<String>>,
            ci: &'a Option<String>,
            #[serde(skip_serializing_if = "std::ops::Not::not")]
            passed: bool,
            #[serde(skip_serializing_if = "Option::is_none")]
            waiting_since: Option<i64>,
        }
        let pr = &self.pr;
        Out {
            queue_id: &self.queue_id,
            pr: PanelPr {
                id: &pr.id,
                number: pr.number,
                title: &pr.title,
                url: &pr.url,
                is_draft: pr.is_draft,
                state: &pr.state,
                created_at: &pr.created_at,
                updated_at: &pr.updated_at,
                merged_at: &pr.merged_at,
                head_ref_oid: &pr.head_ref_oid,
                additions: pr.additions,
                deletions: pr.deletions,
                changed_files: pr.changed_files,
                repository: &pr.repository,
                author: &pr.author,
                merged_by: &pr.merged_by,
                labels: &pr.labels,
                review_requests: &pr.review_requests,
                latest_opinionated_reviews: &pr.latest_opinionated_reviews,
                comments: pr.comment_count.total_count + pr.thread_count.total_count,
            },
            events: &self.events,
            status: self.status,
            via_teams: &self.via_teams,
            ci: &self.ci,
            passed: self.passed,
            waiting_since: self.waiting_since,
        }
        .serialize(serializer)
    }
}

/// Each pull request's CI state last time, to tell when it passes again.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct CiMemo {
    pub oid: String,
    pub state: Option<String>,
}

pub fn is_bot(actor: Option<&Actor>) -> bool {
    actor.is_none_or(|a| a.typename.as_deref() == Some("Bot") || a.login.ends_with("[bot]"))
}

fn login(actor: Option<&Actor>) -> &str {
    actor.map(|a| a.login.as_str()).unwrap_or("")
}

pub fn ci_state(pr: &PullRequest) -> Option<String> {
    pr.commits.nodes.first().and_then(|c| c.commit.status_check_rollup.as_ref()).map(|s| s.state.clone())
}

/// "@login" in a text, as a whole word, ignoring case.
fn mentions(body: &str, me: &str) -> bool {
    if me.is_empty() {
        return false;
    }
    let needle = format!("@{}", me.to_ascii_lowercase());
    let hay = body.to_ascii_lowercase();
    hay.match_indices(&needle).any(|(i, _)| !hay[i + needle.len()..].chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_'))
}

struct Activity<'a> {
    any: bool,
    last: i64,
    /// The last review that took a side; replying in a thread also makes a (commented) review.
    opinion: Option<&'a MyReview>,
    last_review: Option<&'a MyReview>,
}

fn threads(pr: &PullRequest) -> impl Iterator<Item = &Vec<Comment>> {
    pr.review_threads.nodes.iter().map(|t| &t.comments.nodes)
}

fn notes(pr: &PullRequest) -> Vec<&Comment> {
    pr.comments.nodes.iter().chain(pr.review_comments.nodes.iter().filter(|r| r.body.as_deref().is_some_and(|b| !b.trim().is_empty()))).collect()
}

fn activity<'a>(pr: &'a PullRequest, me: &str) -> Activity<'a> {
    let reviews: Vec<&MyReview> = pr.mine.nodes.iter().filter(|r| r.state != "PENDING").collect();
    let comments: Vec<&Comment> = pr.comments.nodes.iter().chain(threads(pr).flatten()).filter(|c| login(c.author.as_ref()) == me).collect();
    let last = reviews.iter().map(|r| time(r.submitted_at.as_deref())).chain(comments.iter().map(|c| time(c.created_at.as_deref()))).fold(0, i64::max);
    Activity {
        any: !reviews.is_empty() || !comments.is_empty(),
        last,
        opinion: reviews.iter().rev().copied().find(|r| r.state == "APPROVED" || r.state == "CHANGES_REQUESTED"),
        last_review: reviews.last().copied(),
    }
}

/// Who's asked to review: you directly, and the teams ("org/slug").
fn requests(pr: &PullRequest, me: &str) -> (bool, Vec<String>) {
    let mut direct = false;
    let mut teams = Vec::new();
    for r in pr.review_requests.nodes.iter().filter_map(|n| n.requested_reviewer.as_ref()) {
        match (r.typename.as_str(), &r.login, &r.slug, &r.organization) {
            ("User", Some(login), _, _) if login == me => direct = true,
            ("Team", _, Some(slug), Some(org)) => teams.push(format!("{}/{slug}", org.login)),
            _ => {}
        }
    }
    (direct, teams)
}

/// Whether your review was ever asked on it: you, or (unless only direct asks count) a team of
/// yours, or one of the queue's teams.
fn was_asked(pr: &PullRequest, me: &str, queue: &Queue) -> bool {
    pr.requested.as_ref().is_some_and(|r| {
        r.nodes.iter().filter_map(|n| n.requested_reviewer.as_ref()).any(|r| {
            if let Some(login) = &r.login {
                return login == me;
            }
            let (Some(slug), Some(org)) = (&r.slug, &r.organization) else { return false };
            if queue.direct_only {
                return false;
            }
            if queue.teams.is_empty() {
                r.members.as_ref().is_some_and(|m| m.nodes.iter().any(|m| m.login == me))
            } else {
                queue.teams.contains(&format!("{}/{slug}", org.login))
            }
        })
    })
}

/// When you were last asked to review: directly, or through one of these teams ("org/slug").
fn asked_at(pr: &PullRequest, me: &str, teams: &[String]) -> Option<i64> {
    pr.requested.as_ref()?.nodes.iter().filter_map(|n| {
        let r = n.requested_reviewer.as_ref()?;
        let yours = match (&r.login, &r.slug, &r.organization) {
            (Some(login), _, _) => login == me,
            (_, Some(slug), Some(org)) => teams.contains(&format!("{}/{slug}", org.login)),
            _ => false,
        };
        yours.then(|| time(n.created_at.as_deref()))
    }).max()
}

fn event(pr: &PullRequest, kind: &'static str, id: &str, at: i64, who: Option<&Actor>) -> Event {
    Event { key: format!("{}:{kind}:{id}", pr.id), kind, at, who: who.cloned(), text: None }
}

/// The same, quoting what a comment or review said.
fn said(pr: &PullRequest, kind: &'static str, id: &str, at: i64, who: Option<&Actor>, body: Option<&str>) -> Event {
    Event { text: snippet(body.unwrap_or("")), ..event(pr, kind, id, at, who) }
}

/// Characters of a comment a notification quotes.
const SNIPPET: usize = 140;

/// The start of a comment as plain words, for a notification: quotes of earlier comments, code
/// blocks, hidden HTML comments and pictures say less than the words around them, so they go;
/// links keep their text; runs of whitespace become one space. None when nothing's left.
pub fn snippet(body: &str) -> Option<String> {
    static PATTERNS: OnceLock<[(Regex, &str); 7]> = OnceLock::new();
    let patterns = PATTERNS.get_or_init(|| {
        [
            (Regex::new(r"(?s)```.*?(```|$)").unwrap(), " "),
            (Regex::new(r"(?s)<!--.*?(-->|$)").unwrap(), " "),
            (Regex::new(r"(?m)^\s*>.*$").unwrap(), " "),
            (Regex::new(r"!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>").unwrap(), " "),
            (Regex::new(r"\[([^\]]*)\]\([^)]*\)").unwrap(), "$1"),
            (Regex::new(r"(?m)</?[a-zA-Z][^>]*>|\*\*|~~|`|^#+\s+").unwrap(), ""),
            (Regex::new(r"\s+").unwrap(), " "),
        ]
    });
    let mut text = body.to_string();
    for (pattern, with) in patterns {
        text = pattern.replace_all(&text, *with).into_owned();
    }
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    if text.chars().count() <= SNIPPET {
        return Some(text.to_string());
    }
    let cut: String = text.chars().take(SNIPPET - 1).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// When the pull request was last marked ready for review, if it ever was a draft.
fn ready_at(pr: &PullRequest) -> Option<i64> {
    pr.ready.nodes.last().map(|r| time(r.created_at.as_deref())).filter(|t| *t > 0)
}

/// A queue's path filters, compiled. A pattern this side can't use (JavaScript-only syntax) is an
/// error for the queue rather than a filter silently ignored.
fn path_filters(queue: &Queue) -> Result<(Option<Regex>, Option<Regex>), String> {
    let compile = |p: &str| -> Result<Option<Regex>, String> {
        if p.is_empty() {
            return Ok(None);
        }
        {
            let name = &queue.name;
            Regex::new(p).map(Some).map_err(|_| tr!("{name}: the file pattern \"{p}\" isn't supported", "{name}: o padrão de arquivos \"{p}\" não é suportado"))
        }
    };
    Ok((compile(&queue.include_paths)?, compile(&queue.exclude_paths)?))
}

/// The items of one queue, from what its search found.
pub fn items_for(queue: &Queue, prs: &[Arc<PullRequest>], me: &str, previous_ci: &HashMap<String, CiMemo>) -> Result<Vec<Item>, String> {
    let (include, exclude) = path_filters(queue)?;
    let by_others = |c: &Comment| !is_bot(c.author.as_ref()) && login(c.author.as_ref()) != me && c.created_at.as_deref().is_some_and(|t| !t.is_empty());
    let mut items = Vec::new();

    for pr in prs {
        let author = pr.author.as_ref();
        if queue.hide_bots && is_bot(author) {
            continue;
        }
        if queue.exclude_authors.iter().any(|a| a == login(author)) {
            continue;
        }
        if !queue.skip_approved_by.is_empty() && pr.latest_opinionated_reviews.nodes.iter().any(|r| r.state == "APPROVED" && queue.skip_approved_by.iter().any(|a| a == login(r.author.as_ref()))) {
            continue;
        }
        if queue.needs_files() {
            let files = pr.files.as_ref().map(|f| f.nodes.as_slice()).unwrap_or_default();
            if !files.iter().any(|f| include.as_ref().is_none_or(|r| r.is_match(&f.path)) && !exclude.as_ref().is_some_and(|r| r.is_match(&f.path))) {
                continue;
            }
        }
        let act = activity(pr, me);
        let (direct, teams) = requests(pr, me);
        let ci = ci_state(pr);
        let pushed = time(pr.commits.nodes.first().and_then(|c| c.commit.committed_date.as_deref()));
        // Entering the queue is an event of its own, per queue.
        let arrived = Event { key: format!("{}:{}:new", queue.id, pr.id), kind: NEW, at: time(Some(&pr.created_at)), who: pr.author.clone(), text: None };
        let item = |events: Vec<Event>| Item { queue_id: queue.id.clone(), pr: pr.clone(), events, status: None, via_teams: None, ci: ci.clone(), passed: false, waiting_since: None };

        match queue.kind {
            Kind::Review => {
                let via: Vec<String> = teams.into_iter().filter(|t| queue.teams.is_empty() || queue.teams.contains(t)).collect();
                if !(direct || (!queue.direct_only && !via.is_empty())) {
                    continue;
                }
                let asked = asked_at(pr, me, if direct { &[] } else { &via });
                // Asked again after your last word on it: back for another look, reviewed or not.
                let again = act.any && asked.is_some_and(|a| a > act.last);
                if queue.hide_once_reviewed && act.any && !again {
                    continue;
                }
                let waiting = asked.unwrap_or_else(|| time(Some(&pr.created_at)));
                let mut events = vec![arrived];
                if again {
                    // Keyed like an updates queue's, so it's one notification in both.
                    events.push(event(pr, "rerequest", &act.last.to_string(), waiting, author));
                }
                // Made ready after you were asked: it waited on that, not on you.
                if let Some(at) = ready_at(pr).filter(|at| *at > waiting && !pr.is_draft) {
                    events.push(event(pr, "ready", &at.to_string(), at, author));
                }
                // What others said while it's been waiting on you.
                let since = waiting.max(act.last);
                for c in notes(pr).into_iter().chain(threads(pr).flatten()) {
                    if by_others(c) && time(c.created_at.as_deref()) > since {
                        let kind = if mentions(c.body.as_deref().unwrap_or(""), me) { "mention" } else { "comment" };
                        events.push(said(pr, kind, &c.url, time(c.created_at.as_deref()), c.author.as_ref(), c.body.as_deref()));
                    }
                }
                items.push(Item { via_teams: Some(if direct { vec![] } else { via }), waiting_since: Some(waiting), ..item(events) });
            }
            Kind::Merged => {
                if queue.skip_if_i == SkipIfI::TookPart && pr.participants.nodes.iter().any(|p| p.login == me) {
                    continue;
                }
                if pr.mine.nodes.iter().any(|r| r.state == "APPROVED" || (queue.skip_if_i != SkipIfI::Approved && r.state != "PENDING")) {
                    continue;
                }
                if pr.merged_by.as_ref().is_some_and(|m| queue.skip_merged_by.contains(&m.login)) {
                    continue;
                }
                if queue.requested_only && !was_asked(pr, me, queue) {
                    continue;
                }
                // Passed on: you took yourself (or your team) off its review, here or on GitHub.
                if pr.removed.nodes.iter().any(|e| e.actor.as_ref().is_some_and(|a| a.login == me)) {
                    continue;
                }
                items.push(item(vec![Event { at: time(pr.merged_at.as_deref()), ..arrived }]));
            }
            Kind::Authored => {
                let mut events = vec![arrived];
                for r in &pr.latest_opinionated_reviews.nodes {
                    if is_bot(r.author.as_ref()) || login(r.author.as_ref()) == me {
                        continue;
                    }
                    let kind = match r.state.as_str() {
                        "APPROVED" => "approved",
                        "CHANGES_REQUESTED" => "changes",
                        _ => continue,
                    };
                    let id = format!("{}:{}", login(r.author.as_ref()), r.submitted_at.as_deref().unwrap_or(""));
                    events.push(said(pr, kind, &id, time(r.submitted_at.as_deref()), r.author.as_ref(), r.body.as_deref()));
                }
                for c in notes(pr).into_iter().chain(threads(pr).flatten()) {
                    if by_others(c) {
                        let kind = if mentions(c.body.as_deref().unwrap_or(""), me) { "mention" } else { "comment" };
                        events.push(said(pr, kind, &c.url, time(c.created_at.as_deref()), c.author.as_ref(), c.body.as_deref()));
                    }
                }
                if matches!(ci.as_deref(), Some("FAILURE" | "ERROR")) {
                    events.push(event(pr, "ci-failed", &pr.head_ref_oid, pushed, None));
                }
                if pr.mergeable == "CONFLICTING" {
                    events.push(event(pr, "conflict", &pr.head_ref_oid, pushed, None));
                }
                let before = previous_ci.get(&pr.id);
                let passed = ci.as_deref() == Some("SUCCESS") && before.is_some_and(|b| b.oid == pr.head_ref_oid && b.state.as_deref() != Some("SUCCESS"));
                items.push(Item { passed, ..item(events) });
            }
            Kind::Involved | Kind::Custom => {
                // What happened since your last word on it.
                let all_notes = notes(pr);
                let mention_list: Vec<&Comment> = all_notes.iter().copied().chain(threads(pr).flatten()).filter(|c| by_others(c) && mentions(c.body.as_deref().unwrap_or(""), me)).collect();
                if queue.kind == Kind::Involved && !act.any && mention_list.is_empty() {
                    continue;
                }
                let since = act.last;
                let after = |c: &Comment| by_others(c) && time(c.created_at.as_deref()) > since;
                let mentioned: HashSet<&str> = mention_list.iter().map(|c| c.url.as_str()).collect();
                let mut events = vec![arrived];
                for c in &mention_list {
                    if time(c.created_at.as_deref()) > since {
                        events.push(said(pr, "mention", &c.url, time(c.created_at.as_deref()), c.author.as_ref(), c.body.as_deref()));
                    }
                }
                if act.any || queue.kind == Kind::Custom {
                    for thread in threads(pr) {
                        let mine = thread.iter().any(|c| login(c.author.as_ref()) == me);
                        for c in thread {
                            if after(c) && !mentioned.contains(c.url.as_str()) {
                                events.push(said(pr, if mine { "reply" } else { "comment" }, &c.url, time(c.created_at.as_deref()), c.author.as_ref(), c.body.as_deref()));
                            }
                        }
                    }
                    for c in &all_notes {
                        if after(c) && !mentioned.contains(c.url.as_str()) {
                            events.push(said(pr, "comment", &c.url, time(c.created_at.as_deref()), c.author.as_ref(), c.body.as_deref()));
                        }
                    }
                    if let Some(at) = ready_at(pr).filter(|at| *at > since && !pr.is_draft) {
                        events.push(event(pr, "ready", &at.to_string(), at, author));
                    }
                    let base = act.opinion.or(act.last_review);
                    match base.and_then(|b| b.commit.as_ref()) {
                        Some(commit) if !commit.oid.is_empty() => {
                            if commit.oid != pr.head_ref_oid {
                                events.push(event(pr, "commits", &pr.head_ref_oid, pushed.max(since), author));
                            }
                        }
                        _ => {
                            if act.any && base.is_none() && pushed > since {
                                events.push(event(pr, "commits", &pr.head_ref_oid, pushed, author));
                            }
                        }
                    }
                    // Still asked after reviewing: asked again.
                    if act.last_review.is_some() && direct {
                        events.push(event(pr, "rerequest", &since.to_string(), since, author));
                    }
                }
                if queue.kind == Kind::Involved && queue.only_news && events.len() == 1 {
                    continue;
                }
                let status = match act.opinion.map(|o| o.state.as_str()) {
                    Some("APPROVED") => "APPROVED",
                    Some("CHANGES_REQUESTED") => "CHANGES_REQUESTED",
                    _ if act.any => "COMMENTED",
                    _ => "MENTIONED",
                };
                items.push(Item { status: (queue.kind == Kind::Involved).then_some(status), ..item(events) });
            }
        }
    }
    Ok(items)
}

pub struct Fresh<'a> {
    pub item: &'a Item,
    pub event: Event,
}

/// "owner/name", or all of an owner's with "owner/*".
pub fn repo_matches(pattern: &str, repo: &str) -> bool {
    match pattern.strip_suffix("/*") {
        Some(owner) => repo.split_once('/').is_some_and(|(o, _)| o.eq_ignore_ascii_case(owner)),
        None => pattern.eq_ignore_ascii_case(repo),
    }
}

/// Whether your latest review that took a side approved it.
fn approved_by_me(pr: &PullRequest) -> bool {
    pr.mine.nodes.iter().rev().find(|r| r.state == "APPROVED" || r.state == "CHANGES_REQUESTED").is_some_and(|r| r.state == "APPROVED")
}

/// Whether a queue's notification settings leave this event out: a draft, a bot's doing, a pull
/// request you approved, or one from a repository its notifications aren't for.
fn left_out(queue: &Queue, item: &Item, event: &Event) -> bool {
    let repo = &item.pr.repository.name_with_owner;
    (queue.leaves_out("drafts") && item.pr.is_draft)
        || (queue.leaves_out("bots") && event.who.is_some() && is_bot(event.who.as_ref()))
        || (queue.leaves_out("approved") && approved_by_me(&item.pr))
        || (!queue.notify_repos.is_empty() && !queue.notify_repos.iter().any(|p| repo_matches(p, repo)))
}

/// What to notify: events not there last time and not seen, of the kinds the queue asked for and
/// not left out, each once even when a pull request is in several queues; plus CI passing again.
/// Arriving in a queue and the reason it arrived are one notification: being asked again wins,
/// and in a review queue a draft made ready does too (elsewhere arriving says more).
pub fn fresh_events<'a>(items: &'a [Item], queues: &[&Queue], previous: &HashSet<String>, seen: &HashMap<String, bool>, now: i64) -> Vec<Fresh<'a>> {
    let by_id: HashMap<&str, &Queue> = queues.iter().map(|q| (q.id.as_str(), *q)).collect();
    let wants = |queue: &Queue, kind: &str| queue.notify.iter().any(|n| n == kind);
    let mut out = Vec::new();
    let mut taken = HashSet::new();
    for item in items {
        let Some(queue) = by_id.get(item.queue_id.as_str()).copied() else { continue };
        let fresh: Vec<&Event> = item
            .events
            .iter()
            .filter(|e| !previous.contains(&e.key) && !seen.contains_key(&e.key) && wants(queue, e.kind) && !left_out(queue, item, e))
            .collect();
        let has = |kind: &str| fresh.iter().any(|e| e.kind == kind);
        let ready_wins = queue.kind == Kind::Review;
        for e in &fresh {
            let shadowed = match e.kind {
                NEW => has("rerequest") || (ready_wins && has("ready")),
                "ready" => has("rerequest") || (!ready_wins && has(NEW)),
                _ => false,
            };
            if shadowed || !taken.insert(e.key.clone()) {
                continue;
            }
            out.push(Fresh { item, event: (*e).clone() });
        }
        if item.passed && wants(queue, "ci-passed") {
            let key = format!("{}:ci-passed:{}", item.pr.id, item.pr.head_ref_oid);
            let event = Event { key, kind: "ci-passed", at: now, who: None, text: None };
            if !left_out(queue, item, &event) && taken.insert(event.key.clone()) {
                out.push(Fresh { item, event });
            }
        }
    }
    out.sort_by_key(|f| std::cmp::Reverse(f.event.at));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const ME: &str = "me";
    const T0: i64 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

    fn t(minutes_ago: i64) -> String {
        let ms = T0 - minutes_ago * 60_000;
        let (y, m, d) = civil_from_days(ms.div_euclid(86_400_000));
        let s = ms.rem_euclid(86_400_000) / 1000;
        format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", s / 3600, s / 60 % 60, s % 60)
    }

    fn user(login: &str) -> Value {
        json!({ "__typename": "User", "login": login, "name": null })
    }

    fn bot(login: &str) -> Value {
        json!({ "__typename": "Bot", "login": login })
    }

    static N: AtomicUsize = AtomicUsize::new(0);

    fn pr(overrides: Value) -> Arc<PullRequest> {
        let n = N.fetch_add(1, Ordering::SeqCst) + 1;
        let mut base = json!({
            "id": format!("PR_{n}"), "number": n, "title": format!("PR {n}"), "url": format!("https://github.com/acme/web/pull/{n}"),
            "isDraft": false, "state": "OPEN", "createdAt": t(600), "updatedAt": t(10), "mergedAt": null, "headRefOid": "head",
            "mergeable": "MERGEABLE", "additions": 1, "deletions": 1, "changedFiles": 1, "repository": { "nameWithOwner": "acme/web" },
            "author": user("ana"), "mergedBy": null,
            "commits": { "nodes": [{ "commit": { "committedDate": t(300), "statusCheckRollup": { "state": "SUCCESS" } } }] },
            "files": { "nodes": [{ "path": "src/app.tsx" }] },
        });
        for (k, v) in overrides.as_object().unwrap() {
            base[k] = v.clone();
        }
        Arc::new(serde_json::from_value(base).unwrap())
    }

    fn queue(kind: Kind, patch: Value) -> Queue {
        let mut q = json!({ "id": format!("q-{kind:?}"), "name": "Queue", "kind": format!("{kind:?}").to_lowercase(), "drafts": "show" });
        let defaults = match kind {
            Kind::Review => json!({ "notify": ["new", "rerequest"] }),
            Kind::Involved => json!({ "notify": ["commits", "reply", "mention", "rerequest"] }),
            Kind::Authored => json!({ "notify": ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"] }),
            Kind::Custom => json!({ "notify": ["new"], "query": "is:open" }),
            Kind::Merged => json!({}),
        };
        for source in [defaults, patch] {
            for (k, v) in source.as_object().unwrap() {
                q[k] = v.clone();
            }
        }
        serde_json::from_value(q).unwrap()
    }

    fn items(q: &Queue, prs: &[Arc<PullRequest>]) -> Vec<Item> {
        items_for(q, prs, ME, &HashMap::new()).unwrap()
    }

    fn kinds(items: &[Item]) -> Vec<&'static str> {
        let mut k: Vec<_> = items.iter().flat_map(|i| i.events.iter().map(|e| e.kind)).collect();
        k.sort();
        k
    }

    fn comment(login: &str, minutes_ago: i64, body: &str) -> Value {
        json!({ "author": user(login), "createdAt": t(minutes_ago), "body": body, "url": format!("https://x/{login}/{minutes_ago}") })
    }

    #[test]
    fn dates() {
        assert_eq!(time(Some("2026-01-01T00:00:00Z")), T0);
        assert_eq!(time(Some(&t(90))), T0 - 90 * 60_000);
        assert_eq!(time(None), 0);
        assert_eq!(time(Some("nope")), 0);
    }

    #[test]
    fn merged_queues_without_repositories_look_in_your_organizations() {
        let q = search_for(&queue(Kind::Merged, json!({})), ME, T0, &["acme".into(), "labs".into()]);
        assert!(q.contains("user:me org:acme org:labs"), "{q}");
        assert!(!search_for(&queue(Kind::Merged, json!({ "repos": ["acme/web"] })), ME, T0, &["acme".into()]).contains("org:"));
    }

    #[test]
    fn searches() {
        assert!(search_for(&queue(Kind::Review, json!({})), ME, T0, &[]).contains("review-requested:me"));
        assert!(search_for(&queue(Kind::Involved, json!({})), ME, T0, &[]).contains("involves:me -author:me"));
        assert!(search_for(&queue(Kind::Authored, json!({})), ME, T0, &[]).contains("author:me"));
        let merged = search_for(&queue(Kind::Merged, json!({ "mergedDays": 7 })), ME, T0 + 7 * 86_400_000, &[]);
        assert!(merged.contains("is:merged merged:>=2026-01-01 -author:me -reviewed-by:me"), "{merged}");
        assert!(!search_for(&queue(Kind::Merged, json!({ "skipIfI": "approved" })), ME, T0, &[]).contains("reviewed-by"));
        let q = search_for(
            &queue(Kind::Review, json!({ "repos": ["acme/web", "acme/*"], "drafts": "hide", "includeLabels": ["needs review"], "excludeLabels": ["wip"], "excludeAuthors": ["dependabot"] })),
            ME,
            T0,
            &[],
        );
        for part in ["repo:acme/web", "user:acme", "draft:false", "label:\"needs review\"", "-label:wip", "-author:dependabot"] {
            assert!(q.contains(part), "{q} has {part}");
        }
        assert!(search_for(&queue(Kind::Custom, json!({ "query": "is:issue label:bug" })), ME, T0, &[]).starts_with("is:pr archived:false label:bug"));
    }

    #[test]
    fn review_queues() {
        let direct = json!({ "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] });
        let team = |slug: &str| json!({ "nodes": [{ "requestedReviewer": { "__typename": "Team", "slug": slug, "organization": { "login": "acme" } } }] });
        let found = items(&queue(Kind::Review, json!({})), &[pr(json!({ "reviewRequests": direct })), pr(json!({ "reviewRequests": team("payments") })), pr(json!({}))]);
        assert_eq!(found.len(), 2);
        assert_eq!(found[1].via_teams, Some(vec!["acme/payments".to_string()]));

        let prs = [pr(json!({ "reviewRequests": team("payments") })), pr(json!({ "reviewRequests": team("frontend") }))];
        assert_eq!(items(&queue(Kind::Review, json!({ "teams": ["acme/payments"] })), &prs).len(), 1);
        assert_eq!(items(&queue(Kind::Review, json!({ "directOnly": true })), &prs).len(), 0);

        let reviewed = pr(json!({ "reviewRequests": direct, "mine": { "nodes": [{ "state": "COMMENTED", "submittedAt": t(5), "commit": { "oid": "head" } }] } }));
        assert_eq!(items(&queue(Kind::Review, json!({})), std::slice::from_ref(&reviewed)).len(), 0);
        assert_eq!(items(&queue(Kind::Review, json!({ "hideOnceReviewed": false })), &[reviewed]).len(), 1);

        let prs = [
            pr(json!({ "author": bot("renovate"), "reviewRequests": direct })),
            pr(json!({ "author": user("noisy"), "reviewRequests": direct })),
            pr(json!({ "reviewRequests": direct, "files": { "nodes": [{ "path": "docs/a.md" }] } })),
        ];
        assert_eq!(items(&queue(Kind::Review, json!({ "excludeAuthors": ["noisy"], "includePaths": "\\.tsx?$" })), &prs).len(), 0);
    }

    #[test]
    fn waiting_since_the_last_ask() {
        let asked = |who: Value, minutes_ago: i64| json!({ "requestedReviewer": who, "createdAt": t(minutes_ago) });
        let me = json!({ "__typename": "User", "login": ME });
        let found = items(
            &queue(Kind::Review, json!({})),
            &[pr(json!({
                "reviewRequests": { "nodes": [{ "requestedReviewer": me }] },
                "requested": { "nodes": [asked(me.clone(), 300), asked(json!({ "__typename": "User", "login": "ana" }), 10), asked(me.clone(), 60)] },
            }))],
        );
        assert_eq!(found[0].waiting_since, Some(T0 - 60 * 60_000));
    }

    #[test]
    fn involved_queues() {
        let reviewed = |minutes_ago: i64, oid: &str| json!({ "nodes": [{ "state": "APPROVED", "submittedAt": t(minutes_ago), "commit": { "oid": oid } }] });
        let found = items(
            &queue(Kind::Involved, json!({})),
            &[pr(json!({
                "mine": reviewed(60, "old"),
                "headRefOid": "new",
                "reviewThreads": { "nodes": [{ "comments": { "nodes": [comment(ME, 70, "ok"), comment("ana", 30, "ok")] } }] },
                "comments": { "nodes": [comment("bruno", 90, "ok"), comment("carla", 20, "@me thoughts?")] },
            }))],
        );
        assert_eq!(kinds(&found), ["commits", "mention", "new", "reply"]);
        assert_eq!(found[0].status, Some("APPROVED"));

        let asked = items(&queue(Kind::Involved, json!({})), &[pr(json!({ "mine": reviewed(60, "head"), "reviewRequests": { "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] } }))]);
        assert!(kinds(&asked).contains(&"rerequest"));

        assert_eq!(items(&queue(Kind::Involved, json!({})), &[pr(json!({}))]).len(), 0);
        assert_eq!(items(&queue(Kind::Involved, json!({ "onlyNews": true })), &[pr(json!({ "mine": reviewed(60, "head") }))]).len(), 0);
        assert_eq!(items(&queue(Kind::Involved, json!({})), &[pr(json!({ "mine": reviewed(60, "head") }))]).len(), 1);

        let bots = items(&queue(Kind::Involved, json!({})), &[pr(json!({ "mine": reviewed(60, "head"), "comments": { "nodes": [{ "author": bot("ci"), "createdAt": t(5), "body": "ok", "url": "u" }] } }))]);
        assert_eq!(kinds(&bots), ["new"]);
    }

    #[test]
    fn mentions_are_whole_words() {
        assert!(mentions("hey @Me, look", "me"));
        assert!(mentions("@me", "me"));
        assert!(!mentions("@meow", "me"));
        assert!(!mentions("me", "me"));
    }

    #[test]
    fn authored_queues() {
        let found = items(
            &queue(Kind::Authored, json!({})),
            &[pr(json!({
                "author": user(ME),
                "latestOpinionatedReviews": { "nodes": [
                    { "author": user("ana"), "state": "APPROVED", "submittedAt": t(5), "url": "u1" },
                    { "author": user("bruno"), "state": "CHANGES_REQUESTED", "submittedAt": t(4), "url": "u2" },
                ] },
                "comments": { "nodes": [comment("carla", 3, "ok")] },
                "commits": { "nodes": [{ "commit": { "committedDate": t(2), "statusCheckRollup": { "state": "FAILURE" } } }] },
                "mergeable": "CONFLICTING",
            }))],
        );
        assert_eq!(kinds(&found), ["approved", "changes", "ci-failed", "comment", "conflict", "new"]);

        let passing = pr(json!({ "author": user(ME) }));
        let memo = |oid: &str| HashMap::from([(passing.id.clone(), CiMemo { oid: oid.into(), state: Some("FAILURE".into()) })]);
        assert!(items_for(&queue(Kind::Authored, json!({})), std::slice::from_ref(&passing), ME, &memo("head")).unwrap()[0].passed);
        assert!(!items_for(&queue(Kind::Authored, json!({})), std::slice::from_ref(&passing), ME, &memo("other")).unwrap()[0].passed);
    }

    #[test]
    fn merged_queues() {
        let merged = |extra: Value| {
            let mut v = json!({ "state": "MERGED", "mergedAt": t(30), "mergedBy": user("rui") });
            for (k, x) in extra.as_object().unwrap() {
                v[k] = x.clone();
            }
            pr(v)
        };
        let q = queue(Kind::Merged, json!({}));
        let found = items(&q, &[merged(json!({})), merged(json!({ "participants": { "nodes": [{ "login": ME }] } })), merged(json!({ "removed": { "nodes": [{ "actor": { "login": ME } }] } }))]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].events[0].at, T0 - 30 * 60_000);

        let asked = |r: Value| merged(json!({ "requested": { "nodes": [{ "requestedReviewer": r }] } }));
        let frontend = json!({ "__typename": "Team", "slug": "frontend", "organization": { "login": "acme" }, "members": { "nodes": [{ "login": ME }] } });
        let data = json!({ "__typename": "Team", "slug": "data", "organization": { "login": "acme" }, "members": { "nodes": [] } });
        let prs = [asked(json!({ "__typename": "User", "login": ME })), asked(frontend), asked(data), merged(json!({}))];
        assert_eq!(items(&queue(Kind::Merged, json!({ "requestedOnly": true })), &prs).len(), 2);
        assert_eq!(items(&queue(Kind::Merged, json!({ "requestedOnly": true, "directOnly": true })), &prs).len(), 1);
        assert_eq!(items(&queue(Kind::Merged, json!({ "requestedOnly": true, "teams": ["acme/data"] })), &prs).len(), 2);

        let commented = merged(json!({ "mine": { "nodes": [{ "state": "COMMENTED", "submittedAt": t(40), "commit": null }] }, "participants": { "nodes": [{ "login": ME }] } }));
        let approved = merged(json!({ "mine": { "nodes": [{ "state": "APPROVED", "submittedAt": t(40), "commit": null }] } }));
        let talked = merged(json!({ "participants": { "nodes": [{ "login": ME }] } }));
        let three = [commented, approved, talked];
        assert_eq!(items(&queue(Kind::Merged, json!({ "skipIfI": "approved" })), &three).len(), 2);
        assert_eq!(items(&queue(Kind::Merged, json!({ "skipIfI": "reviewed" })), &three).len(), 1);
        assert_eq!(items(&queue(Kind::Merged, json!({ "skipIfI": "tookPart" })), &three).len(), 0);

        let by_jake = merged(json!({ "mergedBy": user("dana") }));
        let ok_by_eli = merged(json!({ "latestOpinionatedReviews": { "nodes": [{ "author": user("eli"), "state": "APPROVED", "submittedAt": t(40), "url": "u" }] } }));
        assert_eq!(items(&queue(Kind::Merged, json!({ "skipMergedBy": ["dana"], "skipApprovedBy": ["eli"] })), &[by_jake, ok_by_eli, merged(json!({}))]).len(), 1);
    }

    #[test]
    fn unusable_path_patterns_are_errors() {
        assert!(items_for(&queue(Kind::Review, json!({ "includePaths": "(?=x)" })), &[], ME, &HashMap::new()).is_err());
    }

    #[test]
    fn fresh_events_once_across_queues() {
        let a = pr(json!({ "reviewRequests": { "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] } }));
        let review = queue(Kind::Review, json!({}));
        let custom = queue(Kind::Custom, json!({}));
        let mut all = items(&review, std::slice::from_ref(&a));
        all.extend(items(&custom, &[a]));
        let queues = [&review, &custom];
        // One "new" per queue: entering each queue is its own event.
        assert_eq!(fresh_events(&all, &queues, &HashSet::new(), &HashMap::new(), T0).len(), 2);
        let keys: HashSet<String> = all.iter().flat_map(|i| i.events.iter().map(|e| e.key.clone())).collect();
        assert_eq!(fresh_events(&all, &queues, &keys, &HashMap::new(), T0).len(), 0);
        let seen: HashMap<String, bool> = keys.iter().map(|k| (k.clone(), true)).collect();
        assert_eq!(fresh_events(&all, &queues, &HashSet::new(), &seen, T0).len(), 0);
        let quiet = [queue(Kind::Review, json!({ "notify": [] })), queue(Kind::Custom, json!({ "notify": [] }))];
        assert_eq!(fresh_events(&all, &[&quiet[0], &quiet[1]], &HashSet::new(), &HashMap::new(), T0).len(), 0);
    }

    #[test]
    fn snippets_are_plain_and_short() {
        assert_eq!(snippet("> earlier words\n\nLooks **good**, see [the docs](https://x/y) `fn()`").as_deref(), Some("Looks good, see the docs fn()"));
        assert_eq!(snippet("Run this:\n```sh\nrm -rf /\n```\nthen ship").as_deref(), Some("Run this: then ship"));
        assert_eq!(snippet("<!-- template -->\n## Summary\n![shot](a.png) Done").as_deref(), Some("Summary Done"));
        assert_eq!(snippet("> only a quote\n```\ncode\n```").as_deref(), None);
        assert_eq!(snippet("snake_case_name stays"), Some("snake_case_name stays".into()));
        let long = snippet(&"word ".repeat(60)).unwrap();
        assert_eq!(long.chars().count(), SNIPPET);
        assert!(long.ends_with("word…"), "{long}");
        // Cut by characters, not bytes.
        assert_eq!(snippet(&"é".repeat(200)).unwrap().chars().count(), SNIPPET);
    }

    fn me_asked(minutes_ago: i64) -> Value {
        json!({ "requestedReviewer": { "__typename": "User", "login": ME }, "createdAt": t(minutes_ago) })
    }

    #[test]
    fn asked_again_after_reviewing() {
        let direct = json!({ "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] });
        let reviewed = json!({ "nodes": [{ "state": "COMMENTED", "submittedAt": t(60), "commit": { "oid": "head" } }] });
        // Asked, reviewed, asked again: back in the queue, asked again.
        let again = pr(json!({ "reviewRequests": direct, "mine": reviewed, "requested": { "nodes": [me_asked(120), me_asked(30)] } }));
        let found = items(&queue(Kind::Review, json!({})), std::slice::from_ref(&again));
        assert_eq!(kinds(&found), ["new", "rerequest"]);
        assert_eq!(found[0].waiting_since, Some(T0 - 30 * 60_000));
        // Reviewed since the last ask: done with it.
        let done = pr(json!({ "reviewRequests": direct, "mine": reviewed, "requested": { "nodes": [me_asked(120)] } }));
        assert!(items(&queue(Kind::Review, json!({})), &[done]).is_empty());
        // The same notification as an updates queue's, once.
        let involved = queue(Kind::Involved, json!({}));
        let review = queue(Kind::Review, json!({}));
        let mut all = items(&review, std::slice::from_ref(&again));
        all.extend(items(&involved, &[again]));
        let fresh = fresh_events(&all, &[&review, &involved], &HashSet::new(), &HashMap::new(), T0);
        assert_eq!(fresh.iter().map(|f| f.event.kind).collect::<Vec<_>>(), ["rerequest"], "asked again, not also new, and once");
    }

    #[test]
    fn asked_of_you_or_your_team() {
        let team = json!({ "__typename": "Team", "slug": "web", "organization": { "login": "acme" } });
        let found = items(
            &queue(Kind::Review, json!({})),
            &[pr(json!({ "reviewRequests": { "nodes": [{ "requestedReviewer": team }] } })), pr(json!({ "reviewRequests": { "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] } }))],
        );
        assert_eq!(found[0].via_teams, Some(vec!["acme/web".to_string()]));
        assert_eq!(found[1].via_teams, Some(vec![]));
    }

    #[test]
    fn drafts_made_ready() {
        let direct = json!({ "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] });
        let ready = |minutes_ago: i64| json!({ "nodes": [{ "createdAt": t(minutes_ago) }] });
        // Asked while a draft, then made ready: that's what's new, not arriving.
        let made_ready = pr(json!({ "reviewRequests": direct, "requested": { "nodes": [me_asked(120)] }, "ready": ready(10) }));
        let review = queue(Kind::Review, json!({ "notify": ["new", "ready"] }));
        let found = items(&review, std::slice::from_ref(&made_ready));
        assert_eq!(kinds(&found), ["new", "ready"]);
        let fresh = fresh_events(&found, &[&review], &HashSet::new(), &HashMap::new(), T0);
        assert_eq!(fresh.iter().map(|f| f.event.kind).collect::<Vec<_>>(), ["ready"]);
        // Made ready before you were asked: only asked.
        let earlier = pr(json!({ "reviewRequests": direct, "requested": { "nodes": [me_asked(10)] }, "ready": ready(120) }));
        assert_eq!(kinds(&items(&review, &[earlier])), ["new"]);
        // Still a draft (marked ready, then back to draft): nothing to say.
        let back = pr(json!({ "isDraft": true, "reviewRequests": direct, "requested": { "nodes": [me_asked(120)] }, "ready": ready(10) }));
        assert_eq!(kinds(&items(&queue(Kind::Review, json!({ "drafts": "show" })), &[back])), ["new"]);
        // Where you took part: ready since your last word.
        let approved = json!({ "nodes": [{ "state": "COMMENTED", "submittedAt": t(60), "commit": { "oid": "head" } }] });
        let found = items(&queue(Kind::Involved, json!({})), &[pr(json!({ "mine": approved, "ready": ready(10) }))]);
        assert!(kinds(&found).contains(&"ready"));
    }

    #[test]
    fn comments_say_what_was_said() {
        let direct = json!({ "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] });
        let found = items(
            &queue(Kind::Review, json!({})),
            &[pr(json!({ "reviewRequests": direct, "requested": { "nodes": [me_asked(60)] }, "comments": { "nodes": [comment("ana", 90, "before you were asked"), comment("bruno", 20, "> quoted\nCan you look at **this**?")] } }))],
        );
        let comments: Vec<&Event> = found[0].events.iter().filter(|e| e.kind == "comment").collect();
        assert_eq!(comments.len(), 1, "only since you were asked");
        assert_eq!(comments[0].text.as_deref(), Some("Can you look at this?"));
        let mine = items(
            &queue(Kind::Authored, json!({})),
            &[pr(json!({ "author": user(ME), "latestOpinionatedReviews": { "nodes": [{ "author": user("ana"), "state": "APPROVED", "submittedAt": t(5), "url": "u", "body": "Ship it" }] } }))],
        );
        let approved = mine[0].events.iter().find(|e| e.kind == "approved").unwrap();
        assert_eq!(approved.text.as_deref(), Some("Ship it"));
    }

    #[test]
    fn notifications_leave_out_what_was_asked() {
        let direct = json!({ "nodes": [{ "requestedReviewer": { "__typename": "User", "login": ME } }] });
        let prs = [
            pr(json!({ "reviewRequests": direct, "isDraft": true })),
            pr(json!({ "reviewRequests": direct, "author": bot("renovate") })),
            pr(json!({ "reviewRequests": direct, "mine": { "nodes": [{ "state": "APPROVED", "submittedAt": t(500), "commit": null }] }, "requested": { "nodes": [me_asked(400)] } })),
            pr(json!({ "reviewRequests": direct, "repository": { "nameWithOwner": "other/api" } })),
            pr(json!({ "reviewRequests": direct })),
        ];
        let count = |patch: Value| {
            let mut settings = json!({ "drafts": "show", "hideBots": false, "hideOnceReviewed": false });
            for (k, v) in patch.as_object().unwrap() {
                settings[k] = v.clone();
            }
            let q = queue(Kind::Review, settings);
            let found = items(&q, &prs);
            fresh_events(&found, &[&q], &HashSet::new(), &HashMap::new(), T0).len()
        };
        assert_eq!(count(json!({})), 5);
        assert_eq!(count(json!({ "notifyLeaveOut": ["drafts"] })), 4);
        assert_eq!(count(json!({ "notifyLeaveOut": ["bots"] })), 4);
        assert_eq!(count(json!({ "notifyLeaveOut": ["approved"] })), 4);
        assert_eq!(count(json!({ "notifyRepos": ["acme/*"] })), 4);
        assert_eq!(count(json!({ "notifyRepos": ["other/api"], "notifyLeaveOut": ["drafts", "bots", "approved"] })), 1);
        assert!(repo_matches("Acme/*", "acme/web") && repo_matches("acme/web", "ACME/web") && !repo_matches("acme/*", "acmeco/web"));
    }

    /// Answers from a script, and records the variables of each call.
    struct Script {
        replies: Mutex<Vec<Result<Value, Failure>>>,
        calls: Mutex<Vec<Value>>,
    }

    impl Gql for Script {
        fn query(&self, _query: &str, variables: Value) -> Result<Value, Failure> {
            self.calls.lock().unwrap().push(variables);
            self.replies.lock().unwrap().remove(0)
        }
    }

    fn page(nodes: Value) -> Result<Value, Failure> {
        Ok(json!({ "search": { "pageInfo": { "hasNextPage": false, "endCursor": null }, "nodes": nodes } }))
    }

    #[test]
    fn smaller_pages_when_github_cant_do_the_search() {
        let light = json!({ "id": "PR_A", "updatedAt": t(1), "headRefOid": "h", "mergeable": "MERGEABLE" });
        let script = Script {
            replies: Mutex::new(vec![
                Err(Failure { status: 200, message: "Resource limits for this query exceeded.".into() }),
                page(json!([light, null])),
                page(json!([light, {}])),
            ]),
            calls: Mutex::new(vec![]),
        };
        let found = search(&script, &queue(Kind::Review, json!({})), ME, T0, &[]).unwrap();
        assert_eq!(found.iter().map(|l| l.id.as_str()).collect::<Vec<_>>(), ["PR_A"]);
        let sizes: Vec<u64> = script.calls.lock().unwrap().iter().map(|v| v["size"].as_u64().unwrap()).collect();
        assert_eq!(sizes, [100, 50, 25]);

        let script = Script { replies: Mutex::new(vec![Err(Failure { status: 401, message: "Bad credentials".into() })]), calls: Mutex::new(vec![]) };
        assert_eq!(search(&script, &queue(Kind::Review, json!({})), ME, T0, &[]).unwrap_err().status, 401);
    }

    #[test]
    fn only_changed_pull_requests_are_fetched_again() {
        let light = |id: &str, updated: &str| json!({ "id": id, "updatedAt": updated, "headRefOid": "h", "mergeable": "MERGEABLE" });
        let full = |id: &str| json!({ "id": id, "number": 1, "title": id, "createdAt": t(5), "updatedAt": t(1) });
        let q = queue(Kind::Custom, json!({}));
        let mut cache = Cache::default();

        let first = Script { replies: Mutex::new(vec![page(json!([light("A", "1"), light("B", "1")])), Ok(json!({ "nodes": [full("A"), full("B")] }))]), calls: Mutex::new(vec![]) };
        sync(&first, &[&q], ME, &mut cache, false, false, T0).unwrap();
        assert_eq!(cache.prs.len(), 2);

        let second = Script { replies: Mutex::new(vec![page(json!([light("A", "1"), light("B", "2")])), Ok(json!({ "nodes": [full("B")] }))]), calls: Mutex::new(vec![]) };
        sync(&second, &[&q], ME, &mut cache, false, false, T0).unwrap();
        let calls = second.calls.lock().unwrap();
        assert_eq!(calls[1]["ids"], json!(["B"]));

        let third = Script { replies: Mutex::new(vec![page(json!([light("A", "1")]))]), calls: Mutex::new(vec![]) };
        sync(&third, &[&q], ME, &mut cache, false, false, T0).unwrap();
        assert_eq!(third.calls.lock().unwrap().len(), 1, "nothing changed: no second request");
        assert_eq!(cache.prs.keys().collect::<Vec<_>>(), ["A"], "B left the queue and the cache");
    }
}
