import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vite-plus/test";

import {
  canBe,
  choiceAction,
  defaultConfig,
  filterRecipes,
  inFilter,
  isRepoPattern,
  loadConfig,
  newAction,
  nextReviewTime,
  normalize,
  saveConfig,
  sourceOf,
  TEMPLATES,
  validPattern,
  withSource,
} from "@/utils/config/config";
import { i18n } from "@/utils/i18n/i18n";

describe("normalize", () => {
  it("falls back to the defaults for anything broken", () => {
    expect(normalize(null).queues).toHaveLength(3);
    expect(normalize({ queues: "nope" }).queues).toHaveLength(3);
  });

  it("keeps valid fields and drops bad ones", () => {
    const config = normalize({
      pollSeconds: 5,
      theme: "neon",
      queues: [
        {
          id: "a",
          kind: "review",
          name: "  Mine  ",
          repos: ["acme/web", "not a repo", "acme/*"],
          includePaths: "(",
          notify: ["new", "explode"],
          tone: "pink",
        },
      ],
    });
    const [q] = config.queues;
    expect(config.pollSeconds).toBe(30);
    expect(config.theme).toBe("system");
    expect(q?.name).toBe("Mine");
    expect(q?.repos).toEqual(["acme/web", "acme/*"]);
    expect(q?.includePaths).toBe("");
    expect(q?.notify).toEqual(["new"]);
    expect(q?.tone).toBe("blue");
  });

  it("makes queue ids unique", () => {
    const config = normalize({
      queues: [
        { id: "x", kind: "review" },
        { id: "x", kind: "authored" },
      ],
    });
    expect(new Set(config.queues.map((q) => q.id)).size).toBe(2);
  });

  it("keeps only Claude Code and Cursor, and filters with valid patterns", () => {
    const config = normalize({
      ai: { provider: "codex", effort: "minimal" },
      filters: [{ name: "Web", include: "\\.tsx$", exclude: "(" }],
    });
    expect(config.ai.provider).toBeNull();
    expect(config.ai.effort).toBe("");
    expect(config.ai.project).toBe(true);
    expect(config.filters).toMatchObject([{ name: "Web", include: "\\.tsx$", exclude: "", repos: [] }]);
  });

  it("keeps a filter's repositories only as owner/name or owner/*", () => {
    const config = normalize({ filters: [{ name: "Pay", repos: ["acme/web", "acme/*", "acme", "a/b/c", 4] }] });
    expect(config.filters[0]?.repos).toEqual(["acme/web", "acme/*"]);
  });
});

describe("notifications and review time", () => {
  it("keeps what a queue's notifications leave out, and where", () => {
    const [review, custom] = normalize({
      queues: [
        {
          id: "a",
          kind: "review",
          notify: ["new", "ready"],
          notifyLeaveOut: ["bots", "bots", "nope"],
          notifyRepos: ["acme/*", "bad repo"],
        },
        { id: "b", kind: "custom", notifyAt: "later" },
      ],
    }).queues;
    expect(review?.notify).toEqual(["new", "ready"]);
    expect(review?.notifyLeaveOut).toEqual(["bots"]);
    expect(review?.notifyRepos).toEqual(["acme/*"]);
    // Review requests wait for review time unless told otherwise; the rest show right away.
    expect(review?.notifyAt).toBe("review");
    expect(custom?.notifyAt).toBe("now");
  });

  it("cleans up review times", () => {
    const { reviewTime } = normalize({
      reviewTime: {
        enabled: true,
        sessions: [
          { id: "x", days: [5, 1, 9, 1], times: ["15:00", "25:00", "09:30"], minutes: 1000, order: "random" },
          { id: "x" },
        ],
      },
    });
    const [first, second] = reviewTime.sessions;
    expect(first).toMatchObject({ days: [1, 5], times: ["09:30", "15:00"], minutes: 240, order: "oldest", on: true });
    expect(second?.id).not.toBe("x");
    expect(normalize({}).reviewTime).toMatchObject({
      enabled: false,
      sessions: [],
      againFirst: true,
      remindEnd: true,
      skipEmpty: true,
    });
  });

  it("finds the next review time, over the weekend too", () => {
    const { reviewTime } = normalize({
      reviewTime: {
        enabled: true,
        sessions: [{ id: "a", name: "Afternoon", days: [1, 2, 3, 4, 5], times: ["15:00"], minutes: 30 }],
      },
    });
    // Friday 2026-01-09, before and after.
    expect(nextReviewTime(reviewTime, new Date(2026, 0, 9, 14, 0))?.at).toEqual(new Date(2026, 0, 9, 15, 0));
    expect(nextReviewTime(reviewTime, new Date(2026, 0, 9, 15, 0))?.at).toEqual(new Date(2026, 0, 12, 15, 0));
    expect(nextReviewTime({ ...reviewTime, enabled: false }, new Date(2026, 0, 9))).toBeNull();
  });
});

