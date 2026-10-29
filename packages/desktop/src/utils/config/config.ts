import { isValidPattern } from "@focus-diff/core/filters";
import { PATH_FILTERS, RECIPES, upgradePatterns, type PathFilterName, type RecipeId } from "@focus-diff/core/recipes";

import { bridge, isRecord } from "@/utils/bridge/bridge";
import { i18n, LANGUAGES, type Language, type T } from "@/utils/i18n/i18n";

export type QueueKind = "review" | "involved" | "authored" | "merged" | "custom";

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
  repos: string[];
  teams: string[];
  directOnly: boolean;
  hideOnceReviewed: boolean;
  onlyNews: boolean;
  drafts: "show" | "hide" | "only";
  hideBots: boolean;
  excludeAuthors: string[];
  includeLabels: string[];
  excludeLabels: string[];
  includePaths: string;
  excludePaths: string;
  mergedDays: number;
  requestedOnly: boolean;
  skipIfI: "approved" | "reviewed" | "tookPart";
  skipApprovedBy: string[];
  skipMergedBy: string[];
  staleHours: number;
  query: string;
  notify: EventKind[];
  notifyAt: "now" | "review";
  notifyLeaveOut: LeaveOut[];
  notifyRepos: string[];
};

export const REVIEW_ORDERS = ["oldest", "quickest", "fill"] as const;
export type ReviewOrder = (typeof REVIEW_ORDERS)[number];

export type ReviewSession = {
  id: string;
  name: string;
  on: boolean;
  days: number[];
  times: string[];
  minutes: number;
  order: ReviewOrder;
  queues: string[];
  drafts: boolean;
};

export type ReviewTime = {
  enabled: boolean;
  sessions: ReviewSession[];
  againFirst: boolean;
  remindEnd: boolean;
  skipEmpty: boolean;
  holdWhileReviewing: boolean;
};

export const AI_PROVIDERS = ["claude", "cursor"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

export type Prompt = { id: string; name: string; prompt: string };

export type ActionStep =
  | { kind: "comment"; body: string }
  | { kind: "request"; reviewers: string[] }
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

export type ActionChoice = { id: string; name: string; steps: ActionStep[] };

export type Action = {
  id: string;
  name: string;
  confirm: boolean;
  steps: ActionStep[];
  choices: ActionChoice[];
};

export const choiceAction = (action: Action, choice: ActionChoice): Action => ({
  id: choice.id,
  name: `${action.name} · ${choice.name}`,
  confirm: action.confirm,
  steps: choice.steps,
  choices: [],
});

export type DiffFilter = { id: string; name: string; include: string; exclude: string; repos: string[] };

export type Config = {
  version: 1;
  queues: Queue[];
  pollSeconds: number;
  sound: boolean;
  theme: "system" | "light" | "dark";
  language: Language;
  ai: {
    provider: AiProvider | null;
    model: string;
    effort: Effort | "";
    instructions: string;
    prompts: Prompt[];
    project: boolean;
    ownSettings: boolean;
    review: { auto: boolean; prompt: string };
  };
  actions: Action[];
  filters: DiffFilter[];
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

export const STATES = ["open", "merged"] as const;
type QueueState = (typeof STATES)[number];
export const PARTS = ["review", "authored", "involved", "any"] as const;
export type QueuePart = (typeof PARTS)[number];

export function sourceOf(queue: Queue): { state: QueueState; part: QueuePart } {
  if (queue.kind === "merged") return { state: "merged", part: queue.requestedOnly ? "review" : "any" };
  if (queue.kind === "custom") return { state: "open", part: "any" };
  return { state: "open", part: queue.kind };
}

export const canBe = (state: QueueState, part: QueuePart) => state === "open" || part === "review" || part === "any";

export const KIND_EVENTS: Record<QueueKind, EventKind[]> = {
  review: ["new", "rerequest", "ready", "comment", "mention"],
  involved: ["new", "commits", "reply", "mention", "comment", "rerequest", "ready"],
  authored: ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"],
  merged: ["new"],
  custom: ["new", "commits", "reply", "mention", "comment", "rerequest", "ready"],
};

export function withSource(queue: Queue, state: QueueState, part: QueuePart): Queue {
  const p = canBe(state, part) ? part : "any";
  const kind: QueueKind = state === "merged" ? "merged" : p === "any" ? "custom" : p;
  const notify = queue.notify.filter((e) => KIND_EVENTS[kind].includes(e));
  if (kind === "merged") return { ...queue, kind, notify, requestedOnly: p === "review" };
  return { ...queue, kind, notify };
}

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
    ownSettings: false,
    review: { auto: false, prompt: REVIEW_PROMPT },
  },
  actions: [],
  filters: defaultFilters(),
  reviewTime: defaultReviewTime(),
});

