import { describe, expect, it } from "vite-plus/test";

import { fill, runAction } from "@/utils/actions/actions";
import type { Action, ActionStep } from "@/utils/config/config";
import { fieldsOf, mockCommands } from "@/utils/fake-platform/fake-platform";

const pr = {
  number: 7,
  repo: "acme/web",
  title: "Fix a & b",
  url: "https://github.com/acme/web/pull/7",
  author: "ana",
  me: "me",
};

const action = (steps: ActionStep[]): Action => ({ id: "a", name: "Hand off", confirm: false, choices: [], steps });

function rust(answers: { github?: { status: number; body: string }; run?: string; refuse?: string } = {}) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  mockCommands((cmd, args) => {
    calls.push({ cmd, args: fieldsOf(args) });
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Rust's errors reach the page as strings
    if (answers.refuse !== undefined) return Promise.reject(answers.refuse);
    if (cmd === "github") return answers.github ?? { status: 200, body: "{}" };
    if (cmd === "run_action") return answers.run ?? "";
    return null;
  });
  const github = () =>
    calls
      .filter((c) => c.cmd === "github")
      .map((c) => [c.args.method, c.args.path, JSON.parse(String(c.args.body)) as unknown]);
  return { calls, github };
}

describe("fill", () => {
  it("fills text, and encodes values inside links", () => {
    expect(fill("@{author}: #{number} {title}", pr)).toBe("@ana: #7 Fix a & b");
    expect(fill("https://x.test/?q={title}", pr, true)).toBe("https://x.test/?q=Fix%20a%20%26%20b");
    expect(fill("{url}/files", pr, true)).toBe("https://github.com/acme/web/pull/7/files");
    expect(fill("{nope}", pr)).toBe("{nope}");
  });
});

describe("runAction", () => {
  it("runs the steps in order and says what the command said", async () => {
    const ipc = rust({ run: "sent" });
    const handOff = action([
      { kind: "request", reviewers: ["dana", "acme/frontend"] },
      { kind: "unrequestMe" },
      { kind: "comment", body: "@dana over to you ({title})" },
      { kind: "label", labels: ["ready"] },
      { kind: "open", url: " https://x.test/{number} " },
      { kind: "run", command: "ignored here" },
    ]);
    expect(await runAction(handOff, pr)).toBe("Hand off: sent");
    expect(ipc.github()).toEqual([
      ["POST", "/repos/acme/web/pulls/7/requested_reviewers", { reviewers: ["dana"], team_reviewers: ["frontend"] }],
      ["DELETE", "/repos/acme/web/pulls/7/requested_reviewers", { reviewers: ["me"], team_reviewers: [] }],
      ["POST", "/repos/acme/web/issues/7/comments", { body: "@dana over to you (Fix a & b)" }],
      ["POST", "/repos/acme/web/issues/7/labels", { labels: ["ready"] }],
    ]);
    expect(ipc.calls).toContainEqual({ cmd: "open_url", args: { url: "https://x.test/7" } });
    expect(ipc.calls).toContainEqual({
      cmd: "run_action",
      args: { action: "a", name: "Hand off", step: 5, pr },
    });
  });

  it("skips empty steps and says it's done when nothing had words", async () => {
    const ipc = rust();
    const empty = action([
      { kind: "comment", body: "  " },
      { kind: "request", reviewers: [] },
      { kind: "label", labels: [] },
      { kind: "open", url: " " },
      { kind: "run", command: "true" },
    ]);
    expect(await runAction(empty, pr)).toBe("Hand off: done");
    expect(ipc.calls.map((c) => c.cmd)).toEqual(["run_action"]);
  });

  it("names the failed step when there are several", async () => {
    const ipc = rust({ github: { status: 404, body: JSON.stringify({ message: "Not Found" }) } });
    const steps: ActionStep[] = [{ kind: "request", reviewers: ["dana"] }, { kind: "unrequestMe" }];
    await expect(runAction(action(steps), pr)).rejects.toThrow("Ask for reviews: Not Found");
    expect(ipc.github()).toHaveLength(1);
  });

  it("tells only what went wrong when it's the only step", async () => {
    rust({ refuse: "no browser" });
    await expect(runAction(action([{ kind: "open", url: "https://x.test" }]), pr)).rejects.toThrow(/^no browser$/u);
  });
});
