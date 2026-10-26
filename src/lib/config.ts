// The person's setup: their queues and preferences, kept in config.json in the app's config folder.
// Everything read from disk goes through `normalize`, so a hand-edited or older file can't break the
// app: unknown fields are dropped, missing ones get defaults.

import { bridge } from "./bridge";

/** What makes a pull request belong to a queue. */
export type QueueKind =
  | "review" //    your review is requested (you, or a team of yours)
  | "involved" //  you reviewed, commented or were mentioned; not yours
  | "authored" //  yours
  | "merged" //    merged lately, not yours, that you took no part in
  | "custom"; //   a GitHub search of your own

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

/** What a queue's notifications can leave out: drafts, what bots do, pull requests you approved. */
export const LEAVE_OUT = ["drafts", "bots", "approved"] as const;
export type LeaveOut = (typeof LEAVE_OUT)[number];

export const TONES = ["blue", "purple", "green", "amber", "red", "gray"] as const;
export type Tone = (typeof TONES)[number];

export type Queue = {
  id: string;
  name: string;
  tone: Tone;
  enabled: boolean;
  kind: QueueKind;
  /** "owner/name" or "owner/*". Empty: every repository you can see. */
  repos: string[];
  /** review: team slugs ("org/team") whose requests count as yours. Empty: all your teams. */
  teams: string[];
  /** review: only requests made to you, not to a team. */
  directOnly: boolean;
  /** review: drop a pull request once you've reviewed or commented on it. */
  hideOnceReviewed: boolean;
  /** involved: only pull requests with something new since your last word. */
  onlyNews: boolean;
  drafts: "show" | "hide" | "only";
  hideBots: boolean;
  excludeAuthors: string[];
  includeLabels: string[];
  excludeLabels: string[];
  /** Regular expressions on file paths, like Focus Diff's filters. Empty: any file. */
  includePaths: string;
  excludePaths: string;
  /** merged: how far back. */
  mergedDays: number;
  /** merged: only those your review was asked on, directly or through a team (see `teams`). */
  requestedOnly: boolean;
  /** merged: what you did that keeps a pull request out. */
  skipIfI: "approved" | "reviewed" | "tookPart";
  /** Leave out pull requests one of these people approved. */
  skipApprovedBy: string[];
  /** merged: leave out pull requests one of these people merged. */
  skipMergedBy: string[];
  /** review: hours waiting on you before a pull request is called out as waiting long. 0: never. */
  staleHours: number;
  /** custom: GitHub search qualifiers, e.g. "repo:acme/web label:urgent". */
  query: string;
  /** What's worth a notification. */
  notify: EventKind[];
  /** Right away, or kept for the next review time (right away when there's none coming). */
  notifyAt: "now" | "review";
  /** What to leave out of its notifications. */
  notifyLeaveOut: LeaveOut[];
  /** Notifications only from these repositories ("owner/name" or "owner/*"). Empty: all of the queue's. */
  notifyRepos: string[];
};

/** Which of the pull requests that fit a review time go first. */
export const REVIEW_ORDERS = ["oldest", "quickest", "fill"] as const;
export type ReviewOrder = (typeof REVIEW_ORDERS)[number];

/** A time set aside to review, like weekdays at 15:00 for half an hour (review.rs runs it). */
export type ReviewSession = {
  id: string;
  name: string;
  on: boolean;
  /** Days of the week, 0 for Sunday. */
  days: number[];
  /** "HH:MM", local time. */
  times: string[];
  minutes: number;
  order: ReviewOrder;
  /** The queues it picks from, by id. Empty: every review queue. */
  queues: string[];
  drafts: boolean;
};

export type ReviewTime = {
  enabled: boolean;
  sessions: ReviewSession[];
  /** Pull requests you were asked to review again go first, when they fit. */
  againFirst: boolean;
  /** A notification when the time's up, saying how far it got. */
  remindEnd: boolean;
  /** With nothing to review, the time passes without a word. */
  skipEmpty: boolean;
  /** While reviewing, every notification waits for the time to be up. */
  holdWhileReviewing: boolean;
};

