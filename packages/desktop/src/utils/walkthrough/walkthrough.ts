import { diffForAi } from "@/utils/ai-diff/ai-diff";
import { about, commentable, DIFF_BUDGET, PROJECT_BUDGET, runAi, type AiReview, type Finding } from "@/utils/ai/ai";
import { isRecord } from "@/utils/bridge/bridge";
import type { Config } from "@/utils/config/config";
import type { Details } from "@/utils/details/details";
import { i18n, type Locale } from "@/utils/i18n/i18n";
import type { Scope } from "@/utils/review-scope/review-scope";
import type { ReviewFile } from "@/utils/review/review";

type Kind = "change" | "pattern" | "exception" | "rest";
export type Stop = { path: string; note: string; line?: number | undefined; end?: number | undefined };
export type Step = {
  depth: number;
  change: "added" | "removed" | "same";
  code: string;
  path?: string | undefined;
  line?: number | undefined;
};
type Weight = "high" | "normal" | "low";
export type Section = {
  title: string;
  kind: Kind;
  weight: Weight;
  before: string;
  after: string;
  summary: string;
  diagram: string;
  flow: Step[];
  files: Stop[];
  alike: Stop[];
  alikeNote: string;
  deep: boolean;
};
type Walkthrough = {
  overview: string;
  diagram: string;
  sections: Section[];
  project: boolean;
  note?: string | undefined;
  at: number;
};
export type Analysis = { walkthrough: Walkthrough; review: AiReview };
export type Plan = { paths: string[]; kept: number };
type Said = { project: boolean; note?: string | undefined; at: number };

export const pathsOf = (section: Section) => [...section.files, ...section.alike].map((stop) => stop.path);

const STEPS = 16;
const DEPTH = 6;
const DIAGRAM_SIZE = 4000;
const RANGE = 400;
const SHARE = 0.75;
const EXAMPLES = 3;
const CONTEXT = 3;
const PROJECT_CONTEXT = 1;

export function shared(files: ReviewFile[], budget: number): ReviewFile[] {
  const room = new Map<ReviewFile, number>();
  let left = budget;
  for (const [i, f] of files.toSorted((a, b) => a.patch.length - b.patch.length).entries()) {
    const share = Math.min(f.patch.length, Math.floor(left / (files.length - i)));
    room.set(f, share);
    left -= share;
  }
  return files.map((f) => {
    const size = room.get(f)!;
    if (size >= f.patch.length) return f;
    const end = f.patch.lastIndexOf("\n", size);
    return { ...f, patch: end > 0 ? f.patch.slice(0, end) : "" };
  });
}

const listed = (f: ReviewFile, id: number, aside: boolean) =>
  `[${id}] ${f.path} (+${f.additions} -${f.deletions}${f.status === "modified" ? "" : `, ${f.status}`}${aside ? ", aside" : ""})`;

export function material(details: Details, split: Scope, project: boolean): { text: string; plan: Plan } {
  const aside = split.leftOut.flatMap((group) => group.files);
  const all = [...split.kept, ...aside];
  const ids = new Map(all.map((f, i) => [f.path, i + 1]));
  const list = all.map((f, i) => listed(f, i + 1, i >= split.kept.length)).join("\n");
  const budget = (project ? PROJECT_BUDGET : DIFF_BUDGET) - list.length;
  const diff = diffForAi(shared(split.kept, budget * SHARE), budget, {
    ids,
    context: project ? PROJECT_CONTEXT : CONTEXT,
  });
  return {
    text: [
      about(details),
      `Files, by id. "aside" marks tests, stories, fixtures, generated code, docs and the like: they stay out of the walkthrough and the diff below.\n${list}`,
      `Diff, each file cut to fit when it's long:\n${diff}`,
    ].join("\n\n"),
    plan: { paths: all.map((f) => f.path), kept: split.kept.length },
  };
}

const BEFORE_AFTER = `"before" and "after": how it behaved before and how it behaves now, seen by whoever uses or calls it; for a change nobody sees, such as a refactor, say so in "after" and leave "before" empty.`;
const FLOW = `When a call path explains it better than prose, give it as "flow": one row per call, as data flows, such as "session = await store.find(id)", nested with "depth", marked "added", "removed" or "same", with the file id and the line of the call. At most a dozen rows.`;
const DIAGRAM = `in Mermaid: a sequenceDiagram when parts talk to each other, a stateDiagram-v2 when something moves between states, an erDiagram when data models change, a flowchart otherwise. Real names, under ten nodes, no colors or styles; in a flowchart declare the nodes first and mark new ones :::added and removed ones :::removed. Leave it empty when it would only repeat the text.`;
const PLAIN = `Write plainly: short, common words, short sentences, active voice, no filler, no praise, no words like "robust", "seamless" or "comprehensive". Code names are fine.`;

