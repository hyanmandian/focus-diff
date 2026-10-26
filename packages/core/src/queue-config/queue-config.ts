/**
 * The part of the person's setup the queue engine reads: their queues, how often to look, sound, and review time.
 * The same rules as the desktop app's `src-tauri/src/config.rs`: anything missing falls back to the same defaults,
 * and a field of the wrong type fails the whole setup (the settings write it complete, so that's a broken file).
 * The desktop settings' `Queue` (src/utils/config/config.ts) is assignable to this one.
 */

import {
  attempt,
  choice,
  fields,
  flag,
  integer,
  list,
  nested,
  text,
  texts,
  U32,
  type Fields,
} from "../json-decode/json-decode";

/** What makes a pull request belong to a queue. */
export type QueueKind = "review" | "involved" | "authored" | "merged" | "custom";
export const QUEUE_KINDS: readonly QueueKind[] = ["review", "involved", "authored", "merged", "custom"];

/** Every kind of event the engine makes (desktop: `EVENT_KINDS` in src/utils/config/config.ts). */
export const EVENT_KINDS = [
  "new",
  "commits",
  "reply",
  "mention",
  "comment",
  "rerequest",
  "ready",
  "approved",
  "changes",
  "ci-failed",
  "ci-passed",
  "conflict",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type Drafts = "show" | "hide" | "only";
export type SkipIfI = "approved" | "reviewed" | "tookPart";
export type NotifyAt = "now" | "review";

export interface Queue {
  id: string;
  name: string;
  enabled: boolean;
  kind: QueueKind;
  /** "owner/name" or "owner/*". Empty: every repository you can see. */
  repos: readonly string[];
  /** Team slugs ("org/team") whose requests count as yours. Empty: all your teams. */
  teams: readonly string[];
  directOnly: boolean;
  hideOnceReviewed: boolean;
  onlyNews: boolean;
  drafts: Drafts;
  hideBots: boolean;
  excludeAuthors: readonly string[];
  includeLabels: readonly string[];
  excludeLabels: readonly string[];
  /** Regular expressions on file paths. Empty: any file. */
  includePaths: string;
  excludePaths: string;
  mergedDays: number;
  requestedOnly: boolean;
  skipIfI: SkipIfI;
  skipApprovedBy: readonly string[];
  skipMergedBy: readonly string[];
  query: string;
  /** What's worth a notification (event kinds). */
  notify: readonly string[];
  /** What to leave out of its notifications: "drafts", "bots", "approved" (ones you approved). */
  notifyLeaveOut: readonly string[];
  /** Notifications only from these repositories ("owner/name" or "owner/*"); empty: all of the queue's. */
  notifyRepos: readonly string[];
  /** Right away, or kept for the next review time. Null: review queues wait, others don't. */
  notifyAt: NotifyAt | null;
}

export type Order = "oldest" | "quickest" | "fill";

/** A time set aside to review, like weekdays at 15:00 for half an hour. */
export interface Session {
  id: string;
  name: string;
  on: boolean;
  /** Days of the week, 0 for Sunday. */
  days: readonly number[];
  /** "HH:MM", local time. */
  times: readonly string[];
  minutes: number;
  order: Order;
  queues: readonly string[];
  drafts: boolean;
}

export interface ReviewTime {
  enabled: boolean;
  sessions: readonly Session[];
  againFirst: boolean;
  remindEnd: boolean;
  skipEmpty: boolean;
  /** While reviewing, every notification waits for the time to be up. */
  holdWhileReviewing: boolean;
}

export interface Config {
  queues: readonly Queue[];
  pollSeconds: number;
  sound: boolean;
  reviewTime: ReviewTime;
}

/** A queue with every setting it leaves out at its default (`Queue::default` in config.rs). */
export const queueWith = (settings: Partial<Queue>): Queue => ({
  id: "",
  name: "Queue",
  enabled: true,
  kind: "custom",
  repos: [],
  teams: [],
  directOnly: false,
  hideOnceReviewed: true,
  onlyNews: false,
  drafts: "hide",
  hideBots: true,
  excludeAuthors: [],
  includeLabels: [],
  excludeLabels: [],
  includePaths: "",
  excludePaths: "",
  mergedDays: 7,
  requestedOnly: false,
  skipIfI: "tookPart",
  skipApprovedBy: [],
  skipMergedBy: [],
  query: "",
  notify: [],
  notifyLeaveOut: [],
  notifyRepos: [],
  notifyAt: null,
  ...settings,
});

/** Path filters can only be checked against the files GitHub lists. */
export const needsFiles = (queue: Queue): boolean => queue.includePaths !== "" || queue.excludePaths !== "";

/** Whether its notifications wait for review time (when there is one to wait for). */
export const waitsForReview = (queue: Queue): boolean =>
  (queue.notifyAt ?? (queue.kind === "review" ? "review" : "now")) === "review";

export const leavesOut = (queue: Queue, what: string): boolean => queue.notifyLeaveOut.includes(what);

export const enabledQueues = (config: Config): Queue[] => config.queues.filter((queue) => queue.enabled);

/** "HH:MM" as minutes after midnight (review.rs `minutes_of`). */
export const minutesOf = (time: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/u.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
};

/** Whether any review time is coming at all (review.rs `is_scheduled`). */
export const isScheduled = (settings: ReviewTime): boolean =>
  settings.enabled &&
  settings.sessions.some((s) => s.on && s.days.length > 0 && s.times.some((t) => minutesOf(t) !== null));

const readQueue = (value: unknown): Queue => {
  const o = fields(value);
  const defaults = queueWith({});
  const notifyAt = o.notifyAt;
  return {
    id: text(o, "id"),
    name: o.name === undefined ? defaults.name : text(o, "name"),
    enabled: flag(o, "enabled", defaults.enabled),
    kind: choice(o, "kind", QUEUE_KINDS, "custom"),
    repos: texts(o, "repos"),
    teams: texts(o, "teams"),
    directOnly: flag(o, "directOnly"),
    hideOnceReviewed: flag(o, "hideOnceReviewed", defaults.hideOnceReviewed),
    onlyNews: flag(o, "onlyNews"),
    drafts: choice(o, "drafts", ["show", "only", "hide"], "hide"),
    hideBots: flag(o, "hideBots", defaults.hideBots),
    excludeAuthors: texts(o, "excludeAuthors"),
    includeLabels: texts(o, "includeLabels"),
    excludeLabels: texts(o, "excludeLabels"),
    includePaths: text(o, "includePaths"),
    excludePaths: text(o, "excludePaths"),
    mergedDays: integer(o, "mergedDays", { fallback: defaults.mergedDays, min: 0, max: U32 }),
    requestedOnly: flag(o, "requestedOnly"),
    skipIfI: choice(o, "skipIfI", ["approved", "reviewed", "tookPart"], "tookPart"),
    skipApprovedBy: texts(o, "skipApprovedBy"),
    skipMergedBy: texts(o, "skipMergedBy"),
    query: text(o, "query"),
    notify: texts(o, "notify"),
    notifyLeaveOut: texts(o, "notifyLeaveOut"),
    notifyRepos: texts(o, "notifyRepos"),
    notifyAt:
      notifyAt === undefined || notifyAt === null ? null : choice<NotifyAt>(o, "notifyAt", ["review", "now"], "now"),
  };
};

const readSession = (value: unknown): Session => {
  const o = fields(value);
  return {
    id: text(o, "id"),
    name: text(o, "name"),
    on: flag(o, "on", true),
    days: o.days === undefined ? [1, 2, 3, 4, 5] : list(o, "days", (d) => integer({ d }, "d", { min: 0, max: 255 })),
    times: o.times === undefined ? ["15:00"] : texts(o, "times"),
    minutes: integer(o, "minutes", { fallback: 30, min: 0, max: U32 }),
    order: choice(o, "order", ["quickest", "fill", "oldest"], "oldest"),
    queues: texts(o, "queues"),
    drafts: flag(o, "drafts"),
  };
};

const readReviewTime = (value: unknown): ReviewTime => {
  const o = fields(value);
  return {
    enabled: flag(o, "enabled"),
    sessions: list(o, "sessions", readSession),
    againFirst: flag(o, "againFirst", true),
    remindEnd: flag(o, "remindEnd", true),
    skipEmpty: flag(o, "skipEmpty", true),
    holdWhileReviewing: flag(o, "holdWhileReviewing"),
  };
};

const defaultReviewTime = (): ReviewTime => readReviewTime({});

const clamp = (n: number, low: number, high: number): number => Math.min(Math.max(n, low), high);

/**
 * The setup from config.json's contents (`Config::parse`): null when it isn't one. How often to look is kept within
 * 30 seconds and 15 minutes, queues need an id, and review times keep only the days and times that make sense.
 */
export const parseConfig = (value: unknown): Config | null =>
  attempt(() => {
    const o: Fields = fields(value);
    const reviewTime = nested(o, "reviewTime", readReviewTime, defaultReviewTime);
    return {
      queues: list(o, "queues", readQueue).filter((queue) => queue.id !== ""),
      pollSeconds: clamp(integer(o, "pollSeconds", { fallback: 60, min: 0 }), 30, 900),
      sound: flag(o, "sound"),
      reviewTime: {
        ...reviewTime,
        sessions: reviewTime.sessions.map((session) => ({
          ...session,
          minutes: clamp(session.minutes, 5, 240),
          days: session.days.filter((day) => day <= 6),
          times: session.times.filter((time) => minutesOf(time) !== null),
        })),
      },
    };
  });
