//! Review time: times set aside to review, like weekdays at 15:00 for half an hour. When one comes,
//! the pull requests waiting on you are estimated and the ones that fit are picked: at least one,
//! even if it runs over, which is then said. The times are local, read through the system's time
//! zone, so a daylight saving change moves them with the clock.

use serde::{Deserialize, Serialize};

use crate::config::{Order, ReviewTime, Session};
use crate::engine::PullRequest;

const MINUTE: i64 = 60_000;
const DAY: i64 = 86_400_000;

// MARK: When

/// "HH:MM" as minutes after midnight.
pub fn minutes_of(time: &str) -> Option<i64> {
    let (h, m) = time.split_once(':')?;
    if h.len() != 2 || m.len() != 2 || !h.chars().chain(m.chars()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (h, m) = (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

/// How far local time is ahead of UTC at a moment (ms), by the system's time zone as it is now
/// (it follows a change in System Settings). Elsewhere than macOS there's no time zone to read
/// without another library, so review times are in UTC there.
pub fn local_offset(at: i64) -> i64 {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSDate, NSTimeZone};
        let date = NSDate::dateWithTimeIntervalSince1970(at as f64 / 1000.0);
        NSTimeZone::localTimeZone().secondsFromGMTForDate(&date) as i64 * 1000
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = at;
        0
    }
}

/// A local time (ms, as if it were UTC) as the moment it is. The offset is the one at that moment,
/// which near a daylight saving change differs from the one a few hours before.
fn utc(local: i64, offset: &dyn Fn(i64) -> i64) -> i64 {
    local - offset(local - offset(local))
}

/// Whether any review time is coming at all.
pub fn is_scheduled(settings: &ReviewTime) -> bool {
    settings.enabled && settings.sessions.iter().any(|s| s.on && !s.days.is_empty() && s.times.iter().any(|t| minutes_of(t).is_some()))
}

pub struct Due<'a> {
    pub session: &'a Session,
    pub at: i64,
}

/// The review time under way at `now` that started after `last` (when it was last looked for):
/// the latest, if two overlap. One that started while the computer slept, or the app was closed,
/// still counts while there's time left in it.
pub fn due<'a>(settings: &'a ReviewTime, last: i64, now: i64, offset: &dyn Fn(i64) -> i64) -> Option<Due<'a>> {
    if !settings.enabled {
        return None;
    }
    let today = (now + offset(now)).div_euclid(DAY);
    let mut best: Option<Due> = None;
    // Yesterday's too: one late in the evening runs past midnight (and none lasts a day).
    for day in [today - 1, today] {
        // 1970-01-01 was a Thursday; 0 is Sunday.
        let weekday = (day + 4).rem_euclid(7) as u8;
        for session in settings.sessions.iter().filter(|s| s.on && s.days.contains(&weekday)) {
            for start in session.times.iter().filter_map(|t| minutes_of(t)) {
                let at = utc(day * DAY + start * MINUTE, offset);
                let running = at > last && at <= now && now < at + i64::from(session.minutes) * MINUTE;
                if running && best.as_ref().is_none_or(|b| at > b.at) {
                    best = Some(Due { session, at });
                }
            }
        }
    }
    best
}

// MARK: How long

/// Our assumption, not measured, the same as Focus Diff's own: a working review pace.
pub const LINES_PER_HOUR: f64 = 1000.0;
/// Reading the description and writing the review, on top of the lines.
const PER_PULL_MINUTES: f64 = 2.0;

/// Minutes to review a pull request, from its changed lines. The one place an estimate is made,
/// so a better one (a pace learned from the person's own reviews) can take its place.
pub fn estimate_minutes(pr: &PullRequest) -> f64 {
    let lines = (pr.additions + pr.deletions).max(0) as f64;
    PER_PULL_MINUTES + lines / LINES_PER_HOUR * 60.0
}

// MARK: What fits

/// A pull request picked for review time, as the panel lists it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPull {
    pub id: String,
    pub title: String,
    pub repo: String,
    pub number: u64,
    pub url: String,
    pub minutes: u32,
    /// You were asked to review it again.
    #[serde(default)]
    pub again: bool,
}

/// A pull request waiting on you, before knowing whether it fits.
#[derive(Clone, Debug)]
pub struct Candidate {
    pub pull: RunPull,
    pub minutes: f64,
    /// When it was opened (ms), for the oldest first.
    pub created: i64,
}

impl Candidate {
    pub fn new(pr: &PullRequest, again: bool) -> Candidate {
        let minutes = estimate_minutes(pr);
        let pull = RunPull {
            id: pr.id.clone(),
            title: pr.title.clone(),
            repo: pr.repository.name_with_owner.clone(),
            number: pr.number,
            url: pr.url.clone(),
            minutes: minutes.round().max(1.0) as u32,
            again,
        };
        Candidate { pull, minutes, created: crate::engine::time(Some(&pr.created_at)) }
    }
}