const task = (
  review: string,
  language: string,
) => `Review this pull request, then build a walkthrough of it, in one pass.

Review first. ${review}
Read the diff for real problems before you group anything, and give each one as a finding on the line it's about, by file id and line number. Raise a problem once, not at each place it repeats. Flag what the description says that the diff doesn't do, or the other way around. Return no findings only when nothing is worth raising.

Then the walkthrough. Group the files that aren't aside into sections by what they do together: one feature, one endpoint with what it touches, one data model with its migrations, one refactor. Order them the way the author would explain the change: its core first, starting where it shows (a screen, a command, an endpoint), then what it reaches; glue and mechanical changes last. Name each section for what it achieves, not after folders.
For each section: "summary", what it does and why, then what to check, in two or three sentences; ${BEFORE_AFTER} Give it a "weight": "high" where a mistake would hurt (security, money, data loss, public contracts, tricky logic), "low" for mechanical changes, "normal" otherwise.
In "files", the section's file ids in reading order. Add a "note", with the "line" where it starts and the "end" where it stops, only where one place needs a closer look. When many files repeat the same change, use kind "pattern": up to three of them in "files", the others in "alike" with what they repeat. A file that looks like the pattern but does something else gets its own section, kind "exception". Every file that isn't aside goes in exactly one section. Usually 3 to 10 sections.
Draw "diagram", for the whole change, ${DIAGRAM}

${PLAIN}
Write findings in the language of the review guidance above. Write the walkthrough (overview, titles, summaries, notes, diagram labels) in ${language}.`;

const partTask = (language: string) => `Explain one part of this pull request in depth, for a reviewer about to read it.
The material gives the part's title, what the walkthrough says about it, and the full diff of its files.
Give ${BEFORE_AFTER}
Rewrite "summary": what this part does and why, then what the reviewer should check. Two to four sentences.
${FLOW}
Draw "diagram" ${DIAGRAM}
In "files", go through every file of the part by id, with a note on what to look at and, when one place matters most, the "line" where it starts and the "end" where it stops.
${PLAIN}
Write it in ${language}.`;

const ID = { type: "integer", description: "The file's id." };
const LINE = { type: "integer", description: "A line number from the diff." };
const STOPS = {
  type: "array",
  items: {
    type: "object",
    properties: { id: ID, note: { type: "string" }, line: LINE, end: LINE },
    required: ["id"],
  },
};
const SAID = {
  before: { type: "string" },
  after: { type: "string" },
  summary: { type: "string" },
};

const SCHEMA = {
  type: "object",
  properties: {
    overview: { type: "string", description: "Two or three sentences: what the pull request does as a whole." },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: ID,
          line: LINE,
          severity: { type: "string", enum: ["issue", "suggestion", "question"] },
          body: {
            type: "string",
            description: "To the author: what's wrong, when it happens, how to fix it. Markdown allowed.",
          },
        },
        required: ["id", "line", "severity", "body"],
      },
    },
    sections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          kind: { type: "string", enum: ["change", "pattern", "exception"] },
          weight: { type: "string", enum: ["high", "normal", "low"] },
          ...SAID,
          files: STOPS,
          alike: {
            type: "object",
            properties: { note: { type: "string" }, ids: { type: "array", items: ID } },
            required: ["note", "ids"],
          },
        },
        required: ["title", "summary", "files"],
      },
    },
    diagram: { type: "string" },
  },
  required: ["overview", "findings", "sections"],
};

