import { repoMatches } from "@focus-diff/core/repos";

import { REPO_PATTERN } from "@/utils/filters/filters";
import type { Activity, Detail, InboxProblem, PullRequest } from "@/utils/github-inbox/github-inbox";
import { asRecord, recordOf } from "@/utils/record/record";
import { normalizeSound, type SoundSetting } from "@/utils/sound/sound";

export type EventKind =
  | "review-requested"
  | "ready-for-review"
  | "comment-mine"
  | "comment-reviewing"
  | "mention"
  | "approved"
  | "changes-requested";

export type Exception = "drafts" | "approved" | "bots";

export const EVENT_KINDS: EventKind[] = [
  "review-requested",
  "ready-for-review",
  "comment-reviewing",
  "comment-mine",
  "approved",
  "changes-requested",
  "mention",
];

export const EXCEPTIONS: Record<EventKind, Exception[]> = {
  "review-requested": ["drafts", "approved"],
  "ready-for-review": ["approved"],
  "comment-mine": ["drafts", "bots"],
  "comment-reviewing": ["drafts", "approved", "bots"],
  mention: ["bots"],
  approved: ["bots"],
  "changes-requested": ["bots"],
};

export type When = "now" | "review";

interface EventSetting {
  on: boolean;
  except: Exception[];
  repos: string[];
  when: When;
}

export const INTERVALS = [2, 5, 10, 15, 30] as const;
type Interval = (typeof INTERVALS)[number];

interface QuietHours {
  on: boolean;
  from: string;
  to: string;
  weekends: boolean;
}

export interface Delivery {
  grouped: boolean;
  sticky: boolean;
  sound: SoundSetting;
}

export interface NotifySettings {
  enabled: boolean;
  repos: string[];
  excludeRepos: string[];
  events: Record<EventKind, EventSetting>;
  interval: Interval;
  quiet: QuietHours;
  delivery: Delivery;
}

const DEFAULT_EVENTS: Record<EventKind, EventSetting> = {
  "review-requested": { on: true, except: ["drafts"], repos: [], when: "review" },
  "ready-for-review": { on: true, except: ["approved"], repos: [], when: "review" },
  "comment-reviewing": { on: false, except: ["bots"], repos: [], when: "now" },
  "comment-mine": { on: true, except: ["bots"], repos: [], when: "now" },
  approved: { on: true, except: [], repos: [], when: "now" },
  "changes-requested": { on: true, except: [], repos: [], when: "now" },
  mention: { on: false, except: ["bots"], repos: [], when: "now" },
};

export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: false,
  repos: [],
  excludeRepos: [],
  events: DEFAULT_EVENTS,
  interval: 2,
  quiet: { on: false, from: "19:00", to: "09:00", weekends: true },
  delivery: { grouped: false, sticky: false, sound: { id: "chime", volume: 60 } },
};

export const splitRepos = (text: string): string[] => [...new Set(text.split(/[\s,]+/u).filter(Boolean))];

export const invalidRepos = (repos: string[]): string[] => repos.filter((repo) => !REPO_PATTERN.test(repo));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
export const isTime = (value: unknown): value is string => typeof value === "string" && TIME.test(value);
export const repoList = (value: unknown): string[] =>
  Array.isArray(value) ? splitRepos(value.filter((repo) => typeof repo === "string").join(" ")) : [];

export const normalizeNotify = (value: unknown): NotifySettings => {
  const raw = asRecord(value);
  const saved = asRecord(raw.events);
  const events = recordOf(EVENT_KINDS, (kind): EventSetting => {
    const setting = asRecord(saved[kind]);
    if (!saved[kind]) return { ...DEFAULT_EVENTS[kind] };
    const except = Array.isArray(setting.except)
      ? setting.except.filter((each): each is Exception => EXCEPTIONS[kind].some((known) => known === each))
      : [];
    const when = setting.when === "now" || setting.when === "review" ? setting.when : DEFAULT_EVENTS[kind].when;
    return { on: setting.on === true, except: [...new Set(except)], repos: repoList(setting.repos), when };
  });
  const quiet = asRecord(raw.quiet);
  const delivery = asRecord(raw.delivery);
  const defaults = DEFAULT_NOTIFY.quiet;
  return {
    enabled: raw.enabled === true,
    repos: repoList(raw.repos),
    excludeRepos: repoList(raw.excludeRepos),
    events,
    interval: INTERVALS.find((interval) => interval === raw.interval) ?? DEFAULT_NOTIFY.interval,
    quiet: {
      on: quiet.on === true,
      from: isTime(quiet.from) ? quiet.from : defaults.from,
      to: isTime(quiet.to) ? quiet.to : defaults.to,
      weekends: quiet.weekends === undefined ? defaults.weekends : quiet.weekends === true,
    },
    delivery: {
      grouped: delivery.grouped === true,
      sticky: delivery.sticky === true,
      sound: normalizeSound(
        delivery.sound,
        delivery.silent === true ? { id: "none", volume: 60 } : DEFAULT_NOTIFY.delivery.sound,
      ),
    },
  };
};

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export const isQuiet = ({ quiet }: NotifySettings, now: Date): boolean => {
  if (!quiet.on) return false;
  if (quiet.weekends && (now.getDay() === 0 || now.getDay() === 6)) return true;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  return from < to ? at >= from && at < to : from > to && (at >= from || at < to);
};