pub struct Plan {
    pub picked: Vec<RunPull>,
    /// Waiting too, but they didn't fit.
    pub left: usize,
    /// How much longer than the time set aside it takes, when even the one picked doesn't fit.
    pub over_by: u32,
}

/// The most minutes of review that fit in `budget`, and among those the most pull requests: a small
/// knapsack, by whole minutes.
fn best_fill(items: &[&Candidate], budget: usize) -> Vec<usize> {
    let size = |c: &Candidate| (c.minutes.ceil() as usize).max(1);
    // best[room]: (minutes used, how many, which) within that many minutes.
    let mut best: Vec<(usize, usize, Vec<usize>)> = vec![(0, 0, vec![]); budget + 1];
    for (i, item) in items.iter().enumerate() {
        let s = size(item);
        let mut next = best.clone();
        for room in s..=budget {
            let (used, count, picks) = &best[room - s];
            let candidate = (used + s, count + 1, [picks.as_slice(), &[i]].concat());
            if (candidate.0, candidate.1) > (next[room].0, next[room].1) {
                next[room] = candidate;
            }
        }
        best = next;
    }
    best.pop().map(|b| b.2).unwrap_or_default()
}

/// Picks what fits in `minutes`: in the session's order, each that still fits, or the mix that
/// fills the time best. With `again_first`, the ones you were asked to review again go first, when
/// they fit. With none that fits, the first in order is picked anyway, and the plan says by how much
/// it runs over.
pub fn plan(mut candidates: Vec<Candidate>, minutes: u32, order: Order, again_first: bool) -> Plan {
    let by_age = |a: &Candidate, b: &Candidate| a.created.cmp(&b.created);
    match order {
        Order::Oldest => candidates.sort_by(by_age),
        Order::Quickest | Order::Fill => candidates.sort_by(|a, b| a.minutes.total_cmp(&b.minutes).then(by_age(a, b))),
    }
    let (first, rest): (Vec<&Candidate>, Vec<&Candidate>) = candidates.iter().partition(|c| again_first && c.pull.again);
    let fit = |list: &[&Candidate], room: f64| -> Vec<usize> {
        if order == Order::Fill {
            let mut picks = best_fill(list, room.max(0.0).floor() as usize);
            picks.sort_by(|a, b| by_age(list[*a], list[*b]));
            return picks;
        }
        let mut room = room;
        let mut picks = vec![];
        for (i, c) in list.iter().enumerate() {
            if c.minutes <= room {
                picks.push(i);
                room -= c.minutes;
            }
        }
        picks
    };
    let budget = f64::from(minutes);
    let mut picked: Vec<&Candidate> = fit(&first, budget).into_iter().map(|i| first[i]).collect();
    let used: f64 = picked.iter().map(|c| c.minutes).sum();
    picked.extend(fit(&rest, (budget - used).floor()).into_iter().map(|i| rest[i]));
    if picked.is_empty() {
        picked.extend(first.iter().chain(rest.iter()).next().copied());
    }
    let total: f64 = picked.iter().map(|c| c.minutes).sum();
    Plan {
        left: candidates.len() - picked.len(),
        over_by: (total.round() as i64 - i64::from(minutes)).max(0) as u32,
        picked: picked.into_iter().map(|c| c.pull.clone()).collect(),
    }
}

// MARK: Under way

/// A review time under way. Saved (state.json), so it carries on over a restart.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    /// The session it's from.
    pub session: String,
    pub name: String,
    pub minutes: u32,
    pub started_at: i64,
    pub pulls: Vec<RunPull>,
    pub left: usize,
    pub over_by: u32,
}

impl Run {
    pub fn ends_at(&self) -> i64 {
        self.started_at + i64::from(self.minutes) * MINUTE
    }

    /// Whole minutes left, rounded up, so the last minute shows as 1 rather than 0.
    pub fn minutes_left(&self, now: i64) -> i64 {
        ((self.ends_at() - now).max(0) + MINUTE - 1) / MINUTE
    }
}

fn plural(n: usize, one: &str, many: &str) -> String {
    if n == 1 { format!("1 {one}") } else { format!("{n} {many}") }
}