export const AI_PROVIDERS = ["claude", "cursor"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** Something to ask the AI about a pull request, offered as a button by it. */
export type Prompt = { id: string; name: string; prompt: string };

/** One thing an action does. Text and links can use {number} {title} {url} {repo} {author} {me};
 *  commands get them as environment variables instead (PR_NUMBER, PR_TITLE, …). */
export type ActionStep =
  | { kind: "comment"; body: string }
  | { kind: "request"; reviewers: string[] } // "username" or "org/team"
  | { kind: "unrequestMe" }
  | { kind: "label"; labels: string[] }
  | { kind: "open"; url: string }
  | { kind: "run"; command: string };

export const STEP_KINDS = ["comment", "request", "unrequestMe", "label", "open", "run"] as const satisfies ReadonlyArray<ActionStep["kind"]>;

/** A button of the person's own on a pull request: its steps run in order, stopping at a failure. */
export type Action = {
  id: string;
  name: string;
  /** Ask before running. */
  confirm: boolean;
  steps: ActionStep[];
};

/** A part of a pull request to review on its own: the files whose paths match `include` and not
 *  `exclude` (regular expressions; empty matches all, or none). Like Focus Diff's filters.
 *  `repos`: "owner/name" or "owner/*" it's offered in. Empty: every repository. */
export type DiffFilter = { id: string; name: string; include: string; exclude: string; repos: string[] };

export type Config = {
  version: 1;
  queues: Queue[];
  pollSeconds: number;
  sound: boolean;
  theme: "system" | "light" | "dark";
  /** Optional: the coding agent CLI to ask, on the person's own subscription. */
  ai: {
    provider: AiProvider | null;
    /** Empty: the CLI's own default. */
    model: string;
    effort: Effort | "";
    /** The person's own review guidelines, added to every question. */
    instructions: string;
    prompts: Prompt[];
    /** Let it read the pull request's whole project (checked out in the app's cache), not just the diff. */
    project: boolean;
    /** The AI review: comments on the diff's lines, to add to your review or dismiss. */
    review: { auto: boolean; prompt: string };
  };
  actions: Action[];
  /** The diff's filters, offered as chips in the review window. */
  filters: DiffFilter[];
  /** Times set aside to review. */
  reviewTime: ReviewTime;
};

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const base = (): Omit<Queue, "id" | "name" | "kind" | "tone" | "notify" | "notifyAt"> => ({
  enabled: true,
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
  staleHours: 24,
  query: "",
  notifyLeaveOut: [],
  notifyRepos: [],
});

/** Starting points, offered when adding a queue. They're ordinary queues once added. */
export const TEMPLATES: Record<QueueKind, { name: string; description: string; make: () => Queue }> = {
  review: {
    name: "Needs my review",
    description: "Open pull requests waiting on your review, until you've reviewed or commented.",
    make: () => ({ ...base(), id: newId(), name: "Review", kind: "review", tone: "blue", notify: ["new", "rerequest", "ready"], notifyAt: "review" }),
  },
  involved: {
    name: "Updates",
    description: "Pull requests you reviewed, commented on or were mentioned in, and what happened since.",
    make: () => ({
      ...base(),
      id: newId(),
      name: "Updates",
      kind: "involved",
      tone: "purple",
      drafts: "show",
      notify: ["commits", "reply", "mention", "rerequest"],
      notifyAt: "now",
    }),
  },
  authored: {
    name: "My pull requests",
    description: "Your open pull requests, drafts too: reviews, comments, CI and conflicts.",
    make: () => ({
      ...base(),
      id: newId(),
      name: "My PRs",
      kind: "authored",
      tone: "green",
      drafts: "show",
      notify: ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"],
      notifyAt: "now",
    }),
  },
  merged: {
    name: "Merged without me",
    description: "Pull requests merged lately without your approval: the ones asked of you or your team, in the files you care about.",
    make: () => ({ ...base(), id: newId(), name: "Merged", kind: "merged", tone: "gray", drafts: "show", requestedOnly: true, skipIfI: "approved", notify: [], notifyAt: "now" }),
  },
  custom: {
    name: "Custom search",
    description: "Any GitHub search: a team's repository, a label, an author.",
    make: () => ({
      ...base(),
      id: newId(),
      name: "Search",
      kind: "custom",
      tone: "amber",
      drafts: "show",
      query: "is:open",
      notify: ["new"],
      notifyAt: "now",
    }),
  },
};

export const defaultConfig = (): Config => ({
  version: 1,
  queues: [TEMPLATES.review.make(), TEMPLATES.involved.make(), TEMPLATES.authored.make()],
  pollSeconds: 60,
  sound: false,
  theme: "system",
  ai: { provider: null, model: "", effort: "", instructions: "", prompts: defaultPrompts(), project: true, review: { auto: false, prompt: REVIEW_PROMPT } },
  actions: [],
  filters: defaultFilters(),
  reviewTime: defaultReviewTime(),
});

export const defaultReviewTime = (): ReviewTime => ({ enabled: false, sessions: [], againFirst: true, remindEnd: true, skipEmpty: true, holdWhileReviewing: false });

const WEEKDAYS = [1, 2, 3, 4, 5];

export const newSession = (): ReviewSession => ({ id: newId(), name: "", on: true, days: WEEKDAYS, times: ["15:00"], minutes: 30, order: "oldest", queues: [], drafts: false });

export const REVIEW_MINUTES = [15, 30, 45, 60, 90, 120] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const validTime = (v: string) => TIME.test(v);
const toMinutes = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));

