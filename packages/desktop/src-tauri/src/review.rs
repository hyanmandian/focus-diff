use serde::{Deserialize, Serialize};

use crate::config::{Order, ReviewTime, Session};
use crate::engine::PullRequest;
use crate::i18n::{one, tr};

const MINUTE: i64 = 60_000;
const DAY: i64 = 86_400_000;

pub fn minutes_of(time: &str) -> Option<i64> {
    let (h, m) = time.split_once(':')?;
    if h.len() != 2 || m.len() != 2 || !h.chars().chain(m.chars()).all(|c| c.is_ascii_digit()) {
        return None;
    }
    let (h, m) = (h.parse::<i64>().ok()?, m.parse::<i64>().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

pub fn local_offset(at: i64) -> i64 {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSDate, NSTimeZone};
        #[expect(clippy::cast_precision_loss, reason = "milliseconds since 1970 fit an f64 exactly")]
        let date = NSDate::dateWithTimeIntervalSince1970(at as f64 / 1000.0);
        NSTimeZone::localTimeZone().secondsFromGMTForDate(&date) as i64 * 1000
    }
    #[cfg(not(target_os = "macos"))]
    {
        use chrono::{Local, Offset, TimeZone};
        Local.timestamp_millis_opt(at).single().map_or(0, |t| i64::from(t.offset().fix().local_minus_utc()) * 1000)
    }
}

fn utc(local: i64, offset: &dyn Fn(i64) -> i64) -> i64 {
    local - offset(local - offset(local))
}

pub fn is_scheduled(settings: &ReviewTime) -> bool {
    settings.enabled && settings.sessions.iter().any(|s| s.on && !s.days.is_empty() && s.times.iter().any(|t| minutes_of(t).is_some()))
}

pub struct Due<'a> {
    pub session: &'a Session,
    pub at: i64,
}

pub fn due<'a>(settings: &'a ReviewTime, last: i64, now: i64, offset: &dyn Fn(i64) -> i64) -> Option<Due<'a>> {
    if !settings.enabled {
        return None;
    }
    let today = (now + offset(now)).div_euclid(DAY);
    let mut best: Option<Due> = None;
    for day in [today - 1, today] {
        let weekday = u8::try_from((day + 4).rem_euclid(7)).unwrap_or_default();
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

pub const LINES_PER_HOUR: f64 = 1000.0;
const REMOVED_LINE_WEIGHT: f64 = 0.2;
const MINUTES_PER_FILE: f64 = 0.25;
const PRIOR_MINUTES: f64 = 20.0;

pub fn pace_factor(learned: &serde_json::Value) -> f64 {
    let tally = |key: &str| learned["all"][key].as_f64().filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0);
    (tally("actual") + PRIOR_MINUTES) / (tally("expected") + PRIOR_MINUTES)
}

