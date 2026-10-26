import { describe, expect, it, vi } from "vitest";
import { bridge, github } from "./bridge";
import { fill, runAction } from "./actions";
import type { Action } from "./config";

vi.mock("./bridge", () => ({ github: vi.fn(async () => ({})), bridge: { openUrl: vi.fn(async () => {}), runAction: vi.fn(async () => "sent") } }));

const pr = { number: 7, repo: "acme/web", title: "Fix a & b", url: "https://github.com/acme/web/pull/7", author: "ana", me: "me" };

describe("fill", () => {
  it("fills text, and encodes values inside links", () => {
    expect(fill("@{author}: #{number} {title}", pr)).toBe("@ana: #7 Fix a & b");
    expect(fill("https://x.test/?q={title}", pr, true)).toBe("https://x.test/?q=Fix%20a%20%26%20b");
    expect(fill("{url}/files", pr, true)).toBe("https://github.com/acme/web/pull/7/files");
    expect(fill("{nope}", pr)).toBe("{nope}");
  });
});

describe("runAction", () => {
  it("runs the steps in order and stops at a failure", async () => {
    const action: Action = {
      id: "a",
      name: "Hand off",
      confirm: false,
      choices: [],
      steps: [
        { kind: "request", reviewers: ["dana", "acme/frontend"] },
        { kind: "unrequestMe" },
        { kind: "comment", body: "@dana over to you ({title})" },
        { kind: "run", command: "ignored here" },
      ],
    };
    expect(await runAction(action, pr)).toBe("Hand off: sent");
    expect(vi.mocked(github).mock.calls).toEqual([
      ["POST", "/repos/acme/web/pulls/7/requested_reviewers", { reviewers: ["dana"], team_reviewers: ["frontend"] }],
      ["DELETE", "/repos/acme/web/pulls/7/requested_reviewers", { reviewers: ["me"], team_reviewers: [] }],
      ["POST", "/repos/acme/web/issues/7/comments", { body: "@dana over to you (Fix a & b)" }],
    ]);
    expect(vi.mocked(bridge.runAction)).toHaveBeenCalledWith(action, 3, pr);

    vi.mocked(github).mockClear().mockRejectedValueOnce(new Error("Not Found"));
    await expect(runAction(action, pr)).rejects.toThrow("Ask for reviews: Not Found");
    expect(vi.mocked(github)).toHaveBeenCalledTimes(1);
  });
});
