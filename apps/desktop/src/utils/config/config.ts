// The person's setup: their queues and preferences, kept in config.json in the app's config folder.
// Everything read from disk goes through `normalize`, so a hand-edited or older file can't break the
// app: unknown fields are dropped, missing ones get defaults.

import { bridge } from "@/utils/bridge/bridge";
import { i18n, LANGUAGES, type Language, type T } from "@/utils/i18n/i18n";

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

export const STEP_KINDS = [
  "comment",
  "request",
  "unrequestMe",
  "label",
  "open",
  "run",
] as const satisfies ReadonlyArray<ActionStep["kind"]>;

/** One of a menu action's choices: its own name and steps. */
export type ActionChoice = { id: string; name: string; steps: ActionStep[] };

/** A button of the person's own on a pull request: its steps run in order, stopping at a failure.
 *  With choices, it's a pull-down button instead ("Delegate" → each person), and a choice's steps
 *  run, not its own. */
export type Action = {
  id: string;
  name: string;
  /** Ask before running. */
  confirm: boolean;
  steps: ActionStep[];
  choices: ActionChoice[];
};

/** A menu action's choice, as an action of its own to run. */
export const choiceAction = (action: Action, choice: ActionChoice): Action => ({
  id: choice.id,
  name: `${action.name} · ${choice.name}`,
  confirm: action.confirm,
  steps: choice.steps,
  choices: [],
});

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
  /** The app's language: the Mac's, or one picked (utils/i18n/i18n.ts). */
  language: Language;
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
export const newId = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

/** Starting points, offered when adding a queue. They're ordinary queues once added, named in
 *  the language in use then. Their names in the list: t(`config.queue.${kind}`) and
 *  t(`config.queue.${kind}.hint`). */
export const TEMPLATES: Record<QueueKind, { make: () => Queue }> = {
  review: {
    make: () => ({
      ...base(),
      id: newId(),
      name: i18n()("config.queue.review.name"),
      kind: "review",
      tone: "blue",
      notify: ["new", "rerequest", "ready"],
      notifyAt: "review",
    }),
  },
  involved: {
    make: () => ({
      ...base(),
      id: newId(),
      name: i18n()("config.queue.involved.name"),
      kind: "involved",
      tone: "purple",
      drafts: "show",
      notify: ["commits", "reply", "mention", "rerequest"],
      notifyAt: "now",
    }),
  },
  authored: {
    make: () => ({
      ...base(),
      id: newId(),
      name: i18n()("config.queue.authored.name"),
      kind: "authored",
      tone: "green",
      drafts: "show",
      notify: ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"],
      notifyAt: "now",
    }),
  },
  merged: {
    make: () => ({
      ...base(),
      id: newId(),
      name: i18n()("config.queue.merged.name"),
      kind: "merged",
      tone: "gray",
      drafts: "show",
      requestedOnly: true,
      skipIfI: "approved",
      notify: [],
      notifyAt: "now",
    }),
  },
  custom: {
    make: () => ({
      ...base(),
      id: newId(),
      name: i18n()("config.queue.custom.name"),
      kind: "custom",
      tone: "amber",
      drafts: "show",
      query: "",
      notify: ["new"],
      notifyAt: "now",
    }),
  },
};

/** What a queue shows, in the two choices Settings asks: open or lately merged pull requests, and
 *  what you have to do with them. Every kind of queue is one pair of them (merged ones only as
 *  asked of you or anyone's), so the presets are only these filled in. */
export const STATES = ["open", "merged"] as const;
export type QueueState = (typeof STATES)[number];
export const PARTS = ["review", "authored", "involved", "any"] as const;
export type QueuePart = (typeof PARTS)[number];

export function sourceOf(queue: Queue): { state: QueueState; part: QueuePart } {
  if (queue.kind === "merged") return { state: "merged", part: queue.requestedOnly ? "review" : "any" };
  if (queue.kind === "custom") return { state: "open", part: "any" };
  return { state: "open", part: queue.kind };
}