describe("inFilter", () => {
  it("includes, then leaves out", () => {
    const frontend = { include: "\\.(tsx?|css)$", exclude: "\\.test\\." };
    expect(inFilter(frontend, "src/app.tsx")).toBe(true);
    expect(inFilter(frontend, "src/app.test.tsx")).toBe(false);
    expect(inFilter(frontend, "api/main.go")).toBe(false);
    expect(inFilter({ include: "", exclude: "" }, "anything")).toBe(true);
    // Case doesn't matter, as in Focus Diff.
    expect(inFilter({ include: "dockerfile", exclude: "" }, "Dockerfile")).toBe(true);
    expect(inFilter({ include: "", exclude: "\\.lock$" }, "Cargo.lock")).toBe(false);
  });

  it("keeps every file when a pattern is broken", () => {
    expect(inFilter({ include: "(", exclude: "" }, "a.ts")).toBe(true);
    expect(inFilter({ include: "\\.ts$", exclude: "[" }, "a.ts")).toBe(true);
    // A file the include leaves out stays out, whatever the exclude.
    expect(inFilter({ include: "\\.go$", exclude: "[" }, "a.ts")).toBe(false);
  });

  it("takes patterns the u flag would refuse, as Focus Diff writes them", () => {
    expect(validPattern("\\-generated")).toBe(true);
    expect(inFilter({ include: "\\-generated", exclude: "" }, "api-generated.ts")).toBe(true);
  });
});

describe("patterns", () => {
  it("tells valid regular expressions, empty counting as one", () => {
    expect(validPattern("")).toBe(true);
    expect(validPattern("a+")).toBe(true);
    expect(validPattern("(")).toBe(false);
  });

  it("tells repository patterns", () => {
    expect(isRepoPattern("acme/web")).toBe(true);
    expect(isRepoPattern("acme/*")).toBe(true);
    expect(isRepoPattern("acme")).toBe(false);
    expect(isRepoPattern("acme/*/x")).toBe(false);
  });
});

describe("a queue's source", () => {
  it("reads each kind as a state and a part", () => {
    expect(sourceOf(TEMPLATES.review.make())).toEqual({ state: "open", part: "review" });
    expect(sourceOf(TEMPLATES.involved.make())).toEqual({ state: "open", part: "involved" });
    expect(sourceOf(TEMPLATES.authored.make())).toEqual({ state: "open", part: "authored" });
    expect(sourceOf(TEMPLATES.custom.make())).toEqual({ state: "open", part: "any" });
    expect(sourceOf(TEMPLATES.merged.make())).toEqual({ state: "merged", part: "review" });
    expect(sourceOf({ ...TEMPLATES.merged.make(), requestedOnly: false })).toEqual({ state: "merged", part: "any" });
  });

  it("takes merged ones only as asked of you, or anyone's", () => {
    expect(canBe("open", "authored")).toBe(true);
    expect(canBe("merged", "review")).toBe(true);
    expect(canBe("merged", "any")).toBe(true);
    expect(canBe("merged", "involved")).toBe(false);
  });

  it("turns into the queue for another pair, as near as it can", () => {
    const queue = TEMPLATES.review.make();
    expect(withSource(queue, "merged", "review")).toMatchObject({ kind: "merged", requestedOnly: true });
    expect(withSource(queue, "merged", "authored")).toMatchObject({ kind: "merged", requestedOnly: false });
    expect(withSource(queue, "open", "any")).toMatchObject({ kind: "custom", id: queue.id });
    expect(withSource(queue, "open", "involved")).toMatchObject({ kind: "involved" });
  });
});

