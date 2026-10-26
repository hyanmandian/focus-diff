import type { Activity, Detail, InboxProblem, PullRequest } from '@/providers/github/inbox';
import { REPO_PATTERN, repoMatches } from '@/utils/filters/filters';
import { normalizeSound, type SoundSetting } from '@/utils/sound/sound';

/** Something on a pull request the reader can be told about. */
export type EventKind =
  | 'review-requested'
  | 'ready-for-review'
  | 'comment-mine'
  | 'comment-reviewing'
  | 'mention'
  | 'approved'
  | 'changes-requested';

/** What a rule can leave out. */
export type Exception = 'drafts' | 'approved' | 'bots';

export const EVENT_KINDS: EventKind[] = [
  'review-requested',
  'ready-for-review',
  'comment-reviewing',
  'comment-mine',
  'approved',
  'changes-requested',
  'mention',
];

/** The exceptions that mean something for each kind of event, in the order settings offer them. */
export const EXCEPTIONS: Record<EventKind, Exception[]> = {
  'review-requested': ['drafts', 'approved'],
  'ready-for-review': ['approved'],
  'comment-mine': ['drafts', 'bots'],
  'comment-reviewing': ['drafts', 'approved', 'bots'],
  mention: ['bots'],
  approved: ['bots'],
  'changes-requested': ['bots'],
};

/** Right away, or kept for the next review time, when the reader has review times set. */
export type When = 'now' | 'review';

/** Whether an event is wanted, and what to leave out of it. */
interface EventSetting {
  on: boolean;
  except: Exception[];
  /** The repositories this event is for, in place of the general ones; empty means the general ones. */
  repos: string[];
  when: When;
}

/** How often GitHub is read, in minutes. */
export const INTERVALS = [2, 5, 10, 15, 30] as const;
export type Interval = (typeof INTERVALS)[number];

/** Hours to keep quiet, like nights, and weekends too if asked; the lists still update, only nothing pops up. */
interface QuietHours {
  on: boolean;
  /** `HH:MM`, local time. A span past midnight, like 19:00 to 09:00, is fine. */
  from: string;
  to: string;
  weekends: boolean;
}

/** How a notification shows: one per event or one summing them up, which sound it makes, and until clicked. */
export interface Delivery {
  grouped: boolean;
  sticky: boolean;
  sound: SoundSetting;
}

/**
 * Notifications: on or off, the repositories they're for (all of them when empty) and the ones never, what to be told
 * about, how often to look, when to keep quiet, and how they show.
 */
export interface NotifySettings {
  enabled: boolean;
  repos: string[];
  excludeRepos: string[];
  events: Record<EventKind, EventSetting>;
  interval: Interval;
  quiet: QuietHours;
  delivery: Delivery;
}

/** What most reviewers want, to start from. */
const DEFAULT_EVENTS: Record<EventKind, EventSetting> = {
  'review-requested': { on: true, except: ['drafts'], repos: [], when: 'review' },
  'ready-for-review': { on: true, except: ['approved'], repos: [], when: 'review' },
  'comment-reviewing': { on: false, except: ['bots'], repos: [], when: 'now' },
  'comment-mine': { on: true, except: ['bots'], repos: [], when: 'now' },
  approved: { on: true, except: [], repos: [], when: 'now' },
  'changes-requested': { on: true, except: [], repos: [], when: 'now' },
  mention: { on: false, except: ['bots'], repos: [], when: 'now' },
};

export const DEFAULT_NOTIFY: NotifySettings = {
  enabled: false,
  repos: [],
  excludeRepos: [],
  events: DEFAULT_EVENTS,
  interval: 2,
  quiet: { on: false, from: '19:00', to: '09:00', weekends: true },
  delivery: { grouped: false, sticky: false, sound: { id: 'chime', volume: 60 } },
};

/** The repositories typed in one field, apart: `octo/web, octo/*` or one per line. */
export const splitRepos = (text: string): string[] => [...new Set(text.split(/[\s,]+/).filter(Boolean))];

/** The ones that don't read as a repository path. */
export const invalidRepos = (repos: string[]): string[] => repos.filter((repo) => !REPO_PATTERN.test(repo));

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});
export const repoList = (value: unknown): string[] =>
  Array.isArray(value) ? splitRepos(value.filter((repo) => typeof repo === 'string').join(' ')) : [];