const PART_SCHEMA = {
  type: "object",
  properties: {
    ...SAID,
    diagram: { type: "string" },
    flow: {
      type: "array",
      items: {
        type: "object",
        properties: {
          depth: { type: "integer" },
          change: { type: "string", enum: ["added", "removed", "same"] },
          code: { type: "string" },
          id: ID,
          line: LINE,
        },
        required: ["depth", "change", "code"],
      },
    },
    files: STOPS,
  },
  required: ["summary", "files"],
};

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const whole = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const FLOWCHART = /^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/u;
const STYLING = /^\s*(?:%%\{|classDef\s|style\s|linkStyle\s)/u;
const OTHERS = /^(?:sequenceDiagram|stateDiagram(?:-v2)?|erDiagram)\s*$/u;
const MARKS = [
  "classDef added stroke:#1a7f37,stroke-width:2px",
  "classDef removed stroke:#cf222e,stroke-dasharray:4 3",
];

export function readDiagram(value: unknown): string {
  const lines = text(value)
    .replaceAll(/^```(?:mermaid)?\s*|\s*```$/gu, "")
    .split("\n")
    .filter((line) => !STYLING.test(line));
  const [first, ...rest] = lines;
  const head = first!.trim();
  const flowchart = FLOWCHART.test(head);
  if ((!flowchart && !OTHERS.test(head)) || rest.length === 0 || lines.join("\n").length > DIAGRAM_SIZE) return "";
  return [head, ...(flowchart ? MARKS.map((mark) => `  ${mark}`) : []), ...rest].join("\n");
}

function reader(plan: Plan, files: ReviewFile[]) {
  const lines = new Map(files.map((f) => [f.path, commentable(f.patch)]));
  const pathOf = (id: unknown) => {
    const n = whole(id);
    return n !== undefined && n >= 1 ? plan.paths[n - 1] : undefined;
  };
  const inDiff = (path: string, line: number | undefined) =>
    line !== undefined && lines.get(path)?.has(line) ? line : undefined;
  const stop = (path: string, raw: Record<string, unknown>): Stop => {
    const line = inDiff(path, whole(raw.line));
    const end = whole(raw.end);
    return {
      path,
      note: text(raw.note),
      line,
      end: line !== undefined && end !== undefined && end > line && end - line <= RANGE ? end : undefined,
    };
  };
  const step = (raw: unknown): Step[] => {
    if (!isRecord(raw) || !text(raw.code)) return [];
    const change = raw.change === "added" || raw.change === "removed" ? raw.change : "same";
    const path = pathOf(raw.id);
    return [
      {
        depth: Math.min(DEPTH, Math.max(0, whole(raw.depth) ?? 0)),
        change,
        code: text(raw.code).slice(0, 160),
        path,
        line: path && change !== "removed" ? inDiff(path, whole(raw.line)) : undefined,
      },
    ];
  };
  const flow = (value: unknown) =>
    list(value)
      .flatMap((raw) => step(raw))
      .slice(0, STEPS);
  return { pathOf, stop, flow, inDiff };
}

function parse(answer: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.sections ?? parsed.files))
    throw new Error(i18n()("config.aiUnexpected"));
  return parsed;
}

const blank = (title: string, kind: Kind, weight: Weight, files: Stop[]): Section => ({
  title,
  kind,
  weight,
  before: "",
  after: "",
  summary: "",
  diagram: "",
  flow: [],
  files,
  alike: [],
  alikeNote: "",
  deep: false,
});

export function readAnalysis(answer: string, plan: Plan, files: ReviewFile[], said: Said): Analysis {
  const parsed = parse(answer);
  const { pathOf, stop, inDiff } = reader(plan, files);
  const walked = new Set(plan.paths.slice(0, plan.kept));
  const used = new Set<string>();
  const take = (id: unknown) => {
    const path = pathOf(id);
    if (!path || !walked.has(path) || used.has(path)) return null;
    used.add(path);
    return path;
  };
  const sections = list(parsed.sections).flatMap((raw: unknown): Section[] => {
    if (!isRecord(raw)) return [];
    const stops = list(raw.files).flatMap((entry: unknown): Stop[] => {
      const path = isRecord(entry) ? take(entry.id) : null;
      return path && isRecord(entry) ? [stop(path, entry)] : [];
    });
    const alike = isRecord(raw.alike) ? raw.alike : {};
    const others = list(alike.ids).flatMap((id: unknown): Stop[] => {
      const path = take(id);
      return path ? [{ path, note: "" }] : [];
    });
    if (stops.length === 0 && others.length === 0) return [];
    const kind = raw.kind === "pattern" || raw.kind === "exception" ? raw.kind : "change";
    const all = [...stops, ...others];
    const shown =
      kind === "pattern" && stops.length > EXAMPLES
        ? stops.slice(0, EXAMPLES)
        : stops.length > 0
          ? stops
          : others.slice(0, 1);
    return [
      {
        ...blank(text(raw.title), kind, raw.weight === "high" || raw.weight === "low" ? raw.weight : "normal", shown),
        before: text(raw.before),
        after: text(raw.after),
        summary: text(raw.summary),
        alike: all.slice(shown.length),
        alikeNote: text(alike.note),
      },
    ];
  });
  const rest = plan.paths.filter((path) => !used.has(path)).map((path) => ({ path, note: "" }));
  if (rest.length > 0) sections.push(blank("", "rest", "low", rest));
  const findings = list(parsed.findings).flatMap((raw: unknown): Finding[] => {
    if (!isRecord(raw)) return [];
    const path = pathOf(raw.id);
    const line = whole(raw.line);
    const body = text(raw.body);
    if (!path || line === undefined || !body) return [];
    const severity = raw.severity === "suggestion" || raw.severity === "question" ? raw.severity : "issue";
    return [{ path, line, severity, body, inDiff: inDiff(path, line) !== undefined }];
  });
  const overview = text(parsed.overview);
  return {
    walkthrough: { overview, diagram: readDiagram(parsed.diagram), sections, ...said },
    review: { summary: overview, findings, ...said },
  };
}

