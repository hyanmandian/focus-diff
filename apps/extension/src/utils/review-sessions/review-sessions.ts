import type { Estimator } from "@focus-diff/core/estimate";
import { toMatcher, type Matcher } from "@focus-diff/core/filters";
import { repoMatches } from "@focus-diff/core/repos";

import { filtersFor, newId, type Config } from "@/utils/filters/filters";
import type { PullRequest } from "@/utils/github-inbox/github-inbox";
import { repoList } from "@/utils/inbox/inbox";
import { asRecord, keysOf, oneOf } from "@/utils/record/record";
import { PACES, type Pace } from "@/utils/review-time/review-time";
import { normalizeSound, type SoundSetting } from "@/utils/sound/sound";

/**
 * Review time: times the reader sets aside to review, like every weekday at 15:00 for half an hour. When one comes,
 * the pull requests waiting for their review are estimated the way the bar estimates them, and the ones that fit in
 * the time are picked, at least one even if it takes longer, which is then said.
 */

/** Which of the pull requests that fit go first, and so which are left out when not all of them do. */
export type Order = "oldest" | "quickest" | "fill";
export const ORDERS: Order[] = ["oldest", "quickest", "fill"];

/** At set times of the day, or every few hours between two. */
type Repeat = "times" | "every";

export const MINUTE_PRESETS = [15, 30, 45, 60, 90] as const;
export const EVERY_HOURS = [1, 2, 3, 4] as const;
export const EXTRA_MINUTES = [0, 2, 5, 10] as const;
export const SNOOZE_MINUTES = [5, 10, 15, 30] as const;
const MIN_MINUTES = 5;
const MAX_MINUTES = 240;
const MAX_SESSIONS = 10;
const MAX_TIMES = 12;

export interface ReviewSession {
  id: string;
  name: string;
  on: boolean;
  /** Days of the week it's on, 0 for Sunday. */
  days: number[];
  repeat: Repeat;
  /** `HH:MM`, for `times`. */
  times: string[];
  /** Hours between two, from `from` up to `to`, for `every`. */
  every: number;
  from: string;
  to: string;
  /** The time set aside. */
  minutes: number;
  order: Order;
  /** The filters whose files count, by id; none counts every file. */
  filters: string[];
  repos: string[];
  excludeRepos: string[];
  drafts: boolean;
}

/** What Start opens: the first pull request, all of them in tabs, or nothing, for the popup's list. */
export const OPENS = ["first", "all", "none"] as const;
export type Opens = (typeof OPENS)[number];

export interface ReviewTimeSettings {
  enabled: boolean;
  sessions: ReviewSession[];
  /** How fast the reader reads a diff to start with, for every estimate, the bar's too. */
  pace: Pace;
  /** Whether the estimates learn the reader's own pace from the files they review. */
  learn: boolean;
  /** Minutes on top of each pull request's files: its description, and writing the review. */
  perPull: number;
  /** Only the files not marked as viewed count, so a review half done takes half the time. */
  unviewedOnly: boolean;
  /** Pull requests the reader was asked to review again come first. */
  againFirst: boolean;
  /** The popup's review queue says how long each pull request takes, which reads each one's files once per push. */
  queueEstimates: boolean;
  opens: Opens;
  /** Opening a pull request from review time turns its filters on in the bar. */
  applyFilters: boolean;
  snooze: number;
  /** A notification when the time's up, saying how far it got. */
  remindEnd: boolean;
  /** With nothing to review, the time passes without a word. */
  skipEmpty: boolean;
  /** While reviewing, every notification waits for the time to be up. */
  holdWhileReviewing: boolean;
  sound: SoundSetting;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
const WEEKDAYS = [1, 2, 3, 4, 5];

export const newSession = (name = ""): ReviewSession => ({
  id: newId(),
  name,
  on: true,
  days: WEEKDAYS,
  repeat: "times",
  times: ["15:00"],
  every: 2,
  from: "09:00",
  to: "18:00",
  minutes: 30,
  order: "oldest",
  filters: [],
  repos: [],
  excludeRepos: [],
  drafts: false,
});

export const DEFAULT_REVIEW_TIME: ReviewTimeSettings = {
  enabled: false,
  sessions: [],
  pace: "steady",
  learn: true,
  perPull: 2,
  unviewedOnly: true,
  againFirst: true,
  queueEstimates: true,
  opens: "first",
  applyFilters: true,
  snooze: 10,
  remindEnd: true,
  skipEmpty: true,
  holdWhileReviewing: false,
  sound: { id: "bowl", volume: 70 },
};

const time = (value: unknown, fallback: string) => (typeof value === "string" && TIME.test(value) ? value : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const normalizeSession = (value: unknown): ReviewSession => {
  const raw = asRecord(value);
  const base = newSession();
  const days = Array.isArray(raw.days)
    ? raw.days.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
    : base.days;
  const times = Array.isArray(raw.times)
    ? raw.times.filter((each): each is string => typeof each === "string" && TIME.test(each))
    : base.times;
  const minutes = Number(raw.minutes);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : base.id,
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "",
    on: flag(raw.on, true),
    days: [...new Set(days)].toSorted((a, b) => a - b),
    repeat: oneOf(["times", "every"] as const, raw.repeat, base.repeat),
    times: [...new Set(times)].toSorted().slice(0, MAX_TIMES),
    every: oneOf(EVERY_HOURS, raw.every, 2),
    from: time(raw.from, base.from),
    to: time(raw.to, base.to),
    minutes: Number.isFinite(minutes)
      ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)))
      : base.minutes,
    order: oneOf(ORDERS, raw.order, base.order),
    filters: Array.isArray(raw.filters)
      ? [...new Set(raw.filters.filter((id): id is string => typeof id === "string"))]
      : [],
    repos: repoList(raw.repos),
    excludeRepos: repoList(raw.excludeRepos),
    drafts: flag(raw.drafts, false),
  };
};

