// How long a review takes: Focus Diff's estimate (its utils/review-time), about 1,000 changed lines
// an hour to start with, then the reader's own pace, learned from the files they mark as viewed.
// What's learned is kept in pace.json beside the config, so every window (and Rust) reads the same.

import { useSyncExternalStore } from "react";
import { bridge } from "@/utils/bridge/bridge";
import type { T } from "@/utils/i18n/i18n";

/** An assumption, not measured: a working review pace. Careful inspection is under 500 lines an
 *  hour, but a day-to-day review skims imports, tests and renames much faster. */
export const LINES_PER_HOUR = 1000;
/** Removed code is read, not studied. */
const REMOVED_LINE_WEIGHT = 0.2;
/** Opening a file and getting oriented in it. */
export const MINUTES_PER_FILE = 0.25;

const GENERATED =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|flake\.lock)$|\.min\.(js|css)$|\.map$|\.snap$|(^|\/)(dist|vendor|__generated__|__snapshots__)\//;

export const isGenerated = (path: string) => GENERATED.test(path);

export type LineCounts = { additions: number; deletions: number };

/** Minutes to review one file at a pace. Generated and lock files only cost the time to open them. */
export function reviewMinutes(path: string, lines: LineCounts | null, linesPerHour = LINES_PER_HOUR): number {
  if (!lines || isGenerated(path)) return MINUTES_PER_FILE;
  return MINUTES_PER_FILE + ((lines.additions + lines.deletions * REMOVED_LINE_WEIGHT) / linesPerHour) * 60;
}

export type Estimator = (path: string, lines: LineCounts | null) => number;

/** Kinds of file one reader goes through at different paces: tests skimmed, code studied, docs
 *  read. A path is the first kind it matches, in this order. */
export const KINDS = ["generated", "tests", "docs", "styles", "config", "code"] as const;
export type Kind = (typeof KINDS)[number];

const KIND_PATTERNS: Array<[Kind, RegExp]> = [
  ["tests", /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright)\/|\.(test|spec|stories|e2e)\.[^/]+$|(_test\.(go|py|rb|exs?)|_spec\.rb)$|(^|\/)test_[^/]+\.py$/i],
  ["docs", /\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(docs?|documentation)\//i],
  ["styles", /\.(css|scss|sass|less|styl|pcss)$/i],
  ["config", /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|properties|xml|plist|env|lock)$|(^|\/)(Dockerfile|Makefile|Procfile|\.[\w.-]+rc|\.gitignore|\.editorconfig)$/i],
];

export const kindOf = (path: string): Kind => (isGenerated(path) ? "generated" : (KIND_PATTERNS.find(([, pattern]) => pattern.test(path))?.[0] ?? "code"));

/** Minutes spent on files next to the minutes the starting pace gave them; both fade as newer
 *  reviews come in. */
type Tally = { actual: number; expected: number; files: number };

/** What's been learned of the reader's pace, overall and per kind of file. The same shape as
 *  Focus Diff's. */
export type Learned = { all: Tally; kinds: Partial<Record<Kind, Tally>> };

const NOTHING: Tally = { actual: 0, expected: 0, files: 0 };

/** How sure the starting pace is before anything's learned, in minutes of review: the first few
 *  files nudge the estimates, and only an hour or so of reviewing outweighs it. A kind with few
 *  files leans on the overall pace. */
const PRIOR_MINUTES = 20;
const KIND_PRIOR_MINUTES = 10;
/** Each new file makes what came before count a little less, so the estimates follow the reader. */
const FADE = 0.98;
/** One file can say the reader is at most this many times slower or faster, so a file left open
 *  over lunch can't skew it. */
const MOST_OFF = 6;

const tally = (value: unknown): Tally => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const number = (key: string) => (Number.isFinite(raw[key]) && Number(raw[key]) >= 0 ? Number(raw[key]) : 0);
  return { actual: number("actual"), expected: number("expected"), files: number("files") };
};

export function normalizeLearned(value: unknown): Learned {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const kinds = raw.kinds && typeof raw.kinds === "object" ? (raw.kinds as Record<string, unknown>) : {};
  return { all: tally(raw.all), kinds: Object.fromEntries(KINDS.filter((kind) => kinds[kind]).map((kind) => [kind, tally(kinds[kind])])) };
}