/** Whether a pair can be: merged ones are asked of you, or anyone's. */
export const canBe = (state: QueueState, part: QueuePart) => state === "open" || part === "review" || part === "any";

/** The queue showing another pair (one that can't be keeps its part as near as it can). */
export function withSource(queue: Queue, state: QueueState, part: QueuePart): Queue {
  const p = canBe(state, part) ? part : "any";
  if (state === "merged") return { ...queue, kind: "merged", requestedOnly: p === "review" };
  return { ...queue, kind: p === "any" ? "custom" : p };
}

/** The starting points the Add menu offers; any queue can still be made by hand from a custom one,
 *  whose source and filters are all there to choose (Merged too). */
export const PRESETS = ["review", "involved", "authored"] as const satisfies ReadonlyArray<QueueKind>;

export const defaultConfig = (): Config => ({
  version: 1,
  queues: [TEMPLATES.review.make(), TEMPLATES.involved.make(), TEMPLATES.authored.make()],
  pollSeconds: 60,
  sound: false,
  theme: "system",
  language: "system",
  ai: {
    provider: null,
    model: "",
    effort: "",
    instructions: "",
    prompts: defaultPrompts(),
    project: true,
    review: { auto: false, prompt: REVIEW_PROMPT },
  },
  actions: [],
  filters: defaultFilters(),
  reviewTime: defaultReviewTime(),
});

export const defaultReviewTime = (): ReviewTime => ({
  enabled: false,
  sessions: [],
  againFirst: true,
  remindEnd: true,
  skipEmpty: true,
  holdWhileReviewing: false,
});

const WEEKDAYS = [1, 2, 3, 4, 5];

export const newSession = (): ReviewSession => ({
  id: newId(),
  name: "",
  on: true,
  days: WEEKDAYS,
  times: ["15:00"],
  minutes: 30,
  order: "oldest",
  queues: [],
  drafts: false,
});

export const REVIEW_MINUTES = [15, 30, 45, 60, 90, 120] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
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

type RecipeId = "stack" | "tests" | "generated" | "area" | "infra" | "database" | "docs";
type FilterName = "frontend" | "backend" | "code" | "tests" | "generated" | "payments" | "infra" | "database" | "docs";

/** Starting points for filters, from Focus Diff's recipes. `name` keys its words (config.filter.*);
 *  `id` stays the same in every language, since the review window remembers a filter by it. */
const RECIPES: Array<{
  id: RecipeId;
  filters: Array<{ id: string; name: FilterName; include: string; exclude: string }>;
}> = [
  {
    id: "stack",
    filters: [
      {
        id: "frontend",
        name: "frontend",
        include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$",
        exclude: "\\.(test|spec|stories)\\.",
      },
      {
        id: "backend",
        name: "backend",
        include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$",
        exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\.",
      },
    ],
  },
  {
    id: "tests",
    filters: [
      {
        id: "code",
        name: "code",
        include: "",
        exclude: "\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/",
      },
      { id: "tests", name: "tests", include: "\\.(test|spec)\\.|(^|/)(tests?|__tests__)/", exclude: "" },
    ],
  },
  {
    id: "generated",
    filters: [
      {
        id: "no-generated",
        name: "generated",
        include: "",
        exclude:
          "(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|poetry\\.lock|go\\.sum)$|\\.snap$|\\.min\\.(js|css)$|(^|/)(dist|build|generated|__generated__)/",
      },
    ],
  },
  {
    id: "area",
    filters: [{ id: "payments", name: "payments", include: "^(apps|packages|services)/payments/", exclude: "" }],
  },
  {
    id: "infra",
    filters: [
      {
        id: "infra",
        name: "infra",
        include:
          "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$",
        exclude: "",
      },
    ],
  },
  {
    id: "database",
    filters: [
      { id: "database", name: "database", include: "(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$", exclude: "" },
    ],
  },
  { id: "docs", filters: [{ id: "docs", name: "docs", include: "\\.(mdx?|rst|txt)$|(^|/)docs/", exclude: "" }] },
];