export const normalizeReviewTime = (value: unknown): ReviewTimeSettings => {
  const raw = asRecord(value);
  const defaults = DEFAULT_REVIEW_TIME;
  const sessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
    .slice(0, MAX_SESSIONS)
    .map((each) => normalizeSession(each));
  // Ids come from storage another device wrote; two the same would edit as one.
  const seen = new Set<string>();
  for (const session of sessions) {
    while (seen.has(session.id)) session.id = newId();
    seen.add(session.id);
  }
  return {
    enabled: flag(raw.enabled, defaults.enabled),
    sessions,
    pace: oneOf(keysOf(PACES), raw.pace, defaults.pace),
    learn: flag(raw.learn, defaults.learn),
    perPull: oneOf(EXTRA_MINUTES, raw.perPull, defaults.perPull),
    unviewedOnly: flag(raw.unviewedOnly, defaults.unviewedOnly),
    againFirst: flag(raw.againFirst, defaults.againFirst),
    queueEstimates: flag(raw.queueEstimates, defaults.queueEstimates),
    opens: oneOf(OPENS, raw.opens, defaults.opens),
    applyFilters: flag(raw.applyFilters, defaults.applyFilters),
    snooze: oneOf(SNOOZE_MINUTES, raw.snooze, defaults.snooze),
    remindEnd: flag(raw.remindEnd, defaults.remindEnd),
    skipEmpty: flag(raw.skipEmpty, defaults.skipEmpty),
    holdWhileReviewing: flag(raw.holdWhileReviewing, defaults.holdWhileReviewing),
    sound: normalizeSound(raw.sound, defaults.sound),
  };
};

/** Whether any review time is coming at all. */
export const isScheduled = (settings: ReviewTimeSettings): boolean =>
  settings.enabled &&
  settings.sessions.some((session) => session.on && session.days.length > 0 && startsOf(session).length > 0);

const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

/** The minutes after midnight a session starts at, on a day it's on. */
export const startsOf = (session: ReviewSession): number[] => {
  if (session.repeat === "times") return session.times.map(toMinutes);
  const starts: number[] = [];
  for (let at = toMinutes(session.from); at <= toMinutes(session.to); at += session.every * 60) starts.push(at);
  return starts;
};

export interface Occurrence {
  session: ReviewSession;
  at: number;
}

/** The next review time strictly after `after`, looking a week ahead. */
export const nextOccurrence = (settings: ReviewTimeSettings, after: number): Occurrence | null => {
  if (!settings.enabled) return null;
  let best: Occurrence | null = null;
  const start = new Date(after);
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    for (const session of settings.sessions) {
      if (!session.on || !session.days.includes(day.getDay())) continue;
      for (const minutes of startsOf(session)) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime();
        if (at > after && (!best || at < best.at)) best = { session, at };
      }
    }
    if (best) return best;
  }
  return best;
};

