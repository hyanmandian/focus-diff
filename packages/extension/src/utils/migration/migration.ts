// Moving from the extension's own settings (before it ran the Mac app's screens) to the app's: its filters,
// notifications, popup lists and review times become the app's setup (config.json, utils/app-files), what it learned of
// the reader's pace becomes pace.json, and the pull requests marked done are kept to be taken off their queues once
// GitHub has listed them. What has no equivalent in the app is left behind, and named. It runs once, when the
// extension updates; a fresh install has nothing to move.
//
// Built here rather than with @focus-diff/app's config helpers: those name things in the page's language through the
// app's i18n, which needs a page (`document`), and this runs in the background. What's left out (the AI, actions, the
// default filters when there were none) the app's own normalize fills in when a page reads the file.

import { normalizeLearned } from "@focus-diff/core/estimate";

import { storage } from "#imports";
import { readAppFile, writeAppFile } from "@/utils/app-files/app-files";
import { tr } from "@/utils/words/words";

/** Pull requests marked done in the old popup, by url, with when each was last updated as it was marked. */
export type DoneMarks = Record<string, string>;

/** Where the done marks wait for the queues' first refresh. */
export const LEGACY_DONE = "local:legacy.done" as const;
/** Set once the old settings were looked at, so they're moved only once. */
export const MIGRATED = "local:migrated" as const;

/** Every key the old extension kept, which the move reads and then removes. `local:active` (the filters picked per
 *  repository) stays: the bar still reads it. */
export const OLD_KEYS = [
  "sync:config",
  "sync:appearance",
  "sync:notifications",
  "sync:popup",
  "sync:inboxDone",
  "sync:reviewTime",
  "local:inbox",
  "local:inboxMemory",
  "local:notificationLinks",
  "local:reviewRun",
  "local:pullFiles",
  "local:learnedPace",
  "local:heldNotifications",
  "local:reviewSkipUntil",
  "local:reviewQueueHistory",
  "local:update",
] as const;

/** What the old settings had that the app has no place for, by name. */
export type Dropped =
  | "repoFilters"
  | "excludeRepos"
  | "quietHours"
  | "delivery"
  | "themes"
  | "reviewFilters"
  | "reviewRepos"
  | "reviewPace"
  | "reviewOpens";

export interface Migration {
  /** Whether anything was moved: false when there was nothing old, or it was moved already. */
  migrated: boolean;
  /** What was left behind. */
  dropped: Dropped[];
}

// MARK: Reading what the old extension stored

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
const text = (value: unknown) => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const strings = (value: unknown) => list(value).filter((each): each is string => typeof each === "string");
const flag = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

/** The app's repository patterns: "owner/name" or "owner/*" (deeper paths, of other sites, don't fit). */
const isRepoPattern = (s: string) => /^[\w.-]+\/(?:[\w.-]+|\*)$/u.test(s);
/** The old repository fields, which took several in one, apart. */
const repos = (value: unknown) => [...new Set(strings(value).flatMap((each) => each.split(/[\s,]+/u)))].filter(Boolean);
const ID = /^[\w-]{1,64}$/u;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;

let counter = 0;
/** An id as the app makes them (config.ts newId). */
const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// MARK: Filters

type DiffFilter = { id: string; name: string; include: string; exclude: string; repos: string[] };

/** Every filter, everywhere or in its repository, with its id (the bar remembers the ones picked by it). */
const filtersOf = (value: unknown, dropped: Set<Dropped>): DiffFilter[] => {
  const config = asRecord(value);
  const seen = new Set<string>();
  const filter = (raw: unknown, where: string[]): DiffFilter[] => {
    const f = asRecord(raw);
    const name = text(f.name).trim();
    if (!name) return [];
    let id = ID.test(text(f.id)) ? text(f.id) : newId();
    while (seen.has(id)) id = newId();
    seen.add(id);
    return [{ id, name: name.slice(0, 24), include: text(f.include), exclude: text(f.exclude), repos: where }];
  };
  const global = list(config.global).flatMap((f) => filter(f, []));
  const own = list(config.repos).flatMap((raw) => {
    const entry = asRecord(raw);
    const repo = text(entry.repo).trim();
    const filters = list(entry.filters);
    if (!isRepoPattern(repo)) {
      if (filters.length > 0) dropped.add("repoFilters");
      return [];
    }
    return filters.flatMap((f) => filter(f, [repo]));
  });
  return [...global, ...own];
};

