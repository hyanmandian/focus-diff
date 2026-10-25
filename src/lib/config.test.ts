import { describe, expect, it } from "vitest";
import { inFilter, normalize } from "./config";

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
    expect(config.filters).toMatchObject([{ name: "Web", include: "\\.tsx$", exclude: "" }]);
  });
});

describe("inFilter", () => {
  it("includes, then leaves out", () => {
    const frontend = { include: "\\.(tsx?|css)$", exclude: "\\.test\\." };
    expect(inFilter(frontend, "src/app.tsx")).toBe(true);
    expect(inFilter(frontend, "src/app.test.tsx")).toBe(false);
    expect(inFilter(frontend, "api/main.go")).toBe(false);
    expect(inFilter({ include: "", exclude: "" }, "anything")).toBe(true);
  });
});
