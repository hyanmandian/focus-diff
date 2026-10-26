/**
 * Review time: times set aside to review, like weekdays at 15:00 for half an hour. When one comes, the pull requests
 * waiting on you are estimated and the ones that fit are picked: at least one, even if it runs over, which is then
 * said. A port of the desktop app's `src-tauri/src/review.rs`. The times are local, read through the system's time zone
 * (JavaScript's Date here), so a daylight saving change moves them with the clock.
 */

import { time, type PullRequest } from "../github-pulls/github-pulls";
import { attempt, fields } from "../json-decode/json-decode";
import { minutesOf, type Order, type ReviewTime, type Session } from "../queue-config/queue-config";
import type { ReviewRun, RunPull } from "../queue-panel/queue-panel";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** The review time under way, as it's saved. */
export type Run = ReviewRun["run"];

// MARK: When

/** How far local time is ahead of UTC at a moment (ms), by the system's time zone. */
export const localOffset = (at: number): number => -new Date(at).getTimezoneOffset() * MINUTE;

/**
 * A local time (ms, as if it were UTC) as the moment it is. The offset is the one at that moment, which near a daylight
 * saving change differs from the one a few hours before.
 */
const utc = (local: number, offset: (at: number) => number): number => local - offset(local - offset(local));

const mod = (n: number, m: number): number => ((n % m) + m) % m;

export interface Due {
  session: Session;
  at: number;
}

/**
 * The review time under way at `now` that started after `last` (when it was last looked for): the latest, if two
 * overlap. One that started while the computer slept, or the app was closed, still counts while there's time left in
 * it.
 */
export const due = (
  settings: ReviewTime,
  last: number,
  now: number,
  offset: (at: number) => number = localOffset,
): Due | null => {
  if (!settings.enabled) return null;
  const today = Math.floor((now + offset(now)) / DAY);
  let best: Due | null = null;
  // Yesterday's too: one late in the evening runs past midnight (and none lasts a day).
  for (const day of [today - 1, today]) {
    // 1970-01-01 was a Thursday; 0 is Sunday.
    const weekday = mod(day + 4, 7);
    for (const session of settings.sessions.filter((s) => s.on && s.days.includes(weekday))) {
      for (const start of session.times.map(minutesOf)) {
        if (start === null) continue;
        const at = utc(day * DAY + start * MINUTE, offset);
        const running = at > last && at <= now && now < at + session.minutes * MINUTE;
        if (running && (best === null || at > best.at)) best = { session, at };
      }
    }
  }
  return best;
};

// MARK: How long

/** Our assumption, not measured, the same as Focus Diff's own: a working review pace. */
export const LINES_PER_HOUR = 1000;
/** Removed code is read, not studied. */
const REMOVED_LINE_WEIGHT = 0.2;
/** Opening a file and getting oriented in it. */
const MINUTES_PER_FILE = 0.25;
/** How sure the starting pace is before anything's learned, in minutes of review. */
const PRIOR_MINUTES = 20;

/** One of what's learned of all files, as serde_json reads it: 0 when it isn't a number of minutes. */
const tally = (learned: unknown, key: string): number => {
  const value = attempt(() => fields(fields(learned).all)[key]);
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
};

/** How many times the starting pace the reader takes, from pace.json (estimate.ts's Learned); 1 until then. */
export const paceFactor = (learned: unknown): number =>
  (tally(learned, "actual") + PRIOR_MINUTES) / (tally(learned, "expected") + PRIOR_MINUTES);

/** Minutes to review a pull request from its totals, the same sum as the panel's estimate. */
export const estimateMinutes = (
  pr: Pick<PullRequest, "additions" | "deletions" | "changedFiles">,
  pace: number,
): number => {
  const lines = Math.max(pr.additions, 0) + Math.max(pr.deletions, 0) * REMOVED_LINE_WEIGHT;
  return (Math.max(pr.changedFiles, 0) * MINUTES_PER_FILE + (lines / LINES_PER_HOUR) * 60) * pace;
};

// MARK: What fits