export const isWatching = (settings: NotifySettings): boolean =>
  settings.enabled && EVENT_KINDS.some((kind) => settings.events[kind].on);

export interface InboxEvent {
  kind: EventKind;
  repo: string;
  number: number;
  title: string;
  url: string;
  actor: string;
  bot: boolean;
  draft: boolean;
  approvedByMe: boolean;
  team: boolean;
  again: boolean;
  excerpt: string;
}

export interface HeldEvent extends InboxEvent {
  until: "review" | "end";
  heldAt: number;
}

const EXCLUDES: Record<Exception, (event: InboxEvent) => boolean> = {
  drafts: (event) => event.draft,
  approved: (event) => event.approvedByMe,
  bots: (event) => event.bot,
};

export const mayNotify = (settings: NotifySettings, kind: EventKind, repo: string): boolean => {
  const event = settings.events[kind];
  const repos = event.repos.length > 0 ? event.repos : settings.repos;
  const among = (patterns: string[]) => patterns.some((pattern) => repoMatches(pattern, repo));
  return event.on && (repos.length === 0 || among(repos)) && !among(settings.excludeRepos);
};

export const wants = (settings: NotifySettings, event: InboxEvent): boolean =>
  mayNotify(settings, event.kind, event.repo) &&
  !settings.events[event.kind].except.some((exception) => EXCLUDES[exception](event));

export const needsDetail = (settings: NotifySettings, kind: EventKind, repo: string): boolean =>
  mayNotify(settings, kind, repo) && settings.events[kind].except.includes("approved");

export const QUEUE_KINDS: EventKind[] = ["review-requested", "ready-for-review", "comment-reviewing"];

export interface InboxMemory {
  threads: Record<string, string>;
  reviews: PullRequest[];
}

export interface InboxSnapshot {
  me: string;
  reviews: PullRequest[];
  mine: PullRequest[];
  updates?: PullRequest[];
  merged?: PullRequest[];
  checkedAt: number;
  problem: InboxProblem | null;
}

export const reviewListEvents = (previous: PullRequest[] | null, current: PullRequest[]): InboxEvent[] => {
  if (!previous) return [];
  const before = new Map(previous.map((pull) => [pull.url, pull]));
  return current.flatMap((pull): InboxEvent[] => {
    const earlier = before.get(pull.url);
    const kind = earlier ? (earlier.draft && !pull.draft ? "ready-for-review" : null) : "review-requested";
    if (!kind) return [];
    return [
      {
        kind,
        repo: pull.repo,
        number: pull.number,
        title: pull.title,
        url: pull.url,
        actor: pull.author,
        bot: false,
        draft: pull.draft,
        approvedByMe: false,
        team: pull.team ?? false,
        again: false,
        excerpt: "",
      },
    ];
  });
};

export const freshActivity = (previous: Record<string, string> | null, current: Activity[]): Activity[] =>
  previous ? current.filter((activity) => activity.updatedAt > (previous[activity.thread] ?? "")) : [];

export const activityKind = (activity: Activity, review: Detail["review"]): EventKind | null => {
  if (activity.kind === "other") return null;
  if (activity.reason === "mention" || activity.reason === "team_mention") return "mention";
  if (activity.reason === "author" && review === "approved") return "approved";
  if (activity.reason === "author" && review === "changes-requested") return "changes-requested";
  if (activity.reason === "author") return "comment-mine";
  if (activity.reason === "review_requested") return "comment-reviewing";
  return null;
};

const MEMORY_LIMIT = 300;

export const rememberThreads = (
  activity: Activity[],
  previous: Record<string, string> | null,
): Record<string, string> => {
  const merged = { ...previous, ...Object.fromEntries(activity.map((each) => [each.thread, each.updatedAt])) };
  return Object.fromEntries(
    Object.entries(merged)
      .toSorted(([, a], [, b]) => b.localeCompare(a))
      .slice(0, MEMORY_LIMIT),
  );
};

