import { describe, expect, it } from "vitest";
import { normalize } from "./config";

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
    expect(config.pollSeconds).toBe(60);
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
});