const defaultReviewTime = (): ReviewTime => ({
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

const RECIPE_ORDER: RecipeId[] = ["stack", "tests", "generated", "area", "infra", "database", "docs"];
const filterId = (name: PathFilterName) => (name === "generated" ? "no-generated" : name);

export const filterRecipes = (
  t: T,
): Array<{ id: RecipeId; title: string; description: string; filters: Array<Omit<DiffFilter, "id" | "repos">> }> =>
  RECIPE_ORDER.map((id) => ({
    id,
    title: t(`config.recipe.${id}`),
    description: t(`config.recipe.${id}.hint`),
    filters: RECIPES[id].map((name) => ({ name: t(`config.filter.${name}`), ...PATH_FILTERS[name] })),
  }));

const fromRecipe = (f: DiffFilter, name: PathFilterName) =>
  f.id === filterId(name) || (f.include === PATH_FILTERS[name].include && f.exclude === PATH_FILTERS[name].exclude);

export const recipeOn = (filters: DiffFilter[], id: RecipeId) =>
  RECIPES[id].every((name) => filters.some((f) => fromRecipe(f, name)));

export function withRecipes(filters: DiffFilter[], chosen: ReadonlySet<RecipeId>, t: T): DiffFilter[] {
  const fromRecipes = new Set(RECIPE_ORDER.flatMap((id) => RECIPES[id]));
  const own = filters.filter((f) => ![...fromRecipes].some((name) => fromRecipe(f, name)));
  const names = [...new Set(RECIPE_ORDER.filter((id) => chosen.has(id)).flatMap((id) => RECIPES[id]))];
  const picked = names.map(
    (name) =>
      filters.find((f) => fromRecipe(f, name)) ?? {
        id: filterId(name),
        name: t(`config.filter.${name}`),
        ...PATH_FILTERS[name],
        repos: [],
      },
  );
  return [...picked, ...own].slice(0, 12);
}

function defaultFilters(): DiffFilter[] {
  const t = i18n();
  return [...RECIPES.stack, ...RECIPES.generated].map((name) => ({
    id: filterId(name),
    name: t(`config.filter.${name}`),
    ...PATH_FILTERS[name],
    repos: [],
  }));
}

export const REVIEW_PROMPT = `Review it like a careful senior engineer. Comment only on what matters: bugs, unhandled edge cases, callers or features this change breaks, security or data risks, performance traps, missing tests for risky logic. No praise, no style nitpicks, no comments on what's fine.`;

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

export const newAction = (t: T): Action => ({
  id: newId(),
  name: t("config.action.script.name"),
  confirm: false,
  steps: [{ kind: "run", command: 'echo "$PR_URL"' }],
  choices: [],
});

const isString = (v: unknown): v is string => typeof v === "string";
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

const isLogin = (s: string) => /^[\w-]+(\[bot\])?$/u.test(s);
export const isRepoPattern = (s: string) => /^[\w.-]+\/(?:[\w.-]+|\*)$/u.test(s);

const clipped = (v: unknown, max: number) => (isString(v) ? v.slice(0, max) : "");
const pattern = (v: unknown) => (isString(v) && isValidPattern(v) ? v.slice(0, 1000) : "");
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
  return upgradePatterns({
    id: id(r.id, newId),
    name: isString(r.name) && r.name.trim() ? r.name.trim().slice(0, 24) : i18n()("config.filter.untitled"),
    include: pattern(r.include),
    exclude: pattern(r.exclude),
    repos: strings(r.repos, 20).filter((s) => isRepoPattern(s)),
  });
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
        ownSettings: bool(ai.ownSettings, false),
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

export async function loadConfig({ create = true } = {}): Promise<Config> {
  const text = await bridge.readFile("config");
  if (!text) {
    const config = defaultConfig();
    if (create) await saveConfig(config);
    return config;
  }
  try {
    return normalize(JSON.parse(text));
  } catch {
    return defaultConfig();
  }
}

const validOr = (value: string, prior = "") => (isValidPattern(value) ? value : prior);

export function keepValidPatterns(next: Config, last: Pick<Config, "queues" | "filters">): Config {
  return {
    ...next,
    queues: next.queues.map((q) => {
      const prior = last.queues.find((p) => p.id === q.id);
      return {
        ...q,
        includePaths: validOr(q.includePaths, prior?.includePaths),
        excludePaths: validOr(q.excludePaths, prior?.excludePaths),
      };
    }),
    filters: next.filters.map((f) => {
      const prior = last.filters.find((p) => p.id === f.id);
      return { ...f, include: validOr(f.include, prior?.include), exclude: validOr(f.exclude, prior?.exclude) };
    }),
  };
}

export const saveConfig = (config: Config) => bridge.writeFile("config", JSON.stringify(normalize(config), null, 2));