export type DoneMarks = Record<string, string>;

export const isDone = (done: DoneMarks, pull: PullRequest): boolean => {
  const markedAt = done[pull.url];
  return markedAt !== undefined && pull.updatedAt <= markedAt;
};

export const markDone = (done: DoneMarks, pulls: PullRequest[]): DoneMarks => ({
  ...done,
  ...Object.fromEntries(pulls.map((pull) => [pull.url, pull.updatedAt])),
});

export const unmarkDone = (done: DoneMarks, pulls: PullRequest[]): DoneMarks => {
  const urls = new Set(pulls.map((pull) => pull.url));
  return Object.fromEntries(Object.entries(done).filter(([url]) => !urls.has(url)));
};

export interface PopupSettings {
  repos: string[];
  excludeRepos: string[];
  teams: boolean;
  updates: boolean;
  merged: boolean;
}

export const DEFAULT_POPUP: PopupSettings = { repos: [], excludeRepos: [], teams: true, updates: false, merged: false };

export const normalizePopup = (value: unknown): PopupSettings => {
  const raw = asRecord(value);
  return {
    repos: repoList(raw.repos),
    excludeRepos: repoList(raw.excludeRepos),
    teams: raw.teams !== false,
    updates: raw.updates === true,
    merged: raw.merged === true,
  };
};

export type PopupList = "reviews" | "mine" | "updates" | "merged";
export const POPUP_LISTS: PopupList[] = ["reviews", "mine", "updates", "merged"];

export const popupLists = (settings: PopupSettings): PopupList[] =>
  POPUP_LISTS.filter((list) => (list === "updates" || list === "merged" ? settings[list] : true));

export const inPopup = (settings: PopupSettings, pull: Pick<PullRequest, "repo" | "team">): boolean => {
  const among = (patterns: string[]) => patterns.some((pattern) => repoMatches(pattern, pull.repo));
  return (
    (settings.repos.length === 0 || among(settings.repos)) &&
    !among(settings.excludeRepos) &&
    (settings.teams || !pull.team)
  );
};

export type QueueHistory = Record<string, { left?: number; again?: number }>;

const HISTORY_MS = 90 * 86_400_000;

export const markAgain = (
  previous: PullRequest[] | null,
  current: PullRequest[],
  history: QueueHistory,
  now: number,
): { reviews: PullRequest[]; history: QueueHistory } => {
  const next: QueueHistory = Object.fromEntries(
    Object.entries(history).filter(([, entry]) => Math.max(entry.left ?? 0, entry.again ?? 0) > now - HISTORY_MS),
  );
  const urls = new Set(current.map((pull) => pull.url));
  const before = new Set(previous?.map((pull) => pull.url));
  for (const url of before) if (!urls.has(url)) next[url] = { left: now };
  const reviews = current.map((pull) => {
    const left = next[pull.url]?.left !== undefined;
    if (left && !before.has(pull.url)) next[pull.url] = { again: now };
    else if (left) delete next[pull.url];
    const again = next[pull.url]?.again !== undefined;
    return again === Boolean(pull.again) ? pull : { ...pull, again };
  });
  return { reviews, history: next };
};

export const pruneDone = (done: DoneMarks, pulls: PullRequest[]): DoneMarks => {
  const kept = new Set(pulls.filter((pull) => isDone(done, pull)).map((pull) => pull.url));
  return Object.fromEntries(Object.entries(done).filter(([url]) => kept.has(url)));
};

export type IgnoredMarks = Partial<Record<PopupList, string[]>>;

export const isIgnored = (ignored: IgnoredMarks, list: PopupList, pull: Pick<PullRequest, "url">): boolean =>
  ignored[list]?.includes(pull.url) ?? false;

export const ignore = (ignored: IgnoredMarks, list: PopupList, pull: Pick<PullRequest, "url">): IgnoredMarks => ({
  ...ignored,
  [list]: [...new Set([...(ignored[list] ?? []), pull.url])],
});

export const unignore = (ignored: IgnoredMarks, list: PopupList, pull: Pick<PullRequest, "url">): IgnoredMarks => ({
  ...ignored,
  [list]: (ignored[list] ?? []).filter((url) => url !== pull.url),
});

export const pruneIgnored = (ignored: IgnoredMarks, lists: Partial<Record<PopupList, PullRequest[]>>): IgnoredMarks =>
  Object.fromEntries(
    POPUP_LISTS.flatMap((list) => {
      const urls = new Set(lists[list]?.map((pull) => pull.url));
      const kept = (ignored[list] ?? []).filter((url) => urls.has(url));
      return kept.length > 0 ? [[list, kept]] : [];
    }),
  );