/** The recipes in words, for Settings. */
export const filterRecipes = (
  t: T,
): Array<{ title: string; description: string; filters: Array<Omit<DiffFilter, "id" | "repos">> }> =>
  RECIPES.map((recipe) => ({
    title: t(`config.recipe.${recipe.id}`),
    description: t(`config.recipe.${recipe.id}.hint`),
    filters: recipe.filters.map((f) => ({
      name: t(`config.filter.${f.name}`),
      include: f.include,
      exclude: f.exclude,
    })),
  }));

/** Fixed ids: until the person changes them, the defaults are made again each time the file is
 *  read, and the review window remembers a repository's filter by id. */
export function defaultFilters(): DiffFilter[] {
  const t = i18n();
  return [...RECIPES[0]!.filters, ...RECIPES[2]!.filters].map((f) => ({
    id: f.id,
    name: t(`config.filter.${f.name}`),
    include: f.include,
    exclude: f.exclude,
    repos: [],
  }));
}

/** Whether a file is in a filter. Case doesn't matter, as in Focus Diff, so a filter shared between
 *  the two keeps the same files. */
export function inFilter(filter: Pick<DiffFilter, "include" | "exclude">, path: string): boolean {
  const include = filter.include ? compile(filter.include, "i") : undefined;
  // A broken pattern leaves every file in.
  if (include === null) return true;
  if (include && !include.test(path)) return false;
  if (!filter.exclude) return true;
  const exclude = compile(filter.exclude, "i");
  return exclude === null || !exclude.test(path);
}

export const REVIEW_PROMPT = `Review it like a careful senior engineer. Comment only on what matters: bugs, unhandled edge cases, callers or features this change breaks, security or data risks, performance traps, missing tests for risky logic. No praise, no style nitpicks, no comments on what's fine.`;

/** The prompts' names are words of the app, in the language in use; what they ask stays in
 *  English, the AI's working language, and its answers go on GitHub as comments. */
export function defaultPrompts(): Prompt[] {
  const t = i18n();
  return [
    {
      id: "summary",
      name: t("config.prompt.summary"),
      prompt: `From its description and diff, write:
1. What it changes, in two or three plain sentences.
2. "Worth a closer look:" then up to five short points: risks, edge cases, missing tests, or anything surprising, each naming the file.
Be concrete and brief. Don't repeat the description back.`,
    },
    {
      id: "risks",
      name: t("config.prompt.risks"),
      prompt: `Review it like a careful senior engineer. List only real problems: bugs, unhandled edge cases, security or data risks, breaking changes, performance traps. For each: the file, what goes wrong and when, and a one-line fix. If there's nothing worth raising, say so in one sentence.`,
    },
    {
      id: "explain",
      name: t("config.prompt.explain"),
      prompt: `Walk me through it as if I'd never seen this part of the codebase: why it exists, the main flow it changes, and the order to read the files in.`,
    },
    {
      id: "tests",
      name: t("config.prompt.tests"),
      prompt: `Which tests would catch a regression in this change? List the missing cases, each with the file it belongs in and what it should check. Leave out what the diff already tests.`,
    },
  ];
}

/** Starting points for actions, in words for Settings; what they make is named in the language in use. */
/** A new action: a script, which can do anything a terminal can; more steps are added in it. */
export const newAction = (t: T): Action => ({
  id: newId(),
  name: t("config.action.script.name"),
  confirm: false,
  steps: [{ kind: "run", command: 'echo "$PR_URL"' }],
  choices: [],
});

// MARK: Reading what's on disk

const isString = (v: unknown): v is string => typeof v === "string";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const strings = (v: unknown, max = 200): string[] =>
  Array.isArray(v)
    ? v
        .filter((s) => isString(s))
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, max)
    : [];
const pick = <V extends string>(v: unknown, allowed: readonly V[], fallback: V): V =>
  allowed.find((a) => a === v) ?? fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const int = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** The person's own pattern compiled, or null when it isn't valid. Without the u flag: patterns
 *  written for Focus Diff can use escapes the u flag turns into errors. */