/** The sessions due at `at`, to the minute: two set for the same time come as one. */
export const sessionsAt = (settings: ReviewTimeSettings, at: number): ReviewSession[] => {
  const day = new Date(at);
  const minute = day.getHours() * 60 + day.getMinutes();
  return settings.sessions.filter(
    (session) => session.on && session.days.includes(day.getDay()) && startsOf(session).includes(minute),
  );
};

/** A changed file as review time knows it: its path, line counts, and whether the reader marked it viewed. */
export type PullFile = [path: string, additions: number, deletions: number, viewed: boolean];

/** A pull request's files as last read, by its head commit, so a new push reads them again. */
export interface FilesRecord {
  sha: string;
  files: PullFile[];
  /** When they were read, for which are viewed. */
  readAt?: number;
}

export interface Estimate {
  minutes: number;
  /** Files that count: in the session's filters and, if asked, not viewed yet. */
  files: number;
  /** A rough guess, for a pull request whose files couldn't be read. */
  guessed?: boolean;
}

/** The session's filters that apply in a repository, as matchers; `null` counts every file. */
export const sessionMatchers = (config: Config, repo: string, ids: string[]): Matcher[] | null => {
  if (ids.length === 0) return null;
  const matchers = filtersFor(config, repo)
    .filter((filter) => ids.includes(filter.id))
    .flatMap((filter) => toMatcher(filter) ?? []);
  // A repository none of the filters are for is reviewed whole.
  return matchers.length > 0 ? matchers : null;
};

/** The filter ids of a session that apply in a repository, to turn on in the bar. */
export const sessionFilterIds = (config: Config, repo: string, ids: string[]): string[] =>
  filtersFor(config, repo)
    .filter((filter) => ids.includes(filter.id))
    .map((filter) => filter.id);

/** A pull request's minutes: its files in the session's filters, at the reader's pace, and a moment for the pull request. */
export const estimate = (
  files: PullFile[],
  matchers: Matcher[] | null,
  settings: ReviewTimeSettings,
  minutesOf: Estimator,
): Estimate => {
  const counted = files.filter(
    ([path, , , viewed]) =>
      (!matchers || matchers.some((matches) => matches(path))) && !(settings.unviewedOnly && viewed),
  );
  const reading = counted.reduce(
    (sum, [path, additions, deletions]) => sum + minutesOf(path, { additions, deletions }),
    0,
  );
  return { minutes: counted.length > 0 ? settings.perPull + reading : 0, files: counted.length };
};

/**
 * How long a whole pull request takes, from its files as last read, or `null` when they're from an older push or were
 * never read, or nothing's left to review.
 */
export const pullMinutes = (
  pull: PullRequest,
  record: FilesRecord | undefined,
  settings: ReviewTimeSettings,
  minutesOf: Estimator,
): number | null => {
  if (!record || !pull.headSha || record.sha !== pull.headSha) return null;
  const { minutes, files } = estimate(record.files, null, settings, minutesOf);
  return files ? minutes : null;
};

const among = (patterns: string[], repo: string) => patterns.some((pattern) => repoMatches(pattern, repo));

/** The pull requests a session is for, before knowing how long they take. */
export const candidates = (session: ReviewSession, pulls: PullRequest[]): PullRequest[] => {
  return pulls.filter(
    (pull) =>
      (session.drafts || !pull.draft) &&
      (session.repos.length === 0 || among(session.repos, pull.repo)) &&
      !among(session.excludeRepos, pull.repo),
  );
};

export interface Planned {
  pull: PullRequest;
  estimate: Estimate;
}

export interface Plan {
  picked: Planned[];
  /** Waiting too, but they didn't fit. */
  left: Planned[];
  /** Nothing in the session's filters, or nothing left unviewed. */
  nothing: PullRequest[];
  total: number;
  /** How much longer than the time set aside the plan takes, when even the one picked doesn't fit. */
  overBy: number;
}

const byAge = (a: Planned, b: Planned) =>
  (a.pull.createdAt || a.pull.updatedAt).localeCompare(b.pull.createdAt || b.pull.updatedAt);
const bySize = (a: Planned, b: Planned) => a.estimate.minutes - b.estimate.minutes || byAge(a, b);