/** How many times the starting pace the reader takes, overall and per kind; 1 until something's learned. */
export function paceFactors(learned: Learned): { all: number; kinds: Record<Kind, number> } {
  const all = (learned.all.actual + PRIOR_MINUTES) / (learned.all.expected + PRIOR_MINUTES);
  const kinds = Object.fromEntries(
    KINDS.map((kind) => {
      const own = learned.kinds[kind] ?? NOTHING;
      return [kind, (own.actual + KIND_PRIOR_MINUTES * all) / (own.expected + KIND_PRIOR_MINUTES)];
    }),
  ) as Record<Kind, number>;
  return { all, kinds };
}

/** Learns from one file reviewed: the minutes the starting pace gave it, and the minutes spent. */
export function learnFile(learned: Learned, path: string, expected: number, actual: number): Learned {
  if (!(expected > 0) || !(actual > 0)) return learned;
  const spent = Math.min(expected * MOST_OFF, Math.max(expected / MOST_OFF, actual));
  const add = (before: Tally): Tally => ({ actual: before.actual * FADE + spent, expected: before.expected * FADE + expected, files: before.files + 1 });
  const kind = kindOf(path);
  return { all: add(learned.all), kinds: { ...learned.kinds, [kind]: add(learned.kinds[kind] ?? NOTHING) } };
}

/** Estimates at the starting pace, corrected by what's been learned of the reader, if anything. */
export function createEstimator(learned: Learned | null, linesPerHour = LINES_PER_HOUR): Estimator {
  if (!learned) return (path, lines) => reviewMinutes(path, lines, linesPerHour);
  const { kinds } = paceFactors(learned);
  return (path, lines) => reviewMinutes(path, lines, linesPerHour) * kinds[kindOf(path)];
}

/** A whole pull request from its totals alone, as the panel knows it: no paths, so the overall pace. */
export function pullMinutes(pr: LineCounts & { changedFiles: number }, learned: Learned | null): number {
  const lines = pr.additions + pr.deletions * REMOVED_LINE_WEIGHT;
  const minutes = pr.changedFiles * MINUTES_PER_FILE + (lines / LINES_PER_HOUR) * 60;
  return learned ? minutes * paceFactors(learned).all : minutes;
}

/** What the estimate assumes, for its tooltip. (An estimate in words is t.duration, lib/i18n.ts.) */
export const estimateHint = (t: T) => t("config.estimateHint", { lines: LINES_PER_HOUR });

// MARK: Time spent on files

/** The longest still moment counted as reading: time to think a tricky change through, short of
 *  leaving the desk. */
const STILL_LIMIT_MS = 90_000;

/** The time spent on files between two moments of activity `gap` apart. */
export const creditFor = (gap: number) => Math.max(0, Math.min(gap, STILL_LIMIT_MS));

/** Files on screen, and how much of it each takes, in pixels. */
export type OnScreen = Array<[path: string, height: number]>;

/** Shares `credit` among the files on screen by how much of it each takes, so a short file read
 *  beside a long one gets its part. */
export function share(credit: number, onScreen: OnScreen): OnScreen {
  const total = onScreen.reduce((sum, [, height]) => sum + height, 0);
  return total > 0 ? onScreen.map(([path, height]) => [path, (credit * height) / total]) : [];
}

// MARK: Kept

let learned: Learned | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  loading ??= (async () => {
    // Other windows learn too: follow what they write.
    void bridge.on<string>("file-changed", (name) => name === "pace" && void read());
    await read();
  })();
}

async function read() {
  try {
    const text = await bridge.readFile("pace");
    learned = normalizeLearned(text ? JSON.parse(text) : null);
  } catch {
    learned = normalizeLearned(null);
  }
  for (const listener of listeners) listener();
}

/** What's been learned of the reader's pace; null until it's read. */
export function useLearned(): Learned | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      load();
      return () => listeners.delete(listener);
    },
    () => learned,
  );
}

/** Learns from files just reviewed, on top of what's on disk (another window may have learned
 *  something since). */
export async function learnFiles(samples: Array<{ path: string; expected: number; actual: number }>) {
  if (!samples.length) return;
  await read();
  let next = learned ?? normalizeLearned(null);
  for (const s of samples) next = learnFile(next, s.path, s.expected, s.actual);
  learned = next;
  for (const listener of listeners) listener();
  await bridge.writeFile("pace", JSON.stringify(next)).catch(() => {});
}
