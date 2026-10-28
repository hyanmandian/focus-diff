import type { Estimator } from "@focus-diff/core/estimate";
import { toMatcher, type Matcher } from "@focus-diff/core/filters";
import { repoMatches } from "@focus-diff/core/repos";

import { filtersFor, newId, type Config } from "@/utils/filters/filters";
import type { PullRequest } from "@/utils/github-inbox/github-inbox";
import { isTime, repoList } from "@/utils/inbox/inbox";
import { asRecord, keysOf, oneOf } from "@/utils/record/record";
import { PACES, type Pace } from "@/utils/review-time/review-time";
import { normalizeSound, type SoundSetting } from "@/utils/sound/sound";

export type Order = "oldest" | "quickest" | "fill";
export const ORDERS: Order[] = ["oldest", "quickest", "fill"];

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
  days: number[];
  repeat: Repeat;
  times: string[];
  every: number;
  from: string;
  to: string;
  minutes: number;
  order: Order;
  filters: string[];
  repos: string[];
  excludeRepos: string[];
  drafts: boolean;
}

export const OPENS = ["first", "all", "none"] as const;
export type Opens = (typeof OPENS)[number];

export interface ReviewTimeSettings {
  enabled: boolean;
  sessions: ReviewSession[];
  pace: Pace;
  learn: boolean;
  perPull: number;
  unviewedOnly: boolean;
  againFirst: boolean;
  queueEstimates: boolean;
  opens: Opens;
  applyFilters: boolean;
  snooze: number;
  remindEnd: boolean;
  skipEmpty: boolean;
  holdWhileReviewing: boolean;
  sound: SoundSetting;
}

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

const time = (value: unknown, fallback: string) => (isTime(value) ? value : fallback);
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

const normalizeSession = (value: unknown): ReviewSession => {
  const raw = asRecord(value);
  const base = newSession();
  const days = Array.isArray(raw.days)
    ? raw.days.filter((day): day is number => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
    : base.days;
  const times = Array.isArray(raw.times) ? raw.times.filter(isTime) : base.times;
  const minutes = Number(raw.minutes);
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : base.id,
    name: typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "",
    on: flag(raw.on, true),
    days: [...new Set(days)].toSorted((a, b) => a - b),
    repeat: oneOf(["times", "every"] as const, raw.repeat, base.repeat),
    times: [...new Set(times)].toSorted().slice(0, MAX_TIMES),
    every: oneOf(EVERY_HOURS, raw.every, base.every),
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

export const isScheduled = (settings: ReviewTimeSettings): boolean =>
  settings.enabled &&
  settings.sessions.some((session) => session.on && session.days.length > 0 && startsOf(session).length > 0);

const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));

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

export type PullFile = [path: string, additions: number, deletions: number, viewed: boolean];

export interface FilesRecord {
  sha: string;
  files: PullFile[];
  readAt?: number;
}

export interface Estimate {
  minutes: number;
  files: number;
  guessed?: boolean;
}

const sessionFilters = (config: Config, repo: string, ids: string[]) =>
  filtersFor(config, repo).filter((filter) => ids.includes(filter.id));

export const sessionMatchers = (config: Config, repo: string, ids: string[]): Matcher[] | null => {
  if (ids.length === 0) return null;
  const matchers = sessionFilters(config, repo, ids).flatMap((filter) => toMatcher(filter) ?? []);
  return matchers.length > 0 ? matchers : null;
};

export const sessionFilterIds = (config: Config, repo: string, ids: string[]): string[] =>
  sessionFilters(config, repo, ids).map((filter) => filter.id);

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
  left: Planned[];
  nothing: PullRequest[];
  total: number;
  overBy: number;
}

const byAge = (a: Planned, b: Planned) =>
  (a.pull.createdAt || a.pull.updatedAt).localeCompare(b.pull.createdAt || b.pull.updatedAt);
const bySize = (a: Planned, b: Planned) => a.estimate.minutes - b.estimate.minutes || byAge(a, b);

const bestFill = (items: Planned[], budget: number): Planned[] => {
  const size = (item: Planned) => Math.max(1, Math.ceil(item.estimate.minutes));
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

export const plan = (items: Planned[], minutes: number, order: Order, againFirst = false): Plan => {
  const counts = (item: Planned) => item.estimate.files > 0 || item.estimate.guessed === true;
  const nothing = items.filter((item) => !counts(item)).map((item) => item.pull);
  const sorted = items.filter((each) => counts(each)).toSorted(order === "oldest" ? byAge : bySize);
  const again = (item: Planned) => againFirst && item.pull.again === true;
  const first = sorted.filter((each) => again(each));
  const rest = sorted.filter((item) => !again(item));
  const ordered = [...first, ...rest];
  const fit = (list: Planned[], room: number): Planned[] => {
    if (order === "fill") return bestFill(list, Math.floor(room)).toSorted(byAge);
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
  let picked = [...pickedFirst, ...fit(rest, minutes - sum(pickedFirst))];
  if (picked.length === 0 && ordered[0]) picked = [ordered[0]];
  const total = sum(picked);
  const left = ordered.filter((item) => !picked.includes(item));
  return { picked, left, nothing, total, overBy: Math.max(0, Math.round(total) - minutes) };
};

export interface RunPull {
  url: string;
  repo: string;
  number: number;
  title: string;
  author: string;
  minutes: number;
  files: number | null;
  again?: boolean;
}

export interface ReviewRun {
  session: string;
  name: string;
  minutes: number;
  offeredAt: number;
  startedAt: number | null;
  pulls: RunPull[];
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

export const runEndsAt = (run: ReviewRun): number => (run.startedAt ?? run.offeredAt) + run.minutes * 60_000;

export const minutesLeft = (run: ReviewRun): number => Math.max(0, Math.ceil((runEndsAt(run) - Date.now()) / 60_000));

export interface ReviewPreset {
  id: string;
  session: Partial<ReviewSession>;
}

export const REVIEW_PRESETS: ReviewPreset[] = [
  { id: "twice", session: { times: ["10:00", "15:00"], minutes: 30, order: "oldest" } },
  { id: "every", session: { repeat: "every", every: 2, from: "09:00", to: "17:00", minutes: 15, order: "quickest" } },
  { id: "end", session: { times: ["17:00"], minutes: 45, order: "fill" } },
];

export const presetSession = (preset: ReviewPreset, name: string): ReviewSession => ({
  ...newSession(name),
  ...preset.session,
  id: `preset-${preset.id}`,
});
