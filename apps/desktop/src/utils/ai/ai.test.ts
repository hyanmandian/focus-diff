import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vite-plus/test";

import { ask, askAboutLines, commentable, linesFromPatch, newRun, review } from "@/utils/ai/ai";
import { defaultConfig, type Config } from "@/utils/config/config";
import type { Details } from "@/utils/details/details";
import type { ReviewFile } from "@/utils/review/review";

const details: Details = {
  id: "PR_1",
  number: 7,
  title: "Fix the cart",
  url: "https://github.com/acme/web/pull/7",
  html: "<p>Totals were <b>wrong</b>.</p>",
  owner: "acme",
  repo: "web",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "fix-cart",
  headRefOid: "abc123",
  updatedAt: "2026-01-01T00:00:00Z",
  additions: 1,
  deletions: 1,
  changedFiles: 2,
  createdAt: "2026-01-01T00:00:00Z",
  author: null,
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
};

const patch = ["@@ -1,2 +1,2 @@", " keep", "-old", "+new"].join("\n");
const files: ReviewFile[] = [
  { path: "cart.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, patch },
  { path: "logo.png", previousPath: null, status: "added", additions: 0, deletions: 0, patch: "" },
];

/** Settings with the AI on (Claude), `ai` changing what it says. */
const withAi = (ai: Partial<Config["ai"]> = {}): Config => {
  const config = defaultConfig();
  return { ...config, ai: { ...config.ai, provider: "claude", project: false, ...ai } };
};

type Asked = { prompt: string; input: string; project: unknown; schema: string | null; run: string | null };
const isAsked = (args: unknown): args is Asked =>
  typeof args === "object" && args !== null && "prompt" in args && "input" in args;

/** Rust answering the AI with `text`, and the pull request's files from GitHub; what the AI was
 *  asked lands in the list returned. */
function agent(text: string) {
  const asked: Asked[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "ai_ask" && isAsked(args)) {
      asked.push(args);
      return { text, project: false };
    }
    return {
      status: 200,
      body: JSON.stringify([{ filename: "cart.ts", status: "modified", additions: 1, deletions: 1, patch }]),
    };
  });
  return asked;
}

/** What the one question asked carried. */
const only = (asked: Asked[]) => asked[0]!;

describe("commentable", () => {
  it("takes the lines the diff adds or shows, in the new file", () => {
    const text = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -10,4 +10,5 @@ fn",
      " same",
      "-gone",
      "+new",
      "+newer",
      " same",
      "\\ No newline at end of file",
      "@@ -40,2 +41,2 @@",
      " kept",
    ].join("\n");
    expect([...commentable(text)]).toEqual([10, 11, 12, 13, 41]);
  });
});

describe("linesFromPatch", () => {
  const text = ["@@ -10,3 +10,4 @@", " same", "-gone", "+new", "+newer", " end", "\\ No newline at end of file"].join(
    "\n",
  );

  it("takes the selected lines of the new version, or of the old", () => {
    expect(linesFromPatch(text, 11, 12)).toBe("+new\n+newer");
    expect(linesFromPatch(text, 11, 11, "deletions")).toBe("-gone");
    expect(linesFromPatch(text, 10, 12, "deletions")).toBe(" same\n-gone\n end");
  });
});