// MARK: Queues and their notifications

type EventKind = "new" | "rerequest" | "ready" | "comment" | "reply" | "approved" | "changes" | "mention";
type QueueKind = "review" | "involved" | "authored";
type LeaveOut = "drafts" | "approved" | "bots";

/** Each old kind of notification: the queues that now tell of it, with the events that do. */
const EVENTS: Record<string, Array<[QueueKind, EventKind[]]>> = {
  "review-requested": [["review", ["new", "rerequest"]]],
  "ready-for-review": [["review", ["ready"]]],
  "comment-reviewing": [["review", ["comment"]]],
  "comment-mine": [["authored", ["comment", "reply"]]],
  approved: [["authored", ["approved"]]],
  "changes-requested": [["authored", ["changes"]]],
  // Mentioned anywhere: on someone else's pull request, or on your own.
  mention: [
    ["involved", ["mention"]],
    ["authored", ["mention"]],
  ],
};

/** The old defaults, for an event the reader never changed. */
const DEFAULT_EVENTS: Record<string, { on: boolean; except: string[]; when: string }> = {
  "review-requested": { on: true, except: ["drafts"], when: "review" },
  "ready-for-review": { on: true, except: ["approved"], when: "review" },
  "comment-reviewing": { on: false, except: ["bots"], when: "now" },
  "comment-mine": { on: true, except: ["bots"], when: "now" },
  approved: { on: true, except: [], when: "now" },
  "changes-requested": { on: true, except: [], when: "now" },
  mention: { on: false, except: ["bots"], when: "now" },
};

type Queue = {
  id: string;
  name: string;
  tone: string;
  enabled: boolean;
  kind: QueueKind;
  repos: string[];
  teams: string[];
  directOnly: boolean;
  hideOnceReviewed: boolean;
  onlyNews: boolean;
  drafts: "show" | "hide";
  hideBots: boolean;
  excludeAuthors: string[];
  includeLabels: string[];
  excludeLabels: string[];
  includePaths: string;
  excludePaths: string;
  mergedDays: number;
  requestedOnly: boolean;
  skipIfI: "tookPart";
  skipApprovedBy: string[];
  skipMergedBy: string[];
  staleHours: number;
  query: string;
  notify: EventKind[];
  notifyAt: "now" | "review";
  notifyLeaveOut: LeaveOut[];
  notifyRepos: string[];
};

/** The app's three starting queues (config.ts TEMPLATES), named in the browser's language. */
const queue = (kind: QueueKind): Queue => ({
  id: newId(),
  name: { review: tr("Review", "Revisar"), involved: tr("Updates", "Novidades"), authored: tr("My PRs", "Meus PRs") }[
    kind
  ],
  tone: { review: "blue", involved: "purple", authored: "green" }[kind],
  enabled: true,
  kind,
  repos: [],
  teams: [],
  directOnly: false,
  hideOnceReviewed: true,
  onlyNews: false,
  drafts: kind === "review" ? "hide" : "show",
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
  staleHours: 24,
  query: "",
  notify: [],
  notifyAt: kind === "review" ? "review" : "now",
  notifyLeaveOut: [],
  notifyRepos: [],
});

const LEAVE_OUT: readonly LeaveOut[] = ["drafts", "approved", "bots"];