/** A pull request waiting on you, before knowing whether it fits. */
export interface Candidate {
  pull: RunPull;
  minutes: number;
  /** When it was opened (ms), for the oldest first. */
  created: number;
}

export const candidate = (pr: PullRequest, again: boolean, pace: number): Candidate => {
  const minutes = estimateMinutes(pr, pace);
  return {
    pull: {
      id: pr.id,
      title: pr.title,
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      url: pr.url,
      minutes: Math.max(Math.round(minutes), 1),
      again,
    },
    minutes,
    created: time(pr.createdAt),
  };
};

export interface Plan {
  picked: RunPull[];
  /** Waiting too, but they didn't fit. */
  left: number;
  /** How much longer than the time set aside it takes, when even the one picked doesn't fit. */
  overBy: number;
}

/** The most minutes of review that fit in `budget`, and among those the most pull requests: a small knapsack, by whole
 *  minutes. */
const bestFill = (items: readonly Candidate[], budget: number): number[] => {
  const size = (c: Candidate) => Math.max(Math.ceil(c.minutes), 1);
  let best: Array<[number, number, number[]]> = Array.from({ length: budget + 1 }, () => [0, 0, []]);
  for (const [i, item] of items.entries()) {
    const s = size(item);
    const next = [...best];
    for (let room = s; room <= budget; room++) {
      const [used, count, picks] = best[room - s]!;
      const [nextUsed, nextCount] = next[room]!;
      if (used + s > nextUsed || (used + s === nextUsed && count + 1 > nextCount)) {
        next[room] = [used + s, count + 1, [...picks, i]];
      }
    }
    best = next;
  }
  return best.at(-1)![2];
};

/**
 * Picks what fits in `minutes`: in the session's order, each that still fits, or the mix that fills the time best.
 * With `againFirst`, the ones you were asked to review again go first, when they fit. With none that fits, the first
 * in order is picked anyway, and the plan says by how much it runs over.
 */
export const plan = (candidates: readonly Candidate[], minutes: number, order: Order, againFirst: boolean): Plan => {
  const byAge = (a: Candidate, b: Candidate) => a.created - b.created;
  const sorted =
    order === "oldest"
      ? candidates.toSorted(byAge)
      : candidates.toSorted((a, b) => a.minutes - b.minutes || byAge(a, b));
  const first = sorted.filter((c) => againFirst && c.pull.again);
  const rest = sorted.filter((c) => !(againFirst && c.pull.again));
  const fit = (list: readonly Candidate[], room: number): number[] => {
    if (order === "fill") {
      return bestFill(list, Math.floor(Math.max(room, 0))).toSorted((a, b) => byAge(list[a]!, list[b]!));
    }
    let left = room;
    const picks: number[] = [];
    for (const [i, c] of list.entries()) {
      if (c.minutes <= left) {
        picks.push(i);
        left -= c.minutes;
      }
    }
    return picks;
  };
  const picked = fit(first, minutes).map((i) => first[i]!);
  const used = picked.reduce((sum, c) => sum + c.minutes, 0);
  picked.push(...fit(rest, Math.floor(minutes - used)).map((i) => rest[i]!));
  const fallback = [...first, ...rest][0];
  if (picked.length === 0 && fallback) picked.push(fallback);
  const total = picked.reduce((sum, c) => sum + c.minutes, 0);
  return {
    left: candidates.length - picked.length,
    overBy: Math.max(Math.round(total) - minutes, 0),
    picked: picked.map((c) => c.pull),
  };
};

// MARK: Under way

export const endsAt = (run: Run): number => run.startedAt + run.minutes * MINUTE;

/** Whole minutes left, rounded up, so the last minute shows as 1 rather than 0. */
export const minutesLeft = (run: Run, now: number): number =>
  Math.floor((Math.max(endsAt(run) - now, 0) + MINUTE - 1) / MINUTE);

// MARK: Words

