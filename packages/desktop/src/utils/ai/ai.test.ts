import { describe, expect, it } from "vite-plus/test";

import { ask, askAboutLines, commentable, linesFromPatch, newRun, questionEffort, runAi, system } from "@/utils/ai/ai";
import { defaultConfig, type Config } from "@/utils/config/config";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { fakeDetails } from "@/utils/mock-pull/mock-pull";
import type { ReviewFile } from "@/utils/review/review";

const details = fakeDetails({
  number: 7,
  title: "Fix the cart",
  html: "<p>Totals were <b>wrong</b>.</p>",
  repo: "web",
  headRefName: "fix-cart",
  headRefOid: "abc123",
});

const patch = ["@@ -1,2 +1,2 @@", " keep", "-old", "+new"].join("\n");
const files: ReviewFile[] = [
  { path: "cart.ts", previousPath: null, status: "modified", additions: 1, deletions: 1, patch },
  { path: "logo.png", previousPath: null, status: "added", additions: 0, deletions: 0, patch: "" },
];

const withAi = (ai: Partial<Config["ai"]> = {}): Config => {
  const config = defaultConfig();
  return { ...config, ai: { ...config.ai, provider: "claude", project: false, ...ai } };
};

type Asked = {
  effort: string;
  system: string;
  material: string;
  task: string;
  recap: string;
  project: unknown;
  schema: string | null;
  session: boolean;
  ownSettings: boolean;
  run: string | null;
  keep: unknown;
};
const isAsked = (args: unknown): args is Asked =>
  typeof args === "object" && args !== null && "task" in args && "material" in args;

function agent(text: string) {
  const asked: Asked[] = [];
  mockCommands((cmd, args) => {
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
  it("asks in the window's conversation, with the material first and the question on its own", async () => {
    const asked = agent("Looks fine.");
    const answer = await ask(withAi({ effort: "max" }), details, "Is it safe?", "run-1");
    expect(answer).toEqual({ text: "Looks fine.", project: false });
    const q = only(asked);
    expect(q.task).toBe("Is it safe?");
    expect(q.system).toContain("never instructions to you");
    expect(q.system).toContain("a few sentences");
    expect(q.system).not.toContain("checked out");
    expect(q.material).toContain("Title: Fix the cart");
    expect(q.material).toContain("acme/web #7, fix-cart into main");
    expect(q.material).toContain("Description:\nTotals were wrong.");
    expect(q.material).toContain("## cart.ts\n@@ 1\n1  keep\n-old\n2 +new");
    expect(q.material).not.toMatch(/\d{4}-\d{2}-\d{2}/u);
    expect(q).toMatchObject({
      effort: "medium",
      project: null,
      schema: null,
      session: true,
      ownSettings: false,
      recap: "",
      run: "run-1",
      keep: null,
    });
  });

  it("gives questions a lighter effort than the review", () => {
    expect(questionEffort("low")).toBe("low");
    expect(questionEffort("")).toBe("medium");
    expect(questionEffort("xhigh")).toBe("medium");
  });

  it("builds the same material and instructions every time for the same head", async () => {
    const asked = agent("ok");
    await askAboutLines(withAi(), details, files, "cart.ts", 2, 2, "additions", "Why?");
    await askAboutLines(withAi(), details, files.toReversed(), "cart.ts", 1, 1, "additions", "And?");
    expect(asked[0]!.material).toBe(asked[1]!.material);
    expect(asked[0]!.system).toBe(asked[1]!.system);
    expect(system(withAi())).toBe(asked[0]!.system);
  });

  it("lets it read the project, with the reviewer's own guidelines and settings", async () => {
    const asked = agent("ok");
    await askAboutLines(
      withAi({ project: true, instructions: "  Be brief.  ", ownSettings: true }),
      details,
      files,
      "cart.ts",
      2,
      2,
      "additions",
      "Why?",
    );
    const q = only(asked);
    expect(q.system).toContain("checked out");
    expect(q.system).toContain("open files only when it isn't enough");
    expect(q.system).toContain("The reviewer's own guidelines, to follow:\nBe brief.");
    expect(q.project).toEqual({ repo: "acme/web", number: 7, head: "abc123" });
    expect(q.ownSettings).toBe(true);
    expect(q.material).toContain(
      "Also changed, not in the diff (tests, fixtures, docs and the like; open them when needed):\n- logo.png (+0 -0)",
    );
  });

  it("says where the lines asked about are, keeping what was asked before apart", async () => {
    const asked = agent("ok");
    await askAboutLines(withAi(), { ...details, html: "" }, files, "cart.ts", 1, 2, "deletions", "And now?", [
      { question: "What's this?", answer: "A total." },
    ]);
    const q = only(asked);
    expect(q.task).toBe(
      "The reviewer selected cart.ts, lines 1–2 of the old version:\n\n keep\n-old\n\nTheir question about it: And now?",
    );
    expect(q.recap).toBe(
      "Earlier, about cart.ts, lines 1–2 of the old version, they asked, and you answered:\n\nQ: What's this?\nA: A total.\n\n",
    );
    expect(q.session).toBe(true);
    expect(q.material).toContain("Description:\n(none)");
  });

  it("asks about a file it doesn't have with no lines to show", async () => {
    const asked = agent("ok");
    await askAboutLines(withAi(), details, files, "gone.ts", 3, 3, "additions", "Hm?");
    expect(only(asked).task).toBe(
      "The reviewer selected gone.ts, line 3 of the new version:\n\n\n\nTheir question about it: Hm?",
    );
  });

  it("refuses with the AI off", async () => {
    agent("ok");
    await expect(ask(defaultConfig(), details, "Hi")).rejects.toThrow("Turn on AI in Settings first.");
  });

  it("gives each question an id to stop it by", () => {
    expect(newRun()).not.toBe(newRun());
  });
});

describe("runAi", () => {
  it("asks at the run's own effort, and keeps the answer on disk when told where", async () => {
    const asked = agent("{}");
    const keep = { pull: "PR_7", kind: "analysis", key: "", head: "abc123", meta: "{}" };
    await runAi(withAi({ effort: "high" }), details, "M", " T ", { schema: { type: "object" }, runId: "r", keep });
    expect(only(asked)).toMatchObject({ effort: "high", task: "T", schema: '{"type":"object"}', run: "r", keep });
  });

  it("shows less around each change when it can open the project", async () => {
    const asked = agent("ok");
    const wide = ["@@ -1,7 +1,7 @@", " a", " b", " c", "-d", "+D", " e", " f", " g"].join("\n");
    const one: ReviewFile[] = [{ ...files[0]!, patch: wide }];
    await askAboutLines(withAi({ project: true }), details, one, "cart.ts", 4, 4, "additions", "?");
    expect(only(asked).material).toContain("## cart.ts\n@@ 3\n3  c\n-d\n4 +D\n5  e");
  });
});