/** The queues, with what the old popup listed and what the old notifications said of each. */
const queuesOf = (notifications: unknown, popup: unknown, dropped: Set<Dropped>): Queue[] => {
  const queues = { review: queue("review"), involved: queue("involved"), authored: queue("authored") };
  const lists = asRecord(popup);
  const listed = repos(lists.repos).filter((repo) => isRepoPattern(repo));
  if (repos(lists.excludeRepos).length > 0) dropped.add("excludeRepos");
  for (const q of Object.values(queues)) q.repos = listed;
  // The review queue without the reviews asked of the reader's teams.
  queues.review.directOnly = lists.teams === false;

  const settings = asRecord(notifications);
  if (repos(settings.excludeRepos).length > 0) dropped.add("excludeRepos");
  if (asRecord(settings.quiet).on === true) dropped.add("quietHours");
  const delivery = asRecord(settings.delivery);
  if (delivery.grouped === true || delivery.sticky === true) dropped.add("delivery");
  const general = repos(settings.repos).filter((repo) => isRepoPattern(repo));
  const saved = asRecord(settings.events);
  const on = settings.enabled === true;
  // What each queue gathers from the old events that are on: their kinds, what they left out, whether they waited for
  // review time, and their own repositories (null where one had none, which takes the general ones).
  const gathered = new Map<
    QueueKind,
    { kinds: Set<EventKind>; leaveOut: Set<LeaveOut>; review: boolean; repos: string[] | null }
  >();
  for (const [kind, targets] of Object.entries(EVENTS)) {
    const event: Record<string, unknown> = isRecord(saved[kind]) ? saved[kind] : DEFAULT_EVENTS[kind]!;
    if (!on || event.on !== true) continue;
    const own = repos(event.repos).filter((repo) => isRepoPattern(repo));
    for (const [where, kinds] of targets) {
      const into = gathered.get(where) ?? { kinds: new Set(), leaveOut: new Set(), review: false, repos: [] };
      for (const k of kinds) into.kinds.add(k);
      const except = strings(event.except);
      for (const what of LEAVE_OUT) if (except.includes(what)) into.leaveOut.add(what);
      into.review ||= event.when === "review";
      into.repos = into.repos === null || own.length === 0 ? null : [...new Set([...into.repos, ...own])];
      gathered.set(where, into);
    }
  }
  for (const q of Object.values(queues)) {
    const into = gathered.get(q.kind);
    if (!into) continue;
    q.notify = [...into.kinds];
    q.notifyLeaveOut = LEAVE_OUT.filter((l) => into.leaveOut.has(l));
    q.notifyAt = into.review ? "review" : "now";
    q.notifyRepos = into.repos ?? general;
  }
  return [queues.review, queues.involved, queues.authored];
};

// MARK: Review time

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A session's start times: the ones set, or every few hours from one time to another, spelt out. */
const timesOf = (session: Record<string, unknown>): string[] => {
  if (session.repeat !== "every") return strings(session.times).filter((t) => TIME.test(t));
  const from = TIME.test(text(session.from)) ? toMinutes(text(session.from)) : 9 * 60;
  const to = TIME.test(text(session.to)) ? toMinutes(text(session.to)) : 18 * 60;
  const every = [1, 2, 3, 4].find((h) => h === session.every) ?? 2;
  const times: string[] = [];
  for (let at = from; at <= to; at += every * 60) times.push(toTime(at));
  return times;
};