describe("starting points", () => {
  const t = i18n();

  it("names the filter recipes in words", () => {
    const [stack] = filterRecipes(t);
    expect(stack).toEqual({
      title: "Frontend and backend",
      description: "Review each side of a full-stack change on its own.",
      filters: [
        expect.objectContaining({ name: "Frontend" }),
        expect.objectContaining({ name: "Backend", include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$" }),
      ],
    });
    expect(filterRecipes(t)).toHaveLength(7);
  });

  it("makes a new action as a script", () => {
    expect(newAction(t)).toMatchObject({
      name: "Script",
      confirm: false,
      steps: [{ kind: "run", command: 'echo "$PR_URL"' }],
      choices: [],
    });
  });

  it("runs a menu action's choice as an action of its own", () => {
    const action = { id: "a", name: "Delegate", confirm: true, steps: [], choices: [] };
    const choice = { id: "c", name: "Ana", steps: [{ kind: "label" as const, labels: ["ana"] }] };
    expect(choiceAction(action, choice)).toEqual({
      id: "c",
      name: "Delegate · Ana",
      confirm: true,
      steps: choice.steps,
      choices: [],
    });
  });
});

describe("actions, prompts and filters on disk", () => {
  it("keeps each kind of step, cleaned up, and drops what isn't one", () => {
    const [action] = normalize({
      actions: [
        {
          id: "act",
          name: "  Ship  ",
          confirm: true,
          steps: [
            { kind: "comment", body: "LGTM" },
            { kind: "comment" },
            { kind: "request", reviewers: ["ana", "acme/web", "not valid!"] },
            { kind: "unrequestMe" },
            { kind: "label", labels: [" ready ", "", 3] },
            { kind: "open", url: "https://x.test/{number}" },
            { kind: "run", command: "make" },
            { kind: "explode" },
            "nope",
          ],
        },
      ],
    }).actions;
    expect(action).toEqual({
      id: "act",
      name: "Ship",
      confirm: true,
      choices: [],
      steps: [
        { kind: "comment", body: "LGTM" },
        { kind: "comment", body: "" },
        { kind: "request", reviewers: ["ana", "acme/web"] },
        { kind: "unrequestMe" },
        { kind: "label", labels: ["ready"] },
        { kind: "open", url: "https://x.test/{number}" },
        { kind: "run", command: "make" },
      ],
    });
  });

  it("names what has no name, and gives it an id", () => {
    const config = normalize({
      actions: [{ id: "bad id!", choices: [{ steps: "nope" }, null] }, null],
      filters: [{ include: "\\.go$" }, "nope"],
      ai: { prompts: [{ prompt: "Why?" }, { name: "Empty", prompt: "  " }, { name: "None" }, 4] },
    });
    expect(config.actions).toHaveLength(1);
    expect(config.actions[0]).toMatchObject({ name: "Action", confirm: false, steps: [] });
    expect(config.actions[0]?.id).not.toBe("bad id!");
    expect(config.actions[0]?.choices).toMatchObject([{ name: "Action", steps: [] }]);
    expect(config.filters).toMatchObject([{ name: "Filter", include: "\\.go$", exclude: "", repos: [] }]);
    expect(config.ai.prompts).toMatchObject([{ name: "Ask", prompt: "Why?" }]);
  });

  it("keeps named prompts and choices as they are", () => {
    const config = normalize({
      actions: [
        { id: "a", name: "Delegate", choices: [{ id: "c1", name: " Ana ", steps: [{ kind: "unrequestMe" }] }] },
      ],
      ai: { prompts: [{ id: "p1", name: " Risks ", prompt: "Any risks?" }] },
    });
    expect(config.actions[0]?.choices).toEqual([{ id: "c1", name: "Ana", steps: [{ kind: "unrequestMe" }] }]);
    expect(config.ai.prompts).toEqual([{ id: "p1", name: "Risks", prompt: "Any risks?" }]);
  });

  it("keeps action ids apart from queue ids", () => {
    const config = normalize({ queues: [{ id: "x", kind: "review" }], actions: [{ id: "x" }, { id: "x" }] });
    const ids = [...config.queues, ...config.actions].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
    expect(config.queues[0]?.id).toBe("x");
  });

  it("starts with the default prompts and filters, and no actions", () => {
    const config = normalize({});
    expect(config.actions).toEqual([]);
    expect(config.ai.prompts.map((p) => p.id)).toEqual(["summary", "risks", "explain", "tests"]);
    expect(config.filters.map((f) => f.id)).toEqual(["frontend", "backend", "no-generated"]);
  });
});

describe("queues and the AI on disk", () => {
  it("keeps a queue's people, teams and search, cleaned up", () => {
    const [queue, unnamed] = normalize({
      queues: [
        {
          id: "q",
          kind: "merged",
          teams: ["acme/web", "acme"],
          skipApprovedBy: ["ana", "dependabot[bot]", "not a login"],
          skipMergedBy: ["bea", "x y"],
          query: "label:urgent",
          mergedDays: 90,
        },
        { kind: "authored", query: 3, notify: "new" },
        "nope",
      ],
    }).queues;
    expect(queue).toMatchObject({
      id: "q",
      kind: "merged",
      name: "Merged",
      teams: ["acme/web"],
      skipApprovedBy: ["ana", "dependabot[bot]"],
      skipMergedBy: ["bea"],
      query: "label:urgent",
      mergedDays: 30,
      requestedOnly: true,
    });
    expect(unnamed).toMatchObject({ kind: "authored", query: "", notify: [] });
    expect(unnamed?.id).toBeTypeOf("string");
  });

  it("keeps the AI's settings, cleaned up", () => {
    const { ai } = normalize({
      ai: {
        provider: "cursor",
        model: "  sonnet  ",
        effort: "high",
        instructions: "Be brief.",
        project: false,
        review: { auto: true, prompt: "Only bugs." },
      },
    });
    expect(ai).toMatchObject({
      provider: "cursor",
      model: "sonnet",
      effort: "high",
      instructions: "Be brief.",
      project: false,
      review: { auto: true, prompt: "Only bugs." },
    });
    const blank = normalize({ ai: { review: { prompt: "  " } } }).ai;
    expect(blank.review).toEqual({ auto: false, prompt: defaultConfig().ai.review.prompt });
    expect(blank).toMatchObject({ model: "", instructions: "" });
  });

  it("gives a review time without an id one, and drops what isn't one", () => {
    const { sessions } = normalize({ reviewTime: { sessions: [{ name: " Morning " }, "nope"] } }).reviewTime;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ name: "Morning", days: [1, 2, 3, 4, 5], times: ["15:00"], minutes: 30 });
    expect(sessions[0]?.id).toMatch(/^[\w-]+$/u);
  });
});