/** What review time says, in English and Brazilian Portuguese: review.rs's `tr!`, the extension's reviewTime*. */
export interface ReviewWords {
  /** A session's name when it has none. */
  reviewTime: string;
  nothingWaiting: (name: string) => string;
  onePull: (name: string, total: number) => string;
  pulls: (name: string, n: number, total: number) => string;
  over: (first: number, over: number, minutes: number) => string;
  more: (n: number) => string;
  oneLeft: string;
  left: (n: number) => string;
  wentThroughAll: string;
  reviewedOfOne: (reviewed: number) => string;
  reviewedOf: (reviewed: number, total: number) => string;
  isUp: (name: string) => string;
}

export const ENGLISH_REVIEW: ReviewWords = {
  reviewTime: "Review time",
  nothingWaiting: (name) => `${name}: nothing waiting on your review`,
  onePull: (name, total) => `${name}: 1 pull request, about ${total} min`,
  pulls: (name, n, total) => `${name}: ${n} pull requests, about ${total} min`,
  over: (first, over, minutes) =>
    `The one picked takes about ${first} min, ${over} min more than the ${minutes} set aside.`,
  more: (n) => `and ${n} more`,
  oneLeft: "1 more waiting didn't fit.",
  left: (n) => `${n} more waiting didn't fit.`,
  wentThroughAll: "You went through all of them.",
  reviewedOfOne: (reviewed) => `You reviewed ${reviewed} of 1.`,
  reviewedOf: (reviewed, total) => `You reviewed ${reviewed} of ${total}.`,
  isUp: (name) => `${name} is up`,
};

export const PORTUGUESE_REVIEW: ReviewWords = {
  reviewTime: "Review time",
  nothingWaiting: (name) => `${name}: nada esperando sua revisão`,
  onePull: (name, total) => `${name}: 1 pull request, cerca de ${total} min`,
  pulls: (name, n, total) => `${name}: ${n} pull requests, cerca de ${total} min`,
  over: (first, over, minutes) =>
    `O escolhido leva cerca de ${first} min, ${over} min a mais que os ${minutes} min reservados.`,
  more: (n) => `e mais ${n}`,
  oneLeft: "Mais 1 não coube.",
  left: (n) => `Mais ${n} não couberam.`,
  wentThroughAll: "Você passou por todos.",
  reviewedOfOne: (reviewed) => `Você revisou ${reviewed} de 1 pull request.`,
  reviewedOf: (reviewed, total) => `Você revisou ${reviewed} de ${total} pull requests.`,
  // The default name reads as a noun in Portuguese, as the extension says it.
  isUp: (name) => (name === "Review time" ? "O review time acabou" : `${name} acabou`),
};

/** The notification a review time starts with: what fits, and how long each takes. */
export const offerWords = (run: Run, words: ReviewWords): { title: string; body: string } => {
  const total = run.pulls.reduce((sum, p) => sum + p.minutes, 0);
  const n = run.pulls.length;
  const title =
    n === 0
      ? words.nothingWaiting(run.name)
      : n === 1
        ? words.onePull(run.name, total)
        : words.pulls(run.name, n, total);
  const lines: string[] = [];
  if (run.overBy > 0) lines.push(words.over(run.pulls[0]?.minutes ?? 0, run.overBy, run.minutes));
  lines.push(...run.pulls.slice(0, 4).map((p) => `${p.title} · ~${p.minutes} min`));
  if (n > 4) lines.push(words.more(n - 4));
  if (run.left > 0) lines.push(run.left === 1 ? words.oneLeft : words.left(run.left));
  return { title, body: lines.join("\n") };
};

/** The notification when the time's up: how far it got, by how many of the ones picked are still waiting on you. */
export const endWords = (run: Run, stillWaiting: number, words: ReviewWords): { title: string; body: string } => {
  const total = run.pulls.length;
  const reviewed = Math.max(total - stillWaiting, 0);
  const body =
    reviewed === total
      ? words.wentThroughAll
      : total === 1
        ? words.reviewedOfOne(reviewed)
        : words.reviewedOf(reviewed, total);
  return { title: words.isUp(run.name), body };
};
