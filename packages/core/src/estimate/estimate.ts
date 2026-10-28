export const LINES_PER_HOUR = 1000;
export const REMOVED_LINE_WEIGHT = 0.2;
export const MINUTES_PER_FILE = 0.25;

const GENERATED =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|Gemfile\.lock|poetry\.lock|uv\.lock|Pipfile\.lock|composer\.lock|go\.sum|flake\.lock)$|\.min\.(js|css)$|\.map$|\.snap$|(^|\/)(dist|vendor|__generated__|__snapshots__)\//u;

export const isGenerated = (path: string): boolean => GENERATED.test(path);

export interface LineCounts {
  additions: number;
  deletions: number;
}

export const reviewMinutes = (
  path: string,
  lines: LineCounts | null,
  linesPerHour: number = LINES_PER_HOUR,
): number => {
  if (!lines || isGenerated(path)) return MINUTES_PER_FILE;
  return MINUTES_PER_FILE + ((lines.additions + lines.deletions * REMOVED_LINE_WEIGHT) / linesPerHour) * 60;
};

export type Estimator = (path: string, lines: LineCounts | null) => number;

export const KINDS = ["generated", "tests", "docs", "styles", "config", "code"] as const;
export type Kind = (typeof KINDS)[number];

const KIND_PATTERNS: [Kind, RegExp][] = [
  [
    "tests",
    /(^|\/)(__tests__|__mocks__|tests?|specs?|e2e|cypress|playwright)\/|\.(test|spec|stories|e2e)\.[^/]+$|(_test\.(go|py|rb|exs?)|_spec\.rb)$|(^|\/)test_[^/]+\.py$/iu,
  ],
  ["docs", /\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(docs?|documentation)\//iu],
  ["styles", /\.(css|scss|sass|less|styl|pcss)$/iu],
  [
    "config",
    /\.(json|jsonc|ya?ml|toml|ini|cfg|conf|properties|xml|plist|env|lock)$|(^|\/)(Dockerfile|Makefile|Procfile|\.[\w.-]+rc|\.gitignore|\.editorconfig)$/iu,
  ],
];

export const kindOf = (path: string): Kind =>
  isGenerated(path) ? "generated" : (KIND_PATTERNS.find(([, pattern]) => pattern.test(path))?.[0] ?? "code");

interface Tally {
  actual: number;
  expected: number;
  files: number;
}

export interface Learned {
  all: Tally;
  kinds: Partial<Record<Kind, Tally>>;
}

const NOTHING: Tally = { actual: 0, expected: 0, files: 0 };

const PRIOR_MINUTES = 20;
const KIND_PRIOR_MINUTES = 10;
const FADE = 0.98;
const MOST_OFF = 6;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

const tally = (value: unknown): Tally => {
  const raw = asRecord(value);
  const number = (key: string) => (Number.isFinite(raw[key]) && Number(raw[key]) >= 0 ? Number(raw[key]) : 0);
  return { actual: number("actual"), expected: number("expected"), files: number("files") };
};

export const normalizeLearned = (value: unknown): Learned => {
  const raw = asRecord(value);
  const kinds = asRecord(raw.kinds);
  return {
    all: tally(raw.all),
    kinds: Object.fromEntries(KINDS.filter((kind) => kinds[kind]).map((kind) => [kind, tally(kinds[kind])])),
  };
};

export const paceFactors = (learned: Learned): { all: number; kinds: Record<Kind, number> } => {
  const all = (learned.all.actual + PRIOR_MINUTES) / (learned.all.expected + PRIOR_MINUTES);
  const factor = (kind: Kind) => {
    const own = learned.kinds[kind] ?? NOTHING;
    return (own.actual + KIND_PRIOR_MINUTES * all) / (own.expected + KIND_PRIOR_MINUTES);
  };
  return {
    all,
    kinds: {
      generated: factor("generated"),
      tests: factor("tests"),
      docs: factor("docs"),
      styles: factor("styles"),
      config: factor("config"),
      code: factor("code"),
    },
  };
};

export const learnFile = (learned: Learned, path: string, expected: number, actual: number): Learned => {
  if (!(expected > 0) || !(actual > 0)) return learned;
  const spent = Math.min(expected * MOST_OFF, Math.max(expected / MOST_OFF, actual));
  const add = (before: Tally): Tally => ({
    actual: before.actual * FADE + spent,
    expected: before.expected * FADE + expected,
    files: before.files + 1,
  });
  const kind = kindOf(path);
  return { all: add(learned.all), kinds: { ...learned.kinds, [kind]: add(learned.kinds[kind] ?? NOTHING) } };
};

export const createEstimator = (linesPerHour: number, learned: Learned | null): Estimator => {
  if (!learned) return (path, lines) => reviewMinutes(path, lines, linesPerHour);
  const { kinds } = paceFactors(learned);
  return (path, lines) => reviewMinutes(path, lines, linesPerHour) * kinds[kindOf(path)];
};