/** The next review time strictly after `after`, in this computer's time zone, looking a week ahead. */
export function nextReviewTime(review: ReviewTime, after: Date): { session: ReviewSession; at: Date } | null {
  if (!review.enabled) return null;
  let best: { session: ReviewSession; at: Date } | null = null;
  for (let offset = 0; offset <= 7 && !best; offset++) {
    const day = new Date(after.getFullYear(), after.getMonth(), after.getDate() + offset);
    for (const session of review.sessions) {
      if (!session.on || !session.days.includes(day.getDay())) continue;
      for (const time of session.times) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, toMinutes(time));
        if (at > after && (!best || at < best.at)) best = { session, at };
      }
    }
  }
  return best;
}

/** Starting points for filters, from Focus Diff's recipes. */
export const FILTER_RECIPES: Array<{ title: string; description: string; filters: Array<Omit<DiffFilter, "id" | "repos">> }> = [
  {
    title: "Frontend and backend",
    description: "Review each side of a full-stack change on its own.",
    filters: [
      { name: "Frontend", include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$", exclude: "\\.(test|spec|stories)\\." },
      { name: "Backend", include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$", exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\." },
    ],
  },
  {
    title: "Code, then tests",
    description: "The change first, its tests after.",
    filters: [
      { name: "Code", include: "", exclude: "\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/" },
      { name: "Tests", include: "\\.(test|spec)\\.|(^|/)(tests?|__tests__)/", exclude: "" },
    ],
  },
  {
    title: "Without generated files",
    description: "Lockfiles, snapshots, builds and generated code left out.",
    filters: [
      {
        name: "No generated",
        include: "",
        exclude: "(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|poetry\\.lock|go\\.sum)$|\\.snap$|\\.min\\.(js|css)$|(^|/)(dist|build|generated|__generated__)/",
      },
    ],
  },
  { title: "One area", description: "A folder you own, like a team's package.", filters: [{ name: "Payments", include: "^(apps|packages|services)/payments/", exclude: "" }] },
  {
    title: "Infrastructure",
    description: "CI, Docker, Terraform, Kubernetes.",
    filters: [{ name: "Infra", include: "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$", exclude: "" }],
  },
  { title: "Database", description: "Migrations and schemas.", filters: [{ name: "Database", include: "(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$", exclude: "" }] },
  { title: "Docs", description: "Markdown and documentation.", filters: [{ name: "Docs", include: "\\.(mdx?|rst|txt)$|(^|/)docs/", exclude: "" }] },
];

/** Fixed ids: until the person changes them, the defaults are made again each time the file is
 *  read, and the review window remembers a repository's filter by id. */
export function defaultFilters(): DiffFilter[] {
  return [...FILTER_RECIPES[0]!.filters, ...FILTER_RECIPES[2]!.filters].map((f) => ({ ...f, id: f.name.toLowerCase().replace(/\W+/g, "-"), repos: [] }));
}

/** Whether a file is in a filter. Case doesn't matter, as in Focus Diff, so a filter shared between
 *  the two keeps the same files. */
export function inFilter(filter: Pick<DiffFilter, "include" | "exclude">, path: string): boolean {
  try {
    return (!filter.include || new RegExp(filter.include, "i").test(path)) && !(filter.exclude && new RegExp(filter.exclude, "i").test(path));
  } catch {
    return true;
  }
}

export const REVIEW_PROMPT = `Review it like a careful senior engineer. Comment only on what matters: bugs, unhandled edge cases, callers or features this change breaks, security or data risks, performance traps, missing tests for risky logic. No praise, no style nitpicks, no comments on what's fine.`;

export function defaultPrompts(): Prompt[] {
  return [
    {
      id: "summary",
      name: "Summary",
      prompt: `From its description and diff, write:
1. What it changes, in two or three plain sentences.
2. "Worth a closer look:" then up to five short points: risks, edge cases, missing tests, or anything surprising, each naming the file.
Be concrete and brief. Don't repeat the description back.`,
    },
    {
      id: "risks",
      name: "Find problems",
      prompt: `Review it like a careful senior engineer. List only real problems: bugs, unhandled edge cases, security or data risks, breaking changes, performance traps. For each: the file, what goes wrong and when, and a one-line fix. If there's nothing worth raising, say so in one sentence.`,
    },
    {
      id: "explain",
      name: "Explain",
      prompt: `Walk me through it as if I'd never seen this part of the codebase: why it exists, the main flow it changes, and the order to read the files in.`,
    },
    {
      id: "tests",
      name: "Missing tests",
      prompt: `Which tests would catch a regression in this change? List the missing cases, each with the file it belongs in and what it should check. Leave out what the diff already tests.`,
    },
  ];
}

/** Starting points for actions. */
export const ACTION_TEMPLATES: Array<{ name: string; description: string; make: () => Action }> = [
  {
    name: "Hand off",
    description: "Ask someone else to review, take yourself off and tell them why.",
    make: () => ({
      id: newId(),
      name: "Hand off",
      confirm: true,
      steps: [
        { kind: "request", reviewers: [] },
        { kind: "unrequestMe" },
        { kind: "comment", body: "Handing this one over, thanks!" },
      ],
    }),
  },
  {
    name: "Run a script",
    description: "Anything a terminal can do: a Slack webhook, a ticket, a local checkout.",
    make: () => ({ id: newId(), name: "Script", confirm: false, steps: [{ kind: "run", command: 'echo "$PR_URL"' }] }),
  },
  { name: "Blank", description: "Pick the steps yourself.", make: () => ({ id: newId(), name: "New action", confirm: false, steps: [] }) },
];

// MARK: Reading what's on disk

const isString = (v: unknown): v is string => typeof v === "string";
const strings = (v: unknown, max = 200): string[] =>
  Array.isArray(v) ? v.filter(isString).map((s) => s.trim()).filter(Boolean).slice(0, max) : [];
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const int = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** A valid regular expression, or empty. */
export function validPattern(pattern: string): boolean {
  if (!pattern) return true;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

const isLogin = (s: string) => /^[\w-]+(\[bot\])?$/.test(s);
/** "owner/name", or "owner/*" for all of an owner's repositories. */
export const isRepoPattern = (s: string) => /^[\w.-]+\/(?:[\w.-]+|\*)$/.test(s);

function normalizeStep(raw: unknown): ActionStep | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (isString(v) ? v.slice(0, max) : "");
  switch (r.kind) {
    case "comment":
      return { kind: "comment", body: text(r.body, 10_000) };
    case "request":
      return { kind: "request", reviewers: strings(r.reviewers, 20).filter((s) => /^[\w.-]+(\/[\w.-]+)?$/.test(s)) };
    case "unrequestMe":
      return { kind: "unrequestMe" };
    case "label":
      return { kind: "label", labels: strings(r.labels, 20) };
    case "open":
      return { kind: "open", url: text(r.url, 2000) };
    case "run":
      return { kind: "run", command: text(r.command, 4000) };
    default:
      return null;
  }
}

function normalizePrompt(raw: unknown): Prompt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isString(r.prompt) || !r.prompt.trim()) return null;
  return {
    id: isString(r.id) && /^[\w-]{1,64}$/.test(r.id) ? r.id : newId(),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 30) : "Ask",
    prompt: r.prompt.slice(0, 8000),
  };
}

