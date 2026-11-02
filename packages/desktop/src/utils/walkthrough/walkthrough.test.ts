import { describe, expect, it } from "vite-plus/test";

import { defaultConfig } from "@/utils/config/config";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { setLanguage } from "@/utils/i18n/i18n";
import { fakeDetails } from "@/utils/mock-pull/mock-pull";
import type { ReviewFile } from "@/utils/review/review";
import {
  analyze,
  branches,
  deepen,
  fingerprint,
  isPlan,
  material,
  pathsOf,
  partMaterial,
  readAnalysis,
  readDiagram,
  readPart,
  readUpdate,
  shared,
  update,
  type Analysis,
  type Base,
  type Plan,
  type Section,
  type Step,
} from "@/utils/walkthrough/walkthrough";

const details = fakeDetails({ number: 9, title: "Orders API", repo: "web" });

const file = (path: string, patch = "@@ -0,0 +1 @@\n+x", status: ReviewFile["status"] = "modified"): ReviewFile => ({
  path,
  previousPath: null,
  status,
  additions: 3,
  deletions: 1,
  patch,
});

const TEN = `@@ -0,0 +1,10 @@\n${Array.from({ length: 10 }, (_, i) => `+line ${String(i + 1)}`).join("\n")}`;
const FILES = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"].map((path) => file(path, TEN));
const TEST = file("a.test.ts", TEN);
const PLAN: Plan = { paths: [...FILES.map((f) => f.path), TEST.path], kept: 6 };
const SAID = { project: true, note: "Read it all", at: 5 };
const read = (answer: unknown) => readAnalysis(JSON.stringify(answer), PLAN, [...FILES, TEST], SAID);
const AI = { ...defaultConfig(), ai: { ...defaultConfig().ai, provider: "claude" as const } };

const asked = () => {
  const calls: Array<Record<string, unknown> | undefined> = [];
  mockCommands((_cmd, args) => {
    if (!(args instanceof Uint8Array)) calls.push(args);
    return { text: "{}", project: true };
  });
  return calls;
};

describe("material", () => {
  const split = { kept: FILES.slice(0, 2), leftOut: [{ reason: "tests" as const, files: [TEST] }] };

  it("lists every file by id, marks the ones set aside, and shows the diff of the others", () => {
    const { text, plan } = material(details, split, false);
    expect(text).toContain("Title: Orders API");
    expect(text).toContain("[1] a.ts (+3 -1)\n[2] b.ts (+3 -1)\n[3] a.test.ts (+3 -1, aside)");
    expect(text).toContain("## [1] a.ts\n@@ 1\n1 +line 1");
    expect(text).not.toContain("## [3]");
    expect(plan).toEqual({
      paths: ["a.ts", "b.ts", "a.test.ts"],
      kept: 2,
      hashes: [fingerprint(TEN), fingerprint(TEN), fingerprint(TEN)],
      project: false,
    });
  });

  it("shows less around each change when the AI can open the project itself", () => {
    const patch = "@@ -1,7 +1,7 @@\n a\n b\n c\n-d\n+D\n e\n f\n g";
    const one = { kept: [file("x.ts", patch, "added")], leftOut: [] };
    expect(material(details, one, false).text).toContain("[1] x.ts (+3 -1, added)");
    expect(material(details, one, false).text).toContain("1  a");
    expect(material(details, one, true).text).not.toContain("1  a");
    expect(material(details, one, true).text).toContain("3  c\n-d\n4 +D\n5  e");
  });
});