describe("asking the AI", () => {
  it("asks about the pull request with its description and diff, in plain text", async () => {
    const asked = agent("Looks fine.");
    const answer = await ask(withAi(), details, "Is it safe?", "run-1");
    expect(answer).toEqual({ text: "Looks fine.", project: false });
    const q = only(asked);
    expect(q.prompt).toContain("Is it safe?");
    expect(q.prompt).toContain("Plain text");
    expect(q.prompt).not.toContain("checked out");
    expect(q.input).toContain("Title: Fix the cart");
    expect(q.input).toContain("acme/web #7, fix-cart into main");
    expect(q.input).toContain("Description:\nTotals were wrong.");
    expect(q.input).toContain("+new");
    expect(q).toMatchObject({ project: null, schema: null, run: "run-1" });
  });

  it("lets it read the project, with the reviewer's own guidelines", async () => {
    const asked = agent("ok");
    await askAboutLines(
      withAi({ project: true, instructions: "  Be brief.  " }),
      details,
      files,
      "cart.ts",
      2,
      2,
      "additions",
      "Why?",
    );
    const q = only(asked);
    expect(q.prompt).toContain("checked out");
    expect(q.prompt).toContain("The reviewer's own guidelines, to follow:\nBe brief.");
    expect(q.project).toEqual({ repo: "acme/web", number: 7, head: "abc123" });
    // A file with no patch says so; a description with none says that.
    expect(q.input).toContain("logo.png: (no patch: binary or too large)");
  });

  it("says where the lines asked about are, with what was asked before", async () => {
    const asked = agent("ok");
    await askAboutLines(withAi(), { ...details, html: "" }, files, "cart.ts", 1, 2, "deletions", "And now?", [
      { question: "What's this?", answer: "A total." },
    ]);
    const q = only(asked);
    expect(q.prompt).toContain("cart.ts, lines 1–2 of the old version:\n\n keep\n-old");
    expect(q.prompt).toContain("Q: What's this?\nA: A total.");
    expect(q.prompt).toContain("Their question about it now: And now?");
    expect(q.input).toContain("Description:\n(none)");
  });

  it("asks about a file it doesn't have with no lines to show", async () => {
    const asked = agent("ok");
    await askAboutLines(withAi(), details, files, "gone.ts", 3, 3, "additions", "Hm?");
    expect(only(asked).prompt).toContain("gone.ts, line 3 of the new version:\n\n\n\nTheir question");
  });

  it("refuses with the AI off", async () => {
    agent("ok");
    await expect(ask(defaultConfig(), details, "Hi")).rejects.toThrow("Turn on AI in Settings first.");
  });

  it("gives each question an id to stop it by", () => {
    expect(newRun()).not.toBe(newRun());
  });
});

describe("the AI review", () => {
  it("reads the findings, marking those on a line of the diff", async () => {
    const asked = agent(
      JSON.stringify({
        summary: "Fixes totals.",
        findings: [
          { path: "cart.ts", line: 2, severity: "question", body: " Why? " },
          { path: "cart.ts", line: 40.2, severity: "suggestion", body: "Elsewhere" },
          { path: "other.ts", line: 1, severity: "nonsense", body: "Not in the diff" },
          { path: "cart.ts", line: 1, body: "   " },
          { path: "cart.ts", line: "1", body: "Bad line" },
          { line: 1, body: "No path" },
          { path: "cart.ts", line: 1, body: 5 },
          "junk",
          null,
        ],
      }),
    );
    const result = await review(withAi(), details, files);
    expect(result).toMatchObject({
      summary: "Fixes totals.",
      project: false,
      findings: [
        { path: "cart.ts", line: 2, severity: "question", body: "Why?", inDiff: true },
        { path: "cart.ts", line: 40, severity: "suggestion", body: "Elsewhere", inDiff: false },
        { path: "other.ts", line: 1, severity: "issue", body: "Not in the diff", inDiff: false },
      ],
    });
    expect(only(asked).schema).toContain('"findings"');
  });

  it("has no summary or findings when the answer leaves them out", async () => {
    agent("{}");
    expect(await review(withAi(), details, files)).toMatchObject({ summary: "", findings: [] });
  });

  it("refuses an answer that isn't the form asked for", async () => {
    agent("Sure! Here's my review:");
    await expect(review(withAi(), details, files)).rejects.toThrow("The AI's answer wasn't in the expected form.");
    agent("null");
    await expect(review(withAi(), details, files)).rejects.toThrow("The AI's answer wasn't in the expected form.");
  });
});