function compile(pattern: string, flags = ""): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/** A valid regular expression, or empty. */
export const validPattern = (pattern: string): boolean => !pattern || compile(pattern) !== null;

const isLogin = (s: string) => /^[\w-]+(\[bot\])?$/u.test(s);
/** "owner/name", or "owner/*" for all of an owner's repositories. */
export const isRepoPattern = (s: string) => /^[\w.-]+\/(?:[\w.-]+|\*)$/u.test(s);

const clipped = (v: unknown, max: number) => (isString(v) ? v.slice(0, max) : "");
const pattern = (v: unknown) => (isString(v) && validPattern(v) ? v.slice(0, 1000) : "");
const ID = /^[\w-]{1,64}$/u;
const id = (v: unknown, fallback: () => string) => (isString(v) && ID.test(v) ? v : fallback());

function normalizeStep(r: unknown): ActionStep | null {
  if (!isRecord(r)) return null;
  switch (r.kind) {
    case "comment":
      return { kind: "comment", body: clipped(r.body, 10_000) };
    case "request":
      return { kind: "request", reviewers: strings(r.reviewers, 20).filter((s) => /^[\w.-]+(\/[\w.-]+)?$/u.test(s)) };
    case "unrequestMe":
      return { kind: "unrequestMe" };
    case "label":
      return { kind: "label", labels: strings(r.labels, 20) };
    case "open":
      return { kind: "open", url: clipped(r.url, 2000) };
    case "run":
      return { kind: "run", command: clipped(r.command, 4000) };
    default:
      return null;
  }
}

function normalizePrompt(r: unknown): Prompt | null {
  if (!isRecord(r)) return null;
  if (!isString(r.prompt) || !r.prompt.trim()) return null;
  return {
    id: id(r.id, newId),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 30) : i18n()("config.prompt.untitled"),
    prompt: r.prompt.slice(0, 8000),
  };
}

function normalizeFilter(r: unknown): DiffFilter | null {
  if (!isRecord(r)) return null;
  return {
    id: id(r.id, newId),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 24) : i18n()("config.filter.untitled"),
    include: pattern(r.include),
    exclude: pattern(r.exclude),
    repos: strings(r.repos, 20).filter((s) => isRepoPattern(s)),
  };
}

function normalizeAction(r: unknown): Action | null {
  if (!isRecord(r)) return null;
  return {
    id: id(r.id, newId),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 30) : i18n()("config.action.untitled"),
    confirm: bool(r.confirm, false),
    steps: normalizeSteps(r.steps),
    choices: Array.isArray(r.choices)
      ? r.choices
          .map((c) => normalizeChoice(c))
          .filter((c): c is ActionChoice => c !== null)
          .slice(0, 12)
      : [],
  };
}

const normalizeSteps = (v: unknown) =>
  Array.isArray(v)
    ? v
        .map((s) => normalizeStep(s))
        .filter((x): x is ActionStep => x !== null)
        .slice(0, 10)
    : [];

function normalizeChoice(r: unknown): ActionChoice | null {
  if (!isRecord(r)) return null;
  return {
    id: id(r.id, newId),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 30) : i18n()("config.action.untitled"),
    steps: normalizeSteps(r.steps),
  };
}