/** The most minutes of review that fit in `budget`, and among those, the most pull requests: a small knapsack. */
const bestFill = (items: Planned[], budget: number): Planned[] => {
  const size = (item: Planned) => Math.max(1, Math.ceil(item.estimate.minutes));
  // best[m]: [minutes used, count, picks] within m minutes.
  let best: [number, number, Planned[]][] = Array.from({ length: budget + 1 }, () => [0, 0, []]);
  for (const item of items) {
    const next = best.map((cell) => cell);
    for (let room = size(item); room <= budget; room++) {
      const [used, count, picks] = best[room - size(item)]!;
      const candidate: [number, number, Planned[]] = [used + size(item), count + 1, [...picks, item]];
      const current = next[room]!;
      if (candidate[0] > current[0] || (candidate[0] === current[0] && candidate[1] > current[1]))
        next[room] = candidate;
    }
    best = next;
  }
  return best[budget]![2];
};

/**
 * Picks what fits in `minutes`: in the session's order, each that still fits, or the combination that fills the time
 * best. With `againFirst`, pull requests the reader was asked to review again go first, when they fit. With none that
 * fits, the first in order is picked anyway, and the plan says by how much it runs over.
 */
export const plan = (items: Planned[], minutes: number, order: Order, againFirst = false): Plan => {
  const counts = (item: Planned) => item.estimate.files > 0 || item.estimate.guessed === true;
  const nothing = items.filter((item) => !counts(item)).map((item) => item.pull);
  const sorted = items.filter((each) => counts(each)).toSorted(order === "oldest" ? byAge : bySize);
  const again = (item: Planned) => againFirst && item.pull.again === true;
  const first = sorted.filter((each) => again(each));
  const rest = sorted.filter((item) => !again(item));
  const ordered = [...first, ...rest];
  const fit = (list: Planned[], room: number): Planned[] => {
    if (order === "fill") return bestFill(list, room).toSorted(byAge);
    const fits: Planned[] = [];
    for (const item of list) {
      if (item.estimate.minutes > room) continue;
      fits.push(item);
      room -= item.estimate.minutes;
    }
    return fits;
  };
  const sum = (list: Planned[]) => list.reduce((total, item) => total + item.estimate.minutes, 0);
  const pickedFirst = fit(first, minutes);
  let picked = [...pickedFirst, ...fit(rest, Math.floor(minutes - sum(pickedFirst)))];
  if (picked.length === 0 && ordered[0]) picked = [ordered[0]];
  const total = sum(picked);
  const left = ordered.filter((item) => !picked.includes(item));
  return { picked, left, nothing, total, overBy: Math.max(0, Math.round(total) - minutes) };
};

/** A pull request picked for review time, as the popup lists it. */
export interface RunPull {
  url: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  minutes: number;
  /** `null` when its files couldn't be read, and the minutes are a guess. */
  files: number | null;
  /** The reader was asked to review it again. */
  again?: boolean;
}

/** A review time offered, and once started, under way. */
export interface ReviewRun {
  /** The session it's from, or empty for one started from the popup. */
  session: string;
  name: string;
  minutes: number;
  offeredAt: number;
  startedAt: number | null;
  pulls: RunPull[];
  /** Waiting too, but not picked: they didn't fit. */
  left: number;
  overBy: number;
  filters: string[];
}

export const runPulls = (picked: Planned[]): RunPull[] =>
  picked.map(({ pull, estimate: { minutes, files, guessed } }) => ({
    url: pull.url,
    repo: pull.repo,
    number: pull.number,
    title: pull.title,
    author: pull.author,
    minutes: Math.max(1, Math.round(minutes)),
    files: guessed ? null : files,
    ...(pull.again ? { again: true } : {}),
  }));

/** When a run's time is up: from its start, or for one only offered, when the offer lapses. */
export const runEndsAt = (run: ReviewRun): number => (run.startedAt ?? run.offeredAt) + run.minutes * 60_000;

/** Review times to start from, offered on the welcome page: a session's settings and the names to show it by. */
export interface ReviewPreset {
  id: string;
  session: Partial<ReviewSession>;
}

export const REVIEW_PRESETS: ReviewPreset[] = [
  { id: "twice", session: { times: ["10:00", "15:00"], minutes: 30, order: "oldest" } },
  { id: "every", session: { repeat: "every", every: 2, from: "09:00", to: "17:00", minutes: 15, order: "quickest" } },
  { id: "end", session: { times: ["17:00"], minutes: 45, order: "fill" } },
];

/** A preset as a session of the reader's own: its id says which, so the welcome page can tell it's on. */
export const presetSession = (preset: ReviewPreset, name: string): ReviewSession => ({
  ...newSession(name),
  ...preset.session,
  id: `preset-${preset.id}`,
});
