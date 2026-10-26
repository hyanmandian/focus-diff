import { describe, expect, it } from "vitest";
import { inFilter, nextReviewTime, normalize } from "@/utils/config/config";

describe("normalize", () => {
  it("falls back to the defaults for anything broken", () => {
    expect(normalize(null).queues).toHaveLength(3);
    expect(normalize({ queues: "nope" }).queues).toHaveLength(3);
  });

  it("keeps valid fields and drops bad ones", () => {
    const config = normalize({
      pollSeconds: 5,
      theme: "neon",
      queues: [{ id: "a", kind: "review", name: "  Mine  ", repos: ["acme/web", "not a repo", "acme/*"], includePaths: "(", notify: ["new", "explode"], tone: "pink" }],
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
    const config = normalize({ queues: [{ id: "x", kind: "review" }, { id: "x", kind: "authored" }] });
    expect(new Set(config.queues.map((q) => q.id)).size).toBe(2);
  });

  it("keeps only Claude Code and Cursor, and filters with valid patterns", () => {
    const config = normalize({ ai: { provider: "codex", effort: "minimal" }, filters: [{ name: "Web", include: "\\.tsx$", exclude: "(" }] });
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
        { id: "a", kind: "review", notify: ["new", "ready"], notifyLeaveOut: ["bots", "bots", "nope"], notifyRepos: ["acme/*", "bad repo"] },
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
      reviewTime: { enabled: true, sessions: [{ id: "x", days: [5, 1, 9, 1], times: ["15:00", "25:00", "09:30"], minutes: 1000, order: "random" }, { id: "x" }] },
    });
    const [first, second] = reviewTime.sessions;
    expect(first).toMatchObject({ days: [1, 5], times: ["09:30", "15:00"], minutes: 240, order: "oldest", on: true });
    expect(second?.id).not.toBe("x");
    expect(normalize({}).reviewTime).toMatchObject({ enabled: false, sessions: [], againFirst: true, remindEnd: true, skipEmpty: true });
  });

  it("finds the next review time, over the weekend too", () => {
    const { reviewTime } = normalize({ reviewTime: { enabled: true, sessions: [{ id: "a", name: "Afternoon", days: [1, 2, 3, 4, 5], times: ["15:00"], minutes: 30 }] } });
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
  });
});
