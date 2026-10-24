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
  "approved",
  "changes",
  "ci-failed",
  "ci-passed",
  "conflict",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

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
  /** custom: GitHub search qualifiers, e.g. "repo:acme/web label:urgent". */
  query: string;
  /** What's worth a notification. */
  notify: EventKind[];
};

export type AiProvider = "claude" | "codex" | "cursor";

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

export type Config = {
  version: 1;
  queues: Queue[];
  pollSeconds: number;
  sound: boolean;
  theme: "system" | "light" | "dark";
  /** Optional: the coding agent CLI to ask, on the person's own subscription. */
  ai: { provider: AiProvider | null; model: string };
  actions: Action[];
};

let counter = 0;
export const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const base = (): Omit<Queue, "id" | "name" | "kind" | "tone" | "notify"> => ({
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
  query: "",
});

/** Starting points, offered when adding a queue. They're ordinary queues once added. */
export const TEMPLATES: Record<QueueKind, { name: string; description: string; make: () => Queue }> = {
  review: {
    name: "Needs my review",
    description: "Open pull requests waiting on your review, until you've reviewed or commented.",
    make: () => ({ ...base(), id: newId(), name: "Review", kind: "review", tone: "blue", notify: ["new", "rerequest"] }),
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
    }),
  },
  merged: {
    name: "Merged without me",
    description: "Pull requests merged lately without your approval: the ones asked of you or your team, in the files you care about.",
    make: () => ({ ...base(), id: newId(), name: "Merged", kind: "merged", tone: "gray", drafts: "show", requestedOnly: true, skipIfI: "approved", notify: [] }),
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
    }),
  },
};

export const defaultConfig = (): Config => ({
  version: 1,
  queues: [TEMPLATES.review.make(), TEMPLATES.involved.make(), TEMPLATES.authored.make()],
  pollSeconds: 90,
  sound: false,
  theme: "system",
  ai: { provider: null, model: "" },
  actions: [],
});

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
    query: isString(r.query) ? r.query.slice(0, 500) : fallback.query,
    notify: strings(r.notify).filter((k): k is EventKind => (EVENT_KINDS as readonly string[]).includes(k)),
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
    pollSeconds: int(r.pollSeconds, fallback.pollSeconds, 60, 900),
    sound: bool(r.sound, fallback.sound),
    theme: pick(r.theme, ["system", "light", "dark"] as const, fallback.theme),
    ai: (() => {
      const ai = r.ai && typeof r.ai === "object" ? (r.ai as Record<string, unknown>) : {};
      return {
        provider: (["claude", "codex", "cursor"] as const).includes(ai.provider as AiProvider) ? (ai.provider as AiProvider) : null,
        model: isString(ai.model) ? ai.model.trim().slice(0, 80) : "",
      };
    })(),
    actions,
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