export const normalizeNotify = (value: unknown): NotifySettings => {
  const raw = record(value);
  const saved = record(raw.events);
  const events = Object.fromEntries(
    EVENT_KINDS.map((kind): [EventKind, EventSetting] => {
      const setting = record(saved[kind]);
      if (!saved[kind]) return [kind, { ...DEFAULT_EVENTS[kind] }];
      const except = Array.isArray(setting.except) ? setting.except.filter((each) => EXCEPTIONS[kind].includes(each)) : [];
      const when = setting.when === 'now' || setting.when === 'review' ? setting.when : DEFAULT_EVENTS[kind].when;
      return [kind, { on: setting.on === true, except: [...new Set(except)], repos: repoList(setting.repos), when }];
    }),
  ) as Record<EventKind, EventSetting>;
  const quiet = record(raw.quiet);
  const delivery = record(raw.delivery);
  const defaults = DEFAULT_NOTIFY.quiet;
  return {
    enabled: raw.enabled === true,
    repos: repoList(raw.repos),
    excludeRepos: repoList(raw.excludeRepos),
    events,
    interval: INTERVALS.find((interval) => interval === raw.interval) ?? DEFAULT_NOTIFY.interval,
    quiet: {
      on: quiet.on === true,
      from: typeof quiet.from === 'string' && TIME.test(quiet.from) ? quiet.from : defaults.from,
      to: typeof quiet.to === 'string' && TIME.test(quiet.to) ? quiet.to : defaults.to,
      weekends: quiet.weekends === undefined ? defaults.weekends : quiet.weekends === true,
    },
    delivery: {
      grouped: delivery.grouped === true,
      sticky: delivery.sticky === true,
      // Before there were sounds to pick, there was only quiet or not.
      sound: normalizeSound(delivery.sound, delivery.silent === true ? { id: 'none', volume: 60 } : DEFAULT_NOTIFY.delivery.sound),
    },
  };
};

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Whether it's within the reader's quiet hours, or a weekend they keep quiet. */
export const isQuiet = ({ quiet }: NotifySettings, now: Date): boolean => {
  if (!quiet.on) return false;
  if (quiet.weekends && (now.getDay() === 0 || now.getDay() === 6)) return true;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(quiet.from);
  const to = minutes(quiet.to);
  // From 19:00 to 09:00 wraps past midnight; from 12:00 to 14:00 doesn't. Equal times keep no hours quiet.
  return from < to ? at >= from && at < to : from > to && (at >= from || at < to);
};

/** Whether a look should read the notifications inbox at all. */
export const isWatching = (settings: NotifySettings): boolean => settings.enabled && EVENT_KINDS.some((kind) => settings.events[kind].on);

export interface InboxEvent {
  kind: EventKind;
  repo: string;
  number: number;
  title: string;
  url: string;
  /** Who did it, when known. */
  actor: string;
  bot: boolean;
  draft: boolean;
  /** Whether the reader's latest review approved the pull request, when known. */
  approvedByMe: boolean;
  /** Whether the review was asked of one of the reader's teams and not of them, when known. */
  team: boolean;
  /** Back on the review queue after the reader reviewed it: asked to review it again. */
  again: boolean;
  /** The start of what a comment or review said, or empty. */
  excerpt: string;
}

/** An event kept for later: for the next review time, or for the end of the one under way. */
export interface HeldEvent extends InboxEvent {
  until: 'review' | 'end';
  /** When it was kept, to tell the ones a review time offered from the ones that came after. */
  heldAt: number;
}

const EXCLUDES: Record<Exception, (event: InboxEvent) => boolean> = {
  drafts: (event) => event.draft,
  approved: (event) => event.approvedByMe,
  bots: (event) => event.bot,
};
const excludes = (exception: Exception, event: InboxEvent) => EXCLUDES[exception](event);

/** Whether the reader wants this kind of event in this repository, before knowing who did it. */
export const mayNotify = (settings: NotifySettings, kind: EventKind, repo: string): boolean => {
  const event = settings.events[kind];
  // An event's own repositories take the general ones' place; the ones never wanted are left out of every event.
  const repos = event.repos.length ? event.repos : settings.repos;
  const among = (patterns: string[]) => patterns.some((pattern) => repoMatches(pattern, repo));
  return event.on && (!repos.length || among(repos)) && !among(settings.excludeRepos);
};

/** Whether the reader wants to be told about this event. */
export const wants = (settings: NotifySettings, event: InboxEvent): boolean =>
  mayNotify(settings, event.kind, event.repo) && !settings.events[event.kind].except.some((exception) => excludes(exception, event));

/** Whether working an event out takes a look at its pull request's page, to know if the reader approved it. */
export const needsDetail = (settings: NotifySettings, kind: EventKind, repo: string): boolean =>
  mayNotify(settings, kind, repo) && settings.events[kind].except.includes('approved');

/** The events about pull requests on the review queue, which follow it in leaving out the reviews asked of a team. */
export const QUEUE_KINDS: EventKind[] = ['review-requested', 'ready-for-review', 'comment-reviewing'];