#[expect(clippy::cast_precision_loss, reason = "line and file counts are far below 2^53")]
pub fn estimate_minutes(pr: &PullRequest, pace: f64) -> f64 {
    let lines = pr.additions.max(0) as f64 + pr.deletions.max(0) as f64 * REMOVED_LINE_WEIGHT;
    (pr.changed_files.max(0) as f64 * MINUTES_PER_FILE + lines / LINES_PER_HOUR * 60.0) * pace
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunPull {
    pub id: String,
    pub title: String,
    pub repo: String,
    pub number: u64,
    pub url: String,
    pub minutes: u32,
    #[serde(default)]
    pub again: bool,
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub pull: RunPull,
    pub minutes: f64,
    pub created: i64,
}

impl Candidate {
    pub fn new(pr: &PullRequest, again: bool, pace: f64) -> Candidate {
        let minutes = estimate_minutes(pr, pace);
        let pull = RunPull {
            id: pr.id.clone(),
            title: pr.title.clone(),
            repo: pr.repository.name_with_owner.clone(),
            number: pr.number,
            url: pr.url.clone(),
            minutes: whole(minutes.round().max(1.0)),
            again,
        };
        Candidate { pull, minutes, created: crate::engine::time(Some(&pr.created_at)) }
    }
}

pub struct Plan {
    pub picked: Vec<RunPull>,
    pub left: usize,
    pub over_by: u32,
}

#[expect(clippy::cast_possible_truncation, clippy::cast_sign_loss, reason = "a float to int cast saturates, and minutes are never negative")]
fn whole(minutes: f64) -> u32 {
    minutes as u32
}

fn best_fill(items: &[&Candidate], budget: usize) -> Vec<usize> {
    let size = |c: &Candidate| (whole(c.minutes.ceil()) as usize).max(1);
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

pub fn plan(mut candidates: Vec<Candidate>, minutes: u32, order: Order, again_first: bool) -> Plan {
    let by_age = |a: &Candidate, b: &Candidate| a.created.cmp(&b.created);
    match order {
        Order::Oldest => candidates.sort_by(by_age),
        Order::Quickest | Order::Fill => candidates.sort_by(|a, b| a.minutes.total_cmp(&b.minutes).then(by_age(a, b))),
    }
    let (first, rest): (Vec<&Candidate>, Vec<&Candidate>) = candidates.iter().partition(|c| again_first && c.pull.again);
    let fit = |list: &[&Candidate], room: f64| -> Vec<usize> {
        if order == Order::Fill {
            let mut picks = best_fill(list, whole(room.max(0.0).floor()) as usize);
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
        over_by: whole((total.round() - f64::from(minutes)).max(0.0)),
        picked: picked.into_iter().map(|c| c.pull.clone()).collect(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
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

    pub fn minutes_left(&self, now: i64) -> i64 {
        ((self.ends_at() - now).max(0) + MINUTE - 1) / MINUTE
    }
}

pub fn offer_words(run: &Run) -> (String, String) {
    let total: u32 = run.pulls.iter().map(|p| p.minutes).sum();
    let name = &run.name;
    let n = run.pulls.len();
    let title = if n == 0 {
        tr!("{name}: nothing waiting on your review", "{name}: nada esperando sua revisão")
    } else if one(n) {
        tr!("{name}: 1 pull request, about {total} min", "{name}: 1 pull request, cerca de {total} min")
    } else {
        tr!("{name}: {n} pull requests, about {total} min", "{name}: {n} pull requests, cerca de {total} min")
    };
    let mut lines = vec![];
    if run.over_by > 0 {
        let first = run.pulls.first().map_or(0, |p| p.minutes);
        let (over, minutes) = (run.over_by, run.minutes);
        lines.push(tr!(
            "The one picked takes about {first} min, {over} min more than the {minutes} set aside.",
            "O escolhido leva cerca de {first} min, {over} min a mais que os {minutes} min reservados."
        ));
    }
    lines.extend(run.pulls.iter().take(4).map(|p| format!("{} · ~{} min", p.title, p.minutes)));
    if n > 4 {
        let more = n - 4;
        lines.push(tr!("and {more} more", "e mais {more}"));
    }
    let left = run.left;
    if left > 0 {
        lines.push(if one(left) { tr!("1 more waiting didn't fit.", "Mais 1 não coube.") } else { tr!("{left} more waiting didn't fit.", "Mais {left} não couberam.") });
    }
    (title, lines.join("\n"))
}

pub fn end_words(run: &Run, still_waiting: usize) -> (String, String) {
    let total = run.pulls.len();
    let reviewed = total.saturating_sub(still_waiting);
    let body = if reviewed == total {
        tr!("You went through all of them.", "Você passou por todos.")
    } else if one(total) {
        tr!("You reviewed {reviewed} of 1.", "Você revisou {reviewed} de 1 pull request.")
    } else {
        tr!("You reviewed {reviewed} of {total}.", "Você revisou {reviewed} de {total} pull requests.")
    };
    let name = &run.name;
    let title = if name == "Review time" { tr!("{name} is up", "O review time acabou") } else { tr!("{name} is up", "{name} acabou") };
    (title, body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use crate::i18n::{in_locale, Locale};

    const HOUR: i64 = 3_600_000;
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
        let s = settings(json!([{ "id": "a", "days": [1], "times": ["15:00"], "minutes": 30 }]));
        let sao_paulo = |_: i64| -3 * HOUR;
        assert!(due(&s, MONDAY + 15 * HOUR - MINUTE, MONDAY + 15 * HOUR, &sao_paulo).is_none());
        assert_eq!(due(&s, MONDAY + 18 * HOUR - MINUTE, MONDAY + 18 * HOUR, &sao_paulo).map(|d| d.at), Some(MONDAY + 18 * HOUR));
        let early = settings(json!([{ "id": "a", "days": [1], "times": ["08:00"], "minutes": 30 }]));
        let tokyo = |_: i64| 9 * HOUR;
        let at = MONDAY - HOUR;
        assert_eq!(due(&early, at - MINUTE, at, &tokyo).map(|d| d.at), Some(at));
        let summer = |t: i64| if t >= MONDAY + 2 * HOUR { HOUR } else { 0 };
        let nine = settings(json!([{ "id": "a", "days": [1], "times": ["09:00"], "minutes": 30 }]));
        assert_eq!(due(&nine, MONDAY, MONDAY + 8 * HOUR, &summer).map(|d| d.at), Some(MONDAY + 8 * HOUR));
    }

    #[test]
    fn across_midnight() {
        let s = settings(json!([{ "id": "late", "days": [5], "times": ["23:50"], "minutes": 30 }]));
        let friday = MONDAY + 4 * DAY;
        let start = friday + 23 * HOUR + 50 * MINUTE;
        assert_eq!(due(&s, start - MINUTE, start + 20 * MINUTE, &utc_zone).map(|d| d.session.id.as_str()), Some("late"));
        assert!(due(&s, start - MINUTE, start + 30 * MINUTE, &utc_zone).is_none());
        let two = settings(json!([{ "id": "a", "days": [1], "times": ["15:00"], "minutes": 60 }, { "id": "b", "days": [1], "times": ["15:30"], "minutes": 30 }]));
        let at = MONDAY + 15 * HOUR + 40 * MINUTE;
        assert_eq!(due(&two, MONDAY, at, &utc_zone).map(|d| d.session.id.as_str()), Some("b"));
    }

    fn candidate(id: &str, minutes: f64, age_days: i64, again: bool) -> Candidate {
        let pull = RunPull { id: id.into(), title: id.into(), repo: "acme/web".into(), number: 1, url: String::new(), minutes: whole(minutes.round()), again };
        Candidate { pull, minutes, created: MONDAY - age_days * DAY }
    }

    fn ids(plan: &Plan) -> Vec<&str> {
        plan.picked.iter().map(|p| p.id.as_str()).collect()
    }

    #[test]
    #[expect(clippy::float_cmp, reason = "these estimates come out exact")]
    fn estimates_from_changed_lines() {
        let pr: PullRequest = serde_json::from_value(json!({ "additions": 480, "deletions": 100, "changedFiles": 4 })).unwrap();
        assert_eq!(estimate_minutes(&pr, 1.0), 31.0, "500 weighted lines at 1,000 an hour, plus a minute for 4 files");
        assert_eq!(estimate_minutes(&pr, 2.0), 62.0);
        assert_eq!(pace_factor(&json!(null)), 1.0);
        assert_eq!(pace_factor(&json!({ "all": { "actual": 60, "expected": 20 } })), 2.0);
    }

    #[test]
    fn picks_what_fits() {
        let list = || vec![candidate("big", 25.0, 1, false), candidate("old", 10.0, 9, false), candidate("mid", 12.0, 5, false), candidate("tiny", 3.0, 2, false)];
        let oldest = plan(list(), 30, Order::Oldest, false);
        assert_eq!(ids(&oldest), ["old", "mid", "tiny"]);
        assert_eq!((oldest.left, oldest.over_by), (1, 0));
        assert_eq!(ids(&plan(list(), 30, Order::Quickest, false)), ["tiny", "old", "mid"]);
        assert_eq!(ids(&plan(list(), 28, Order::Fill, false)), ["tiny", "big"]);
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
        in_locale(Locale::En, || {
            let (title, body) = offer_words(&run);
            assert_eq!(title, "Review time: 2 pull requests, about 13 min");
            assert_eq!(body, "Fix login · ~9 min\nDocs · ~4 min\n2 more waiting didn't fit.");
            assert_eq!(end_words(&run, 1).1, "You reviewed 1 of 2.");
            assert_eq!(end_words(&run, 0).1, "You went through all of them.");
        });
        in_locale(Locale::PtBr, || {
            let (title, body) = offer_words(&run);
            assert_eq!(title, "Review time: 2 pull requests, cerca de 13 min");
            assert_eq!(body, "Fix login · ~9 min\nDocs · ~4 min\nMais 2 não couberam.");
            assert_eq!(end_words(&run, 1), ("O review time acabou".into(), "Você revisou 1 de 2 pull requests.".into()));
            assert_eq!(end_words(&run, 0).1, "Você passou por todos.");
        });
        assert_eq!(run.minutes_left(MONDAY + 29 * MINUTE + 1), 1);
        assert_eq!(run.minutes_left(MONDAY), 30);
    }
}