const reviewTimeOf = (value: unknown, dropped: Set<Dropped>) => {
  const raw = asRecord(value);
  const ids = new Set<string>();
  const sessions = list(raw.sessions)
    .slice(0, 10)
    .map((each) => {
      const s = asRecord(each);
      if (strings(s.filters).length > 0) dropped.add("reviewFilters");
      if (repos(s.repos).length > 0 || repos(s.excludeRepos).length > 0) dropped.add("reviewRepos");
      let id = ID.test(text(s.id)) ? text(s.id) : newId();
      while (ids.has(id)) id = newId();
      ids.add(id);
      const minutes = Number(s.minutes);
      return {
        id,
        name: text(s.name).trim().slice(0, 40),
        on: flag(s.on, true),
        days: Array.isArray(s.days)
          ? [...new Set(s.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].toSorted(
              (a, b) => a - b,
            )
          : [1, 2, 3, 4, 5],
        times: [...new Set(timesOf(s))].toSorted().slice(0, 12),
        minutes: Number.isFinite(minutes) ? clamp(Math.round(minutes), 5, 240) : 30,
        order: (["oldest", "quickest", "fill"] as const).find((o) => o === s.order) ?? "oldest",
        queues: [],
        drafts: flag(s.drafts, false),
      };
    });
  if ((raw.pace !== undefined && raw.pace !== "steady") || (raw.perPull !== undefined && raw.perPull !== 0))
    dropped.add("reviewPace");
  if (raw.opens !== undefined && raw.opens !== "first") dropped.add("reviewOpens");
  return {
    enabled: flag(raw.enabled, false),
    sessions,
    againFirst: flag(raw.againFirst, true),
    remindEnd: flag(raw.remindEnd, true),
    skipEmpty: flag(raw.skipEmpty, true),
    holdWhileReviewing: flag(raw.holdWhileReviewing, false),
  };
};

// MARK: The setup

/** The old values, by key. */
export type OldSettings = Partial<Record<(typeof OLD_KEYS)[number], unknown>>;

/** The app's setup (config.json) from the old settings, and what was left behind. Pure, for the tests. */
/** The setup as moved: what the app's Config has, less what the app fills in itself (the AI, its default filters). */
export interface MovedConfig {
  version: 1;
  queues: Queue[];
  pollSeconds: number;
  sound: boolean;
  theme: "system";
  language: "system";
  actions: [];
  filters?: DiffFilter[];
  reviewTime: ReturnType<typeof reviewTimeOf>;
}

export const configFrom = (old: OldSettings): { config: MovedConfig; dropped: Dropped[] } => {
  const dropped = new Set<Dropped>();
  const notifications = asRecord(old["sync:notifications"]);
  const reviewTime = asRecord(old["sync:reviewTime"]);
  if (list(asRecord(old["sync:appearance"]).themes).length > 0) dropped.add("themes");
  const filters = filtersOf(old["sync:config"], dropped);
  const minutes = [2, 5, 10, 15, 30].find((m) => m === notifications.interval) ?? 2;
  // A sound for notifications, or for review time, unless the reader picked none.
  const sounds = (value: unknown, fallback: string) => (text(asRecord(value).id) || fallback) !== "none";
  const sound =
    (notifications.enabled === true && sounds(asRecord(notifications.delivery).sound, "chime")) ||
    (reviewTime.enabled === true && sounds(reviewTime.sound, "bowl"));
  const config: MovedConfig = {
    version: 1,
    queues: queuesOf(notifications, old["sync:popup"], dropped),
    pollSeconds: clamp(minutes * 60, 30, 900),
    sound,
    theme: "system",
    language: "system",
    actions: [],
    // None of the reader's own: the app's default filters, named in the page's language when it reads the file.
    ...(filters.length > 0 ? { filters } : {}),
    reviewTime: reviewTimeOf(reviewTime, dropped),
  };
  return { config, dropped: [...dropped] };
};

/** The pull requests to take off their queues as they were marked done: the ones not updated since. */
export const legacyDismissals = (
  done: DoneMarks,
  items: ReadonlyArray<{ queueId: string; pr: { id: string; url: string; updatedAt: string } }>,
): Array<[queueId: string, prId: string]> =>
  items.flatMap(({ queueId, pr }) => {
    const marked = Object.hasOwn(done, pr.url) ? done[pr.url] : undefined;
    return marked !== undefined && pr.updatedAt <= marked ? [[queueId, pr.id] as [string, string]] : [];
  });

/** The done marks as they were synced, only the ones that read. */
const doneOf = (value: unknown): DoneMarks =>
  Object.fromEntries(
    Object.entries(asRecord(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );

/**
 * Moves the old settings into the app's, once: the setup (unless there is one already), the pace learned (unless
 * there's one), the done marks for later. Then the old keys go. Resolves with whether anything was moved and what was
 * left behind.
 */
export const migrate = async (): Promise<Migration> => {
  if ((await storage.getItem<number>(MIGRATED)) !== null) return { migrated: false, dropped: [] };
  const values = await storage.getItems([...OLD_KEYS]);
  const old: OldSettings = Object.fromEntries(values.filter((v) => v.value !== null).map((v) => [v.key, v.value]));
  await storage.setItem(MIGRATED, 1);
  if (Object.keys(old).length === 0) return { migrated: false, dropped: [] };

  const { config, dropped } = configFrom(old);
  if ((await readAppFile("config")) === null) await writeAppFile("config", JSON.stringify(config, null, 2));
  if (old["local:learnedPace"] !== undefined && (await readAppFile("pace")) === null)
    await writeAppFile("pace", JSON.stringify(normalizeLearned(old["local:learnedPace"])));
  const done = doneOf(old["sync:inboxDone"]);
  if (Object.keys(done).length > 0) await storage.setItem(LEGACY_DONE, done);
  await storage.removeItems([...OLD_KEYS]);
  return { migrated: true, dropped };
};

/** The done marks moved, once: the background takes them after the queues' first refresh (legacyDismissals). */
export const takeLegacyDone = async (): Promise<DoneMarks | null> => {
  const done = await storage.getItem<DoneMarks>(LEGACY_DONE);
  if (done !== null) await storage.removeItem(LEGACY_DONE);
  return done;
};