function normalizeFilter(raw: unknown): DiffFilter | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const pattern = (v: unknown) => (isString(v) && validPattern(v) ? v.slice(0, 1000) : "");
  return {
    id: isString(r.id) && /^[\w-]{1,64}$/.test(r.id) ? r.id : newId(),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 24) : "Filter",
    include: pattern(r.include),
    exclude: pattern(r.exclude),
    repos: strings(r.repos, 20).filter(isRepoPattern),
  };
}

function normalizeAction(raw: unknown): Action | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return {
    id: isString(r.id) && /^[\w-]{1,64}$/.test(r.id) ? r.id : newId(),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 30) : "Action",
    confirm: bool(r.confirm, false),
    steps: Array.isArray(r.steps) ? r.steps.map(normalizeStep).filter((x): x is ActionStep => x !== null).slice(0, 10) : [],
  };
}

function normalizeQueue(raw: unknown): Queue | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = pick(r.kind, ["review", "involved", "authored", "merged", "custom"] as const, "custom");
  const fallback = TEMPLATES[kind].make();
  const pattern = (v: unknown) => (isString(v) && validPattern(v) ? v.slice(0, 1000) : "");
  return {
    id: isString(r.id) && r.id ? r.id.slice(0, 64) : fallback.id,
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 40) : fallback.name,
    tone: pick(r.tone, TONES, fallback.tone),
    enabled: bool(r.enabled, true),
    kind,
    repos: strings(r.repos).filter((s) => /^[\w.-]+\/(?:[\w.-]+|\*)$/.test(s)),
    teams: strings(r.teams).filter((s) => /^[\w.-]+\/[\w.-]+$/.test(s)),
    directOnly: bool(r.directOnly, fallback.directOnly),
    hideOnceReviewed: bool(r.hideOnceReviewed, fallback.hideOnceReviewed),
    onlyNews: bool(r.onlyNews, fallback.onlyNews),
    drafts: pick(r.drafts, ["show", "hide", "only"] as const, fallback.drafts),
    hideBots: bool(r.hideBots, fallback.hideBots),
    excludeAuthors: strings(r.excludeAuthors),
    includeLabels: strings(r.includeLabels),
    excludeLabels: strings(r.excludeLabels),
    includePaths: pattern(r.includePaths),
    excludePaths: pattern(r.excludePaths),
    mergedDays: int(r.mergedDays, fallback.mergedDays, 1, 30),
    requestedOnly: bool(r.requestedOnly, fallback.requestedOnly),
    skipIfI: pick(r.skipIfI, ["approved", "reviewed", "tookPart"] as const, fallback.skipIfI),
    skipApprovedBy: strings(r.skipApprovedBy).filter(isLogin),
    skipMergedBy: strings(r.skipMergedBy).filter(isLogin),
    staleHours: int(r.staleHours, fallback.staleHours, 0, 24 * 30),
    query: isString(r.query) ? r.query.slice(0, 500) : fallback.query,
    notify: strings(r.notify).filter((k): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k)),
    notifyAt: pick(r.notifyAt, ["now", "review"] as const, fallback.notifyAt),
    notifyLeaveOut: [...new Set(strings(r.notifyLeaveOut).filter((k): k is LeaveOut => (LEAVE_OUT as readonly string[]).includes(k)))],
    notifyRepos: strings(r.notifyRepos).filter((s) => /^[\w.-]+\/(?:[\w.-]+|\*)$/.test(s)),
  };
}