export function readPart(answer: string, plan: Plan, section: Section, files: ReviewFile[]): Section {
  const parsed = parse(answer);
  const { pathOf, stop, flow } = reader(plan, files);
  const notes = new Map(
    list(parsed.files).flatMap((raw: unknown): Array<[string, Stop]> => {
      const path = isRecord(raw) ? pathOf(raw.id) : undefined;
      return path && isRecord(raw) ? [[path, stop(path, raw)]] : [];
    }),
  );
  const told = (stops: Stop[]) => stops.map((s) => (notes.get(s.path)?.note ? notes.get(s.path)! : s));
  const steps = flow(parsed.flow);
  return {
    ...section,
    before: text(parsed.before) || section.before,
    after: text(parsed.after) || section.after,
    summary: text(parsed.summary) || section.summary,
    diagram: readDiagram(parsed.diagram) || section.diagram,
    flow: steps.length > 0 ? steps : section.flow,
    files: told(section.files),
    alike: told(section.alike),
    deep: true,
  };
}

export function partMaterial(details: Details, section: Section, files: ReviewFile[]): { text: string; plan: Plan } {
  const ids = new Map(files.map((f, i) => [f.path, i + 1]));
  return {
    text: [
      about(details),
      `Part: ${section.title}`,
      `What the walkthrough says about it: ${[section.before, section.after, section.summary].filter(Boolean).join(" ")}`,
      `Its files, by id:\n${files.map((f, i) => listed(f, i + 1, false)).join("\n")}`,
      `Diff, each file cut to fit when it's long:\n${diffForAi(shared(files, DIFF_BUDGET * SHARE), DIFF_BUDGET, { ids })}`,
    ].join("\n\n"),
    plan: { paths: files.map((f) => f.path), kept: files.length },
  };
}

const LANGUAGES: Record<Locale, string> = { en: "English", "pt-BR": "Brazilian Portuguese" };
const language = () => LANGUAGES[i18n().locale];

type Start = { pull: string; head: string; run: string };

export async function analyze(config: Config, details: Details, split: Scope, keep: Start): Promise<void> {
  const { text: input, plan } = material(details, split, config.ai.project);
  await runAi(config, details, input, task(config.ai.review.prompt, language()), {
    schema: SCHEMA,
    runId: keep.run,
    keep: { pull: keep.pull, kind: "analysis", key: "", head: keep.head, meta: JSON.stringify(plan) },
  });
}

export async function deepen(
  config: Config,
  details: Details,
  section: Section,
  files: ReviewFile[],
  keep: Start & { key: string },
): Promise<void> {
  const { text: input, plan } = partMaterial(details, section, files);
  await runAi(config, details, input, partTask(language()), {
    schema: PART_SCHEMA,
    runId: keep.run,
    keep: { pull: keep.pull, kind: "part", key: keep.key, head: keep.head, meta: JSON.stringify(plan) },
  });
}

export const isPlan = (value: unknown): value is Plan =>
  isRecord(value) &&
  typeof value.kept === "number" &&
  Array.isArray(value.paths) &&
  value.paths.every((p) => typeof p === "string");

export function branches(flow: Step[]): string[] {
  const later = flow.map((step, i) => {
    for (const next of flow.slice(i + 1)) {
      if (next.depth < step.depth) return false;
      if (next.depth === step.depth) return true;
    }
    return false;
  });
  return flow.map((step, i) => {
    let prefix = "";
    for (let level = 1; level < step.depth; level++) {
      const parent = flow.slice(0, i).findLastIndex((s) => s.depth === level);
      prefix += parent >= 0 && later[parent] ? "│  " : "   ";
    }
    return step.depth === 0 ? "" : `${prefix}${later[i] ? "├─ " : "└─ "}`;
  });
}