/** What the background remembers between looks, to tell what's new. */
export interface InboxMemory {
  /** The latest update seen on each notification thread. */
  threads: Record<string, string>;
  /** The review list as of the last look, to tell a request that's new, or a draft that's now ready. */
  reviews: PullRequest[];
}

/** The reader's lists as the popup shows them. */
export interface InboxSnapshot {
  me: string;
  reviews: PullRequest[];
  mine: PullRequest[];
  checkedAt: number;
  problem: InboxProblem | null;
}

/** New review requests, and drafts on the list that are now ready. Nothing is new on the first look. */
export const reviewListEvents = (previous: PullRequest[] | null, current: PullRequest[]): InboxEvent[] => {
  if (!previous) return [];
  const before = new Map(previous.map((pull) => [pull.url, pull]));
  return current.flatMap((pull): InboxEvent[] => {
    const earlier = before.get(pull.url);
    const kind = !earlier ? 'review-requested' : earlier.draft && !pull.draft ? 'ready-for-review' : null;
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
        excerpt: '',
      },
    ];
  });
};

/** Threads with an event since the last look. Nothing is new on the first look, which only remembers where things stand. */
export const freshActivity = (previous: Record<string, string> | null, current: Activity[]): Activity[] =>
  previous
    ? current.filter(
        (activity) => previous[activity.thread] !== activity.updatedAt && activity.updatedAt > (previous[activity.thread] ?? ''),
      )
    : [];

/** What a thread's latest event was, for the reader: a comment or review on their own pull request, or on one they review. */
export const activityKind = (activity: Activity, review: Detail['review']): EventKind | null => {
  if (activity.kind === 'other') return null;
  if (activity.reason === 'mention' || activity.reason === 'team_mention') return 'mention';
  if (activity.reason === 'author' && review === 'approved') return 'approved';
  if (activity.reason === 'author' && review === 'changes-requested') return 'changes-requested';
  if (activity.reason === 'author') return 'comment-mine';
  if (activity.reason === 'review_requested') return 'comment-reviewing';
  return null;
};

/** The thread updates a notification inbox remembers, at most this many, the latest first. */
const MEMORY_LIMIT = 300;

export const rememberThreads = (activity: Activity[], previous: Record<string, string> | null): Record<string, string> => {
  const merged = { ...previous, ...Object.fromEntries(activity.map((each) => [each.thread, each.updatedAt])) };
  return Object.fromEntries(
    Object.entries(merged)
      .toSorted(([, a], [, b]) => b.localeCompare(a))
      .slice(0, MEMORY_LIMIT),
  );
};

/** Pull requests the reader marked done, each with when it was last updated as they marked it. */
export type DoneMarks = Record<string, string>;

/** Done until something happens on it: an update after the mark brings a pull request back. */
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

/** Which pull requests the popup lists, and counts on the icon. */
export interface PopupSettings {
  /** Only these repositories, as `owner/name` or `owner/*`; none for every repository. */
  repos: string[];
  /** Never these. */
  excludeRepos: string[];
  /** Whether the review queue lists the reviews asked of the reader's teams, and not only of them by name. */
  teams: boolean;
}

export const DEFAULT_POPUP: PopupSettings = { repos: [], excludeRepos: [], teams: true };

export const normalizePopup = (value: unknown): PopupSettings => {
  const raw = record(value);
  return { repos: repoList(raw.repos), excludeRepos: repoList(raw.excludeRepos), teams: raw.teams !== false };
};

/** Whether the popup lists a pull request: from the repositories picked, and not only a team's to review if left out. */
export const inPopup = (settings: PopupSettings, pull: Pick<PullRequest, 'repo' | 'team'>): boolean => {
  const among = (patterns: string[]) => patterns.some((pattern) => repoMatches(pattern, pull.repo));
  return (!settings.repos.length || among(settings.repos)) && !among(settings.excludeRepos) && (settings.teams || !pull.team);
};

/** When each pull request left the review queue, or came back to it after that: by its url, in ms. */
export type QueueHistory = Record<string, { left?: number; again?: number }>;

/** How long a pull request that left the review queue is remembered, for when it comes back. */
const HISTORY_MS = 90 * 86_400_000;

/**
 * Marks the pull requests back on the review queue after leaving it. GitHub takes one off once the reader reviews it,
 * so one back was asked to be reviewed again. `previous` is the last list read, or `null` when there's none to go by,
 * like on the first look, when nothing has left yet.
 */
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

/** Only the marks still hiding a pull request on the lists, so what's synced doesn't grow with every one ever marked. */
export const pruneDone = (done: DoneMarks, pulls: PullRequest[]): DoneMarks => {
  const kept = new Set(pulls.filter((pull) => isDone(done, pull)).map((pull) => pull.url));
  return Object.fromEntries(Object.entries(done).filter(([url]) => kept.has(url)));
};