function normalizeSession(raw: unknown): ReviewSession | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const fallback = newSession();
  const days = Array.isArray(r.days) ? r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6) : fallback.days;
  return {
    id: isString(r.id) && /^[\w-]{1,64}$/.test(r.id) ? r.id : fallback.id,
    name: isString(r.name) ? r.name.trim().slice(0, 40) : "",
    on: bool(r.on, true),
    days: [...new Set(days)].sort((a, b) => a - b),
    times: Array.isArray(r.times) ? [...new Set(strings(r.times, 12).filter(validTime))].sort() : fallback.times,
    minutes: int(r.minutes, fallback.minutes, 5, 240),
    order: pick(r.order, REVIEW_ORDERS, fallback.order),
    queues: strings(r.queues, 12),
    drafts: bool(r.drafts, false),
  };
}

function normalizeReviewTime(raw: unknown): ReviewTime {
  const fallback = defaultReviewTime();
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sessions = Array.isArray(r.sessions) ? r.sessions.map(normalizeSession).filter((s): s is ReviewSession => s !== null).slice(0, 10) : [];
  // Two the same would edit as one.
  const ids = new Set<string>();
  for (const s of sessions) {
    if (ids.has(s.id)) s.id = newId();
    ids.add(s.id);
  }
  return {
    enabled: bool(r.enabled, fallback.enabled),
    sessions,
    againFirst: bool(r.againFirst, fallback.againFirst),
    remindEnd: bool(r.remindEnd, fallback.remindEnd),
    skipEmpty: bool(r.skipEmpty, fallback.skipEmpty),
    holdWhileReviewing: bool(r.holdWhileReviewing, fallback.holdWhileReviewing),
  };
}