function normalizeQueue(r: unknown): Queue | null {
  if (!isRecord(r)) return null;
  const kind = pick(r.kind, ["review", "involved", "authored", "merged", "custom"] as const, "custom");
  const fallback = TEMPLATES[kind].make();
  return {
    id: isString(r.id) && r.id ? r.id.slice(0, 64) : fallback.id,
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 40) : fallback.name,
    tone: pick(r.tone, TONES, fallback.tone),
    enabled: bool(r.enabled, true),
    kind,
    repos: strings(r.repos).filter((s) => isRepoPattern(s)),
    teams: strings(r.teams).filter((s) => /^[\w.-]+\/[\w.-]+$/u.test(s)),
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
    skipApprovedBy: strings(r.skipApprovedBy).filter((s) => isLogin(s)),
    skipMergedBy: strings(r.skipMergedBy).filter((s) => isLogin(s)),
    staleHours: int(r.staleHours, fallback.staleHours, 0, 24 * 30),
    query: isString(r.query) ? r.query.slice(0, 500) : fallback.query,
    notify: strings(r.notify).filter((k): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k)),
    notifyAt: pick(r.notifyAt, ["now", "review"] as const, fallback.notifyAt),
    notifyLeaveOut: [
      ...new Set(strings(r.notifyLeaveOut).filter((k): k is LeaveOut => (LEAVE_OUT as readonly string[]).includes(k))),
    ],
    notifyRepos: strings(r.notifyRepos).filter((s) => isRepoPattern(s)),
  };
}

function normalizeSession(r: unknown): ReviewSession | null {
  if (!isRecord(r)) return null;
  const fallback = newSession();
  const days = Array.isArray(r.days)
    ? r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6)
    : fallback.days;
  return {
    id: id(r.id, () => fallback.id),
    name: isString(r.name) ? r.name.trim().slice(0, 40) : "",
    on: bool(r.on, true),
    days: [...new Set(days)].toSorted((a, b) => a - b),
    times: Array.isArray(r.times)
      ? [...new Set(strings(r.times, 12).filter((t) => validTime(t)))].toSorted()
      : fallback.times,
    minutes: int(r.minutes, fallback.minutes, 5, 240),
    order: pick(r.order, REVIEW_ORDERS, fallback.order),
    queues: strings(r.queues, 12),
    drafts: bool(r.drafts, false),
  };
}

function normalizeReviewTime(raw: unknown): ReviewTime {
  const fallback = defaultReviewTime();
  const r = isRecord(raw) ? raw : {};
  const sessions = Array.isArray(r.sessions)
    ? r.sessions
        .map(normalizeSession)
        .filter((s): s is ReviewSession => s !== null)
        .slice(0, 10)
    : [];
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

export function normalize(r: unknown): Config {
  const fallback = defaultConfig();
  if (!isRecord(r)) return fallback;
  const queues = Array.isArray(r.queues)
    ? r.queues.map(normalizeQueue).filter((q): q is Queue => q !== null)
    : fallback.queues;
  // Ids must be unique: they key what's been seen.
  const ids = new Set<string>();
  for (const q of queues) {
    if (ids.has(q.id)) q.id = newId();
    ids.add(q.id);
  }
  const actions = Array.isArray(r.actions)
    ? r.actions
        .map(normalizeAction)
        .filter((a): a is Action => a !== null)
        .slice(0, 12)
    : [];
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
    language: pick(r.language, LANGUAGES, fallback.language),
    ai: (() => {
      const ai = isRecord(r.ai) ? r.ai : {};
      return {
        provider: AI_PROVIDERS.find((p) => p === ai.provider) ?? null,
        model: isString(ai.model) ? ai.model.trim().slice(0, 120) : "",
        effort: pick(ai.effort, ["", ...EFFORTS] as const, ""),
        instructions: isString(ai.instructions) ? ai.instructions.slice(0, 4000) : "",
        prompts: Array.isArray(ai.prompts)
          ? ai.prompts
              .map(normalizePrompt)
              .filter((p): p is Prompt => p !== null)
              .slice(0, 12)
          : defaultPrompts(),
        project: bool(ai.project, true),
        review: (() => {
          const review = isRecord(ai.review) ? ai.review : {};
          return {
            auto: bool(review.auto, false),
            prompt: isString(review.prompt) && review.prompt.trim() ? review.prompt.slice(0, 8000) : REVIEW_PROMPT,
          };
        })(),
      };
    })(),
    actions,
    filters: Array.isArray(r.filters)
      ? r.filters
          .map(normalizeFilter)
          .filter((f): f is DiffFilter => f !== null)
          .slice(0, 12)
      : fallback.filters,
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