/// The notification a review time starts with: what fits, and how long each takes.
pub fn offer_words(run: &Run) -> (String, String) {
    let total: u32 = run.pulls.iter().map(|p| p.minutes).sum();
    let title = if run.pulls.is_empty() {
        format!("{}: nothing waiting on your review", run.name)
    } else {
        format!("{}: {}, about {total} min", run.name, plural(run.pulls.len(), "pull request", "pull requests"))
    };
    let mut lines = vec![];
    if run.over_by > 0 {
        let first = run.pulls.first().map_or(0, |p| p.minutes);
        lines.push(format!("The one picked takes about {first} min, {} min more than the {} set aside.", run.over_by, run.minutes));
    }
    lines.extend(run.pulls.iter().take(4).map(|p| format!("{} · ~{} min", p.title, p.minutes)));
    if run.pulls.len() > 4 {
        lines.push(format!("and {} more", run.pulls.len() - 4));
    }
    if run.left > 0 {
        lines.push(format!("{} waiting didn't fit.", plural(run.left, "more", "more")));
    }
    (title, lines.join("\n"))
}

/// The notification when the time's up: how far it got, by how many of the ones picked are still
/// waiting on you.
pub fn end_words(run: &Run, still_waiting: usize) -> (String, String) {
    let total = run.pulls.len();
    let reviewed = total.saturating_sub(still_waiting);
    let body = if reviewed == total { "You went through all of them.".to_string() } else { format!("You reviewed {reviewed} of {total}.") };
    (format!("{} is up", run.name), body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const HOUR: i64 = 3_600_000;
    /// Monday 2026-01-05 00:00 UTC.
    const MONDAY: i64 = 1_767_571_200_000;

    fn settings(sessions: serde_json::Value) -> ReviewTime {
        serde_json::from_value(json!({ "enabled": true, "sessions": sessions })).unwrap()
    }

    fn utc_zone(_: i64) -> i64 {
        0
    }

    #[test]
    fn times() {
        assert_eq!(minutes_of("15:00"), Some(900));
        assert_eq!(minutes_of("00:05"), Some(5));
        for bad in ["24:00", "9:00", "12:60", "+1:00", "ab:cd", ""] {
            assert_eq!(minutes_of(bad), None, "{bad}");
        }
    }

    #[test]
    fn weekdays_at_a_time_for_a_while() {
        let s = settings(json!([{ "id": "a", "days": [1, 2, 3, 4, 5], "times": ["15:00"], "minutes": 30 }]));
        let at = MONDAY + 15 * HOUR;
        assert_eq!(due(&s, at - MINUTE, at, &utc_zone).map(|d| d.at), Some(at));
        assert_eq!(due(&s, at - MINUTE, at + 29 * MINUTE, &utc_zone).map(|d| d.at), Some(at), "caught up later, while it lasts");
        assert!(due(&s, at - MINUTE, at + 30 * MINUTE, &utc_zone).is_none(), "over");
        assert!(due(&s, at, at + MINUTE, &utc_zone).is_none(), "already looked at");
        assert!(due(&s, at - MINUTE, at - 1, &utc_zone).is_none(), "not yet");
        let sunday = at - DAY;
        assert!(due(&s, sunday - MINUTE, sunday, &utc_zone).is_none(), "not on Sundays");
        let off = settings(json!([{ "id": "a", "on": false, "days": [1], "times": ["15:00"] }]));
        assert!(due(&off, at - MINUTE, at, &utc_zone).is_none());
        let disabled: ReviewTime = serde_json::from_value(json!({ "enabled": false, "sessions": [{ "id": "a", "days": [1], "times": ["15:00"] }] })).unwrap();
        assert!(due(&disabled, at - MINUTE, at, &utc_zone).is_none());
        assert!(!is_scheduled(&disabled) && is_scheduled(&s));
    }

    #[test]
    fn local_time_in_the_systems_zone() {
        // São Paulo, three hours behind: 15:00 there is 18:00 UTC.
        let s = settings(json!([{ "id": "a", "days": [1], "times": ["15:00"], "minutes": 30 }]));
        let sao_paulo = |_: i64| -3 * HOUR;
        assert!(due(&s, MONDAY + 15 * HOUR - MINUTE, MONDAY + 15 * HOUR, &sao_paulo).is_none());
        assert_eq!(due(&s, MONDAY + 18 * HOUR - MINUTE, MONDAY + 18 * HOUR, &sao_paulo).map(|d| d.at), Some(MONDAY + 18 * HOUR));
        // Tokyo, nine hours ahead: Monday 08:00 there is Sunday 23:00 UTC.
        let early = settings(json!([{ "id": "a", "days": [1], "times": ["08:00"], "minutes": 30 }]));
        let tokyo = |_: i64| 9 * HOUR;
        let at = MONDAY - HOUR;
        assert_eq!(due(&early, at - MINUTE, at, &tokyo).map(|d| d.at), Some(at));
        // The clock goes forward an hour at 02:00 UTC: 09:00 local is then 08:00 UTC, not 09:00.
        let summer = |t: i64| if t >= MONDAY + 2 * HOUR { HOUR } else { 0 };
        let nine = settings(json!([{ "id": "a", "days": [1], "times": ["09:00"], "minutes": 30 }]));
        assert_eq!(due(&nine, MONDAY, MONDAY + 8 * HOUR, &summer).map(|d| d.at), Some(MONDAY + 8 * HOUR));
    }

    #[test]
    fn across_midnight() {
        // Friday 23:50 for 30 minutes: still on at Saturday 00:10, though Saturday isn't one of its days.
        let s = settings(json!([{ "id": "late", "days": [5], "times": ["23:50"], "minutes": 30 }]));
        let friday = MONDAY + 4 * DAY;
        let start = friday + 23 * HOUR + 50 * MINUTE;
        assert_eq!(due(&s, start - MINUTE, start + 20 * MINUTE, &utc_zone).map(|d| d.session.id.as_str()), Some("late"));
        assert!(due(&s, start - MINUTE, start + 30 * MINUTE, &utc_zone).is_none());
        // Two overlapping: the later one.
        let two = settings(json!([{ "id": "a", "days": [1], "times": ["15:00"], "minutes": 60 }, { "id": "b", "days": [1], "times": ["15:30"], "minutes": 30 }]));
        let at = MONDAY + 15 * HOUR + 40 * MINUTE;
        assert_eq!(due(&two, MONDAY, at, &utc_zone).map(|d| d.session.id.as_str()), Some("b"));
    }

    fn candidate(id: &str, minutes: f64, age_days: i64, again: bool) -> Candidate {
        let pull = RunPull { id: id.into(), title: id.into(), repo: "acme/web".into(), number: 1, url: String::new(), minutes: minutes.round() as u32, again };
        Candidate { pull, minutes, created: MONDAY - age_days * DAY }
    }

    fn ids(plan: &Plan) -> Vec<&str> {
        plan.picked.iter().map(|p| p.id.as_str()).collect()
    }

    #[test]
    fn estimates_from_changed_lines() {
        let pr: PullRequest = serde_json::from_value(json!({ "additions": 400, "deletions": 100 })).unwrap();
        assert_eq!(estimate_minutes(&pr), 32.0, "500 lines at 1,000 an hour, plus 2 minutes");
    }

    #[test]
    fn picks_what_fits() {
        let list = || vec![candidate("big", 25.0, 1, false), candidate("old", 10.0, 9, false), candidate("mid", 12.0, 5, false), candidate("tiny", 3.0, 2, false)];
        // Oldest first, each that still fits.
        let oldest = plan(list(), 30, Order::Oldest, false);
        assert_eq!(ids(&oldest), ["old", "mid", "tiny"]);
        assert_eq!((oldest.left, oldest.over_by), (1, 0));
        // Quickest first: as many as fit.
        assert_eq!(ids(&plan(list(), 30, Order::Quickest, false)), ["tiny", "old", "mid"]);
        // The mix that fills the time best, oldest first.
        assert_eq!(ids(&plan(list(), 28, Order::Fill, false)), ["tiny", "big"]);
        // Asked again goes first when it fits.
        let again = vec![candidate("old", 10.0, 9, false), candidate("again", 20.0, 1, true), candidate("mid", 12.0, 5, false)];
        assert_eq!(ids(&plan(again.clone(), 30, Order::Oldest, true)), ["again", "old"]);
        assert_eq!(ids(&plan(again, 30, Order::Oldest, false)), ["old", "mid"]);
    }

    #[test]
    fn one_even_when_none_fits() {
        let over = plan(vec![candidate("huge", 50.0, 1, false), candidate("bigger", 70.0, 3, false)], 30, Order::Oldest, false);
        assert_eq!(ids(&over), ["bigger"]);
        assert_eq!((over.over_by, over.left), (40, 1));
        assert!(plan(vec![], 30, Order::Fill, true).picked.is_empty());
    }

    #[test]
    fn words() {
        let run = Run {
            session: "a".into(),
            name: "Review time".into(),
            minutes: 30,
            started_at: MONDAY,
            pulls: vec![candidate("Fix login", 9.0, 1, false).pull, candidate("Docs", 4.0, 1, false).pull],
            left: 2,
            over_by: 0,
        };
        let (title, body) = offer_words(&run);
        assert_eq!(title, "Review time: 2 pull requests, about 13 min");
        assert_eq!(body, "Fix login · ~9 min\nDocs · ~4 min\n2 more waiting didn't fit.");
        assert_eq!(end_words(&run, 1).1, "You reviewed 1 of 2.");
        assert_eq!(end_words(&run, 0).1, "You went through all of them.");
        assert_eq!(run.minutes_left(MONDAY + 29 * MINUTE + 1), 1);
        assert_eq!(run.minutes_left(MONDAY), 30);
    }
}