export function normalize(raw: unknown): Config {
  const fallback = defaultConfig();
  if (!raw || typeof raw !== "object") return fallback;
  const r = raw as Record<string, unknown>;
  const queues = Array.isArray(r.queues) ? r.queues.map(normalizeQueue).filter((q): q is Queue => q !== null) : fallback.queues;
  // Ids must be unique: they key what's been seen.
  const ids = new Set<string>();
  for (const q of queues) {
    if (ids.has(q.id)) q.id = newId();
    ids.add(q.id);
  }
  const actions = Array.isArray(r.actions) ? r.actions.map(normalizeAction).filter((a): a is Action => a !== null).slice(0, 12) : [];
  for (const a of actions) {
    if (ids.has(a.id)) a.id = newId();
    ids.add(a.id);
  }
  return {
    version: 1,
    queues: queues.slice(0, 12),
    pollSeconds: int(r.pollSeconds, fallback.pollSeconds, 30, 900),
    sound: bool(r.sound, fallback.sound),
    theme: pick(r.theme, ["system", "light", "dark"] as const, fallback.theme),
    ai: (() => {
      const ai = r.ai && typeof r.ai === "object" ? (r.ai as Record<string, unknown>) : {};
      return {
        provider: AI_PROVIDERS.includes(ai.provider as AiProvider) ? (ai.provider as AiProvider) : null,
        model: isString(ai.model) ? ai.model.trim().slice(0, 120) : "",
        effort: pick(ai.effort, ["", ...EFFORTS] as const, ""),
        instructions: isString(ai.instructions) ? ai.instructions.slice(0, 4000) : "",
        prompts: Array.isArray(ai.prompts) ? ai.prompts.map(normalizePrompt).filter((p): p is Prompt => p !== null).slice(0, 12) : defaultPrompts(),
        project: bool(ai.project, true),
        review: (() => {
          const review = ai.review && typeof ai.review === "object" ? (ai.review as Record<string, unknown>) : {};
          return { auto: bool(review.auto, false), prompt: isString(review.prompt) && review.prompt.trim() ? review.prompt.slice(0, 8000) : REVIEW_PROMPT };
        })(),
      };
    })(),
    actions,
    filters: Array.isArray(r.filters) ? r.filters.map(normalizeFilter).filter((f): f is DiffFilter => f !== null).slice(0, 12) : fallback.filters,
    reviewTime: normalizeReviewTime(r.reviewTime),
  };
}

export async function loadConfig(): Promise<Config> {
  const text = await bridge.readFile("config");
  if (!text) {
    // Saved right away: queue ids key what's been seen, so they must stay the same next launch.
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
  try {
    return normalize(JSON.parse(text));
  } catch {
    return defaultConfig();
  }
}

export const saveConfig = (config: Config) => bridge.writeFile("config", JSON.stringify(normalize(config), null, 2));