describe("shared", () => {
  const lines = (n: number) =>
    ["@@ -0,0 +1 @@", ...Array.from({ length: n }, (_, i) => `+line ${String(i)}`)].join("\n");

  it("keeps small files whole and cuts long ones at a line, so every file keeps a part", () => {
    const files = [file("big.ts", lines(400)), file("small.ts", lines(2)), file("mid.ts", lines(40))];
    const cut = shared(files, 1200);
    expect(cut.map((f) => f.path)).toEqual(["big.ts", "small.ts", "mid.ts"]);
    expect(cut[1]).toBe(files[1]);
    expect(cut.reduce((sum, f) => sum + f.patch.length, 0)).toBeLessThanOrEqual(1200);
    for (const f of [cut[0]!, cut[2]!]) {
      expect(f.patch.startsWith("@@ -0,0 +1 @@\n+line 0")).toBe(true);
      expect(f.patch.split("\n").at(-1)).toMatch(/^\+line \d+$/u);
    }
    expect(cut[0]!.patch.length).toBeGreaterThan(300);
  });

  it("leaves nothing of a file too long for any of its lines to fit, and everything when there's room", () => {
    expect(shared([file("a.ts", "x".repeat(50))], 10)[0]!.patch).toBe("");
    const files = [file("a.ts", lines(3))];
    expect(shared(files, 10_000)).toEqual(files);
  });
});