const review = (sessions: Array<{ id: string; times: string[]; on?: boolean }>) =>
  normalize({ reviewTime: { enabled: true, sessions: sessions.map((s) => ({ days: [5], ...s })) } }).reviewTime;

describe("the next review time", () => {
  // Friday 2026-01-09, in the morning.
  const friday = new Date(2026, 0, 9, 9, 0);

  it("takes the earliest of the day's sessions", () => {
    expect(
      nextReviewTime(
        review([
          { id: "late", times: ["16:00"] },
          { id: "early", times: ["15:00"] },
        ]),
        friday,
      ),
    ).toMatchObject({ session: { id: "early" }, at: new Date(2026, 0, 9, 15, 0) });
    expect(
      nextReviewTime(
        review([
          { id: "early", times: ["15:00"] },
          { id: "late", times: ["16:00"] },
        ]),
        friday,
      ),
    ).toMatchObject({ session: { id: "early" } });
  });

  it("skips sessions that are off, and finds none a week on", () => {
    expect(nextReviewTime(review([{ id: "off", times: ["15:00"], on: false }]), friday)).toBeNull();
  });
});

/** Rust with this file in the config folder; `written` gets what's saved. */
function disk(text: string | null) {
  const written: string[] = [];
  mockIPC((cmd, args?: InvokeArgs) => {
    const sent =
      args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array) ? args : {};
    if (cmd === "write_file") written.push(String(sent.contents));
    return cmd === "read_file" ? text : null;
  });
  return written;
}

describe("the settings file", () => {
  it("starts with the defaults, saved at once so the queue ids last", async () => {
    const written = disk(null);
    const config = await loadConfig();
    expect(config.queues.map((q) => q.kind)).toEqual(["review", "involved", "authored"]);
    expect(written).toHaveLength(1);
    expect(JSON.parse(written[0]!)).toEqual(config);
  });

  it("reads the file through normalize", async () => {
    const written = disk(JSON.stringify({ pollSeconds: 120, theme: "dark" }));
    await expect(loadConfig()).resolves.toMatchObject({ pollSeconds: 120, theme: "dark" });
    expect(written).toEqual([]);
  });

  it("falls back to the defaults for a broken file, leaving it be", async () => {
    const written = disk("{ broken");
    await expect(loadConfig()).resolves.toMatchObject({ pollSeconds: 60, theme: "system" });
    expect(written).toEqual([]);
  });

  it("saves the settings cleaned up", async () => {
    const written = disk(null);
    await saveConfig({ ...defaultConfig(), pollSeconds: 1 });
    expect(JSON.parse(written[0]!)).toMatchObject({ pollSeconds: 30 });
  });
});