describe("readAnalysis", () => {
  it("reads sections by file id, each file once, and puts what's left at the end", () => {
    const { walkthrough } = read({
      overview: " Orders. ",
      sections: [
        {
          title: "Create",
          weight: "high",
          before: "B",
          after: "A",
          summary: "S",
          files: [{ id: 1 }, { id: 1 }, { id: 99 }],
        },
        { title: "Aside", files: [{ id: 7 }] },
        "junk",
        {
          title: "Low",
          weight: "low",
          files: [{ id: 2, note: "Look", line: 3, end: 5 }, "junk"],
          alike: { note: "N", ids: [3] },
        },
        { title: "Only alike", kind: "exception", files: [], alike: { note: "", ids: [4, 4, 99, "x"] } },
      ],
      findings: [],
    });
    expect(walkthrough).toMatchObject({ overview: "Orders.", diagram: "", project: true, note: "Read it all", at: 5 });
    expect(walkthrough.sections.map((s) => [s.title, s.kind, s.weight])).toEqual([
      ["Create", "change", "high"],
      ["Low", "change", "low"],
      ["Only alike", "exception", "normal"],
      ["", "rest", "low"],
    ]);
    expect(walkthrough.sections[0]).toMatchObject({ before: "B", after: "A", summary: "S", deep: false });
    expect(walkthrough.sections[1]!.files).toEqual([{ path: "b.ts", note: "Look", line: 3, end: 5 }]);
    expect(walkthrough.sections[1]).toMatchObject({ alike: [{ path: "c.ts", note: "" }], alikeNote: "N" });
    expect(walkthrough.sections[2]!.files.map((f) => f.path)).toEqual(["d.ts"]);
    expect(walkthrough.sections[3]!.files.map((f) => f.path)).toEqual(["e.ts", "f.ts", "a.test.ts"]);
  });

  it("shows a few examples of a pattern and folds the rest", () => {
    const { walkthrough } = read({
      overview: "",
      sections: [
        {
          title: "Routes",
          kind: "pattern",
          files: [1, 2, 3, 4].map((id) => ({ id })),
          alike: { note: "Same", ids: [5] },
        },
      ],
      findings: [],
    });
    expect(walkthrough.sections[0]!.files.map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(walkthrough.sections[0]!.alike.map((f) => f.path)).toEqual(["d.ts", "e.ts"]);
  });

  it("keeps only the lines and ranges that are in the diff", () => {
    const { walkthrough } = read({
      overview: "",
      sections: [
        {
          title: "T",
          files: [
            { id: 1, line: 40, end: 50 },
            { id: 2, line: 2, end: 1 },
            { id: 3, line: 2, end: 900 },
            { id: 4, line: 2.4, end: "x" },
          ],
        },
      ],
      findings: [],
    });
    expect(walkthrough.sections[0]!.files.map((f) => [f.line, f.end])).toEqual([
      [undefined, undefined],
      [2, undefined],
      [2, undefined],
      [2, undefined],
    ]);
  });

  it("reads the findings by file id, and says which are on lines in the diff", () => {
    const { review } = read({
      overview: "Orders.",
      sections: [],
      findings: [
        { id: 1, line: 3, severity: "suggestion", body: " Rename. " },
        { id: 7, line: 400, severity: "question", body: "Why?" },
        { id: 2, line: 1, severity: "odd", body: "Bug." },
        { id: 99, line: 1, severity: "issue", body: "Lost." },
        { id: 1, severity: "issue", body: "No line." },
        { id: 1, line: 1, severity: "issue", body: " " },
        "junk",
      ],
    });
    expect(review).toEqual({
      summary: "Orders.",
      findings: [
        { path: "a.ts", line: 3, severity: "suggestion", body: "Rename.", inDiff: true },
        { path: "a.test.ts", line: 400, severity: "question", body: "Why?", inDiff: false },
        { path: "b.ts", line: 1, severity: "issue", body: "Bug.", inDiff: true },
      ],
      ...SAID,
    });
  });

  it("reads a diagram of the whole change, and an answer with nothing in it", () => {
    expect(read({ overview: "", diagram: "sequenceDiagram\n  A->>B: go", sections: [] }).walkthrough.diagram).toBe(
      "sequenceDiagram\n  A->>B: go",
    );
    expect(read({ sections: [] }).review.findings).toEqual([]);
  });

  it.each(["not json", "[]", JSON.stringify({ overview: "x" })])("says when it can't read %s", (answer) => {
    expect(() => readAnalysis(answer, PLAN, FILES, SAID)).toThrow("The AI's answer wasn't in the expected form.");
  });
});

const PART: Section = {
  title: "Create",
  kind: "change",
  weight: "normal",
  before: "B",
  after: "A",
  summary: "S",
  diagram: "flowchart LR\n  A --> B",
  flow: [{ depth: 0, change: "same", code: "old()" }],
  files: [{ path: "a.ts", note: "Old" }],
  alike: [{ path: "b.ts", note: "" }],
  alikeNote: "",
  deep: false,
};
const PART_PLAN: Plan = { paths: ["a.ts", "b.ts"], kept: 2 };

describe("readPart", () => {
  it("fills in the part from its full diff, keeping what the answer leaves out", () => {
    const part = readPart(
      JSON.stringify({
        after: "Now.",
        summary: "In depth.",
        diagram: "sequenceDiagram\n  A->>B: hi",
        flow: [
          { depth: 0, change: "same", code: "go()", id: 1, line: 2 },
          { depth: 9, change: "removed", code: "gone()", id: 2, line: 2 },
          { depth: -1, change: "added", code: "x".repeat(200), id: 99, line: 2 },
          { code: " " },
          { change: "same", code: "after()" },
          "junk",
        ],
        files: [{ id: 2, note: "New", line: 1 }, { id: 1, note: "" }, { id: 99, note: "Lost" }, "junk"],
      }),
      PART_PLAN,
      PART,
      FILES,
    );
    expect(part).toMatchObject({
      before: "B",
      after: "Now.",
      summary: "In depth.",
      diagram: "sequenceDiagram\n  A->>B: hi",
      files: [{ path: "a.ts", note: "Old" }],
      alike: [{ path: "b.ts", note: "New", line: 1 }],
      deep: true,
    });
    expect(part.flow).toEqual([
      { depth: 0, change: "same", code: "go()", path: "a.ts", line: 2 },
      { depth: 6, change: "removed", code: "gone()", path: "b.ts", line: undefined },
      { depth: 0, change: "added", code: "x".repeat(160), path: undefined, line: undefined },
      { depth: 0, change: "same", code: "after()", path: undefined, line: undefined },
    ]);
  });

  it("keeps the part's own call path and diagram when the answer has none, and says when it can't read it", () => {
    expect(readPart(JSON.stringify({ files: [] }), PART_PLAN, PART, FILES)).toMatchObject({
      flow: PART.flow,
      diagram: PART.diagram,
      summary: "S",
    });
    expect(() => readPart("{}", PART_PLAN, PART, FILES)).toThrow("The AI's answer wasn't in the expected form.");
  });

  it("gives the part's title, what's known of it, and its files by id", () => {
    const { text, plan } = partMaterial(details, PART, FILES.slice(0, 2));
    expect(text).toContain("Part: Create");
    expect(text).toContain("What the walkthrough says about it: B A S");
    expect(text).toContain("[1] a.ts (+3 -1)\n[2] b.ts (+3 -1)");
    expect(text).toContain("## [2] b.ts");
    expect(plan).toEqual(PART_PLAN);
  });
});

describe("isPlan", () => {
  it.each([
    [{ paths: ["a"], kept: 1 }, true],
    [{ paths: [1], kept: 1 }, false],
    [{ paths: ["a"] }, false],
    [null, false],
  ])("tells a plan from %j", (value, expected) => {
    expect(isPlan(value)).toBe(expected);
  });
});

describe("readDiagram", () => {
  it("takes a flowchart, with or without a fence, and drops the settings and colors it could carry", () => {
    expect(
      readDiagram(
        "```mermaid\ngraph TD\n%%{init: {'theme':'forest'}}%%\n  classDef added fill:#cfc\n  style A fill:#fff\n  linkStyle 0 stroke:red\n  A --> B\n```",
      ),
    ).toBe(
      "graph TD\n  classDef added stroke:#1a7f37,stroke-width:2px\n  classDef removed stroke:#cf222e,stroke-dasharray:4 3\n  A --> B",
    );
  });

  it.each(["sequenceDiagram\n  A->>B: hi", "stateDiagram-v2\n  [*] --> Open", "erDiagram\n  ORDER ||--o{ LINE : has"])(
    "takes %s as it is",
    (source) => {
      expect(readDiagram(source)).toBe(source);
    },
  );

  it.each([
    ["anything else", "pie\n  a: 1"],
    ["a flowchart with nothing in it", "flowchart LR"],
    ["one that's too big", `flowchart LR\n${"  A --> B\n".repeat(500)}`],
    ["something that isn't text", 4],
    ["nothing", ""],
  ])("leaves out %s", (_, value) => {
    expect(readDiagram(value)).toBe("");
  });
});

describe("branches", () => {
  const at = (...depths: number[]) => depths.map((depth): Step => ({ depth, change: "same", code: "x" }));

  it("draws a tree from the depths", () => {
    expect(branches(at(0, 1, 2, 2, 1, 2, 0, 3))).toEqual([
      "",
      "├─ ",
      "│  ├─ ",
      "│  └─ ",
      "└─ ",
      "   └─ ",
      "",
      "      └─ ",
    ]);
  });
});

describe("asking the AI", () => {
  it("reviews and builds the walkthrough in one call, kept on disk under the pull request", async () => {
    setLanguage("pt-BR");
    const calls = asked();
    const split = { kept: FILES.slice(0, 1), leftOut: [] };
    await analyze(AI, details, split, { pull: "PR_1", head: "abc", run: "run-1" });
    setLanguage("en");
    const [args] = calls;
    expect(args).toMatchObject({
      run: "run-1",
      keep: {
        pull: "PR_1",
        kind: "analysis",
        key: "",
        head: "abc",
        meta: JSON.stringify({ paths: ["a.ts"], kept: 1, hashes: [fingerprint(TEN)], project: AI.ai.project }),
      },
    });
    expect(String(args!.task)).toContain("Review first. Review it like a careful senior engineer.");
    expect(String(args!.task)).toContain("in Brazilian Portuguese.");
    const schema = String(args!.schema);
    expect(schema.indexOf('"findings"')).toBeLessThan(schema.indexOf('"sections"'));
  });

  it("explains one part, kept under its walkthrough", async () => {
    const calls = asked();
    await deepen(AI, details, PART, FILES.slice(0, 2), { pull: "PR_1", head: "abc", run: "run-2", key: "run-1#0" });
    expect(calls[0]).toMatchObject({
      run: "run-2",
      keep: { kind: "part", key: "run-1#0", meta: JSON.stringify(PART_PLAN) },
    });
    expect(String(calls[0]!.task)).toContain("one part of this pull request");
  });
});

describe("updating after new commits", () => {
  const CHANGED = "@@ -0,0 +1,2 @@\n+changed\n+again";
  const base = (over: Partial<Base> = {}): Base => {
    const { plan } = material(
      details,
      { kept: FILES.slice(0, 4), leftOut: [{ reason: "tests", files: [TEST] }] },
      false,
    );
    const analysis: Analysis = read({
      overview: "Orders",
      diagram: "flowchart LR\n  A --> B",
      sections: [
        { title: "API", summary: "The endpoint.", files: [{ id: 1 }, { id: 2 }] },
        { title: "Store", summary: "x".repeat(300), files: [{ id: 3 }] },
        { title: "Glue", kind: "pattern", summary: "Wiring.", files: [], alike: { note: "Same", ids: [4] } },
      ],
      findings: [
        { id: 1, line: 1, severity: "issue", body: "Kept." },
        { id: 3, line: 2, severity: "suggestion", body: "Fixed\nlater." },
        { id: 2, line: 1, severity: "question", body: "On a changed file." },
        { id: 4, line: 1, severity: "issue", body: "Dismissed." },
      ],
    });
    return { id: "r1", plan, analysis, dismissed: new Set(["d.ts:1:Dismissed."]), ...over };
  };
  const now = { kept: [FILES[0]!, file("b.ts", CHANGED), FILES[2]!, FILES[3]!, file("g.ts", CHANGED)], leftOut: [] };

  it("fingerprints a patch the same way each time", () => {
    expect(fingerprint(TEN)).toBe(fingerprint(TEN));
    expect(fingerprint(TEN)).not.toBe(fingerprint(CHANGED));
  });

  it("sends only what changed, with the last walkthrough and its open comments", () => {
    const kept = [FILES[0]!, file("b.ts", CHANGED), FILES[2]!, file("g.ts", CHANGED)];
    const since = update(details, { kept, leftOut: [] }, false, base())!;
    expect(since.text).toContain("by id, new ones included:\n[2] b.ts (+3 -1)\n[4] g.ts (+3 -1)\n\n");
    expect(since.text).toContain("No longer in the pull request: d.ts");
    expect(since.text).toContain("S1. API: The endpoint.\n  [1] a.ts (+3 -1)\n  [2] b.ts (+3 -1)\nS2. Store: ");
    expect(since.text).toContain(`S2. Store: ${"x".repeat(200)}…\nS3. Glue: Wiring.`);
    expect(since.text).toContain("F1. a.ts:1 issue: Kept.\nF2. c.ts:2 suggestion: Fixed later.");
    expect(since.text).not.toContain("Dismissed.");
    expect(since.text).toContain("- b.ts:1 question: On a changed file.");
    expect(since.text).toContain("## [2] b.ts");
    expect(since.text).not.toContain("## [1] a.ts");
    expect(since.plan).toMatchObject({ base: "r1", fresh: [2, 4], project: false, kept: 4 });
  });

  it("says when nothing changed, and leaves out what has nothing to say", () => {
    const same = update(details, { kept: FILES.slice(0, 4), leftOut: [{ reason: "tests", files: [TEST] }] }, false, {
      ...base(),
      analysis: { ...base().analysis, review: { ...base().analysis.review, findings: [] } },
    })!;
    expect(same.text).toContain("Diff of the changed files, each cut to fit when it's long:\n(none)");
    expect(same.text).toContain("new ones included:\n(none)");
    expect(same.text).not.toContain("No longer in");
    expect(same.text).not.toContain("Open comments");
    expect(same.text).not.toContain("on the changed files");
    expect(same.plan.fresh).toEqual([]);
  });

  it("starts over when the last run can't be compared, read the project differently, or most of it changed", () => {
    expect(update(details, now, false, base({ plan: { paths: ["a.ts"], kept: 1 } }))).toBeNull();
    expect(update(details, now, true, base())).toBeNull();
    const most = { kept: FILES.slice(0, 4).map((f) => file(f.path, CHANGED)), leftOut: [] };
    expect(update(details, most, false, base())).toBeNull();
  });

  it("keeps the sections it's told are the same, rewrites the others, and keeps the comments not resolved", () => {
    const { plan } = update(details, now, false, base())!;
    const files = [...now.kept];
    const answer = {
      resolved: [2],
      sections: [
        { same: 2 },
        { title: "API again", summary: "Now with b.", files: [{ id: 2 }, { id: 1 }] },
        { same: 1 },
        { same: 9, title: "New", summary: "g.ts", files: [{ id: 5 }] },
      ],
      findings: [{ id: 2, line: 1, severity: "issue", body: "New one." }],
    };
    const result = readUpdate(JSON.stringify(answer), plan, files, SAID, base().analysis);
    expect(result.walkthrough.sections.map((s) => [s.title, pathsOf(s)])).toEqual([
      ["Store", ["c.ts"]],
      ["API again", ["b.ts", "a.ts"]],
      ["New", ["g.ts"]],
      ["Glue", ["d.ts"]],
    ]);
    expect(result.walkthrough.overview).toBe("Orders");
    expect(result.walkthrough.diagram).toContain("A --> B");
    expect(result.review.findings.map((f) => f.body)).toEqual(["Kept.", "Dismissed.", "New one."]);
    expect(result.review.findings.every((f) => f.inDiff)).toBe(true);
  });

  it("takes a new overview and picture, and sets aside a file nobody placed", () => {
    const { plan } = update(details, now, false, base())!;
    const answer = { overview: "Orders, now paged", diagram: "flowchart LR\n  A --> C", sections: [], findings: [] };
    const result = readUpdate(JSON.stringify(answer), plan, [...now.kept], SAID, base().analysis);
    expect(result.walkthrough.overview).toBe("Orders, now paged");
    expect(result.walkthrough.diagram).toContain("A --> C");
    expect(result.walkthrough.sections.map((s) => s.title || s.kind)).toEqual(["API", "Store", "Glue", "rest"]);
    expect(result.walkthrough.sections.at(-1)!.files.map((f) => f.path)).toEqual(["g.ts"]);
  });

  it("asks for an update when the last run fits, and for a whole new one when it doesn't", async () => {
    const calls = asked();
    const keep = { pull: "PR_1", head: "def", run: "run-2" };
    await analyze({ ...AI, ai: { ...AI.ai, project: false } }, details, now, keep, base());
    await analyze({ ...AI, ai: { ...AI.ai, project: true } }, details, now, keep, base());
    expect(String(calls[0]!.task)).toContain("got new commits since your last review");
    expect(String(calls[0]!.schema)).toContain('"resolved"');
    expect(String(calls[1]!.task)).toContain("Review first.");
  });

  it("reads less around each change when the AI reads the project, and skips what it can't place", () => {
    const projected = base({ plan: { ...base().plan, project: true } });
    expect(update(details, now, true, projected)!.text).toContain("## [2] b.ts\n@@ 1\n1 +changed");
    const { plan } = update(details, now, false, base())!;
    const loose = { ...plan, fresh: [99] };
    const answer = { sections: ["x", { same: 0, title: "", files: [] }], findings: [] };
    const result = readUpdate(JSON.stringify(answer), loose, [...now.kept], SAID, base().analysis);
    expect(result.review.findings.map((f) => f.body)).toContain("On a changed file.");
    const bare = { paths: plan.paths, kept: plan.kept };
    expect(readUpdate(JSON.stringify(answer), bare, [...now.kept], SAID, base().analysis).review.findings).toHaveLength(
      4,
    );
  });

  it("reads a plan with what it was built on", () => {
    expect(isPlan({ paths: [], kept: 0, hashes: ["a"], base: "r1", fresh: [1] })).toBe(true);
    expect(isPlan({ paths: [], kept: 0, hashes: [1] })).toBe(false);
    expect(isPlan({ paths: [], kept: 0, base: 1 })).toBe(false);
    expect(isPlan({ paths: [], kept: 0, fresh: ["1"] })).toBe(false);
    expect(isPlan({ paths: [], kept: 0, fresh: 1 })).toBe(false);
  });
});
