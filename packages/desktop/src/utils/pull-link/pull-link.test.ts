import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { NoSuchPull, openPullLink } from "@/utils/pull-link/pull-link";

describe("openPullLink", () => {
  const answering = (data: unknown) => {
    const calls: Array<{ cmd: string; args: unknown }> = [];
    mockCommands((cmd, args) => {
      calls.push({ cmd, args });
      return cmd === "github" ? { status: 200, body: JSON.stringify({ data }) } : null;
    });
    return calls;
  };

  it("opens its review window, outside any queue", async () => {
    const calls = answering({
      repository: {
        pullRequest: { id: "PR_7", number: 7, title: "Fix it", author: { login: "ana", name: "Ana Lima" } },
      },
    });
    await openPullLink({ owner: "acme", repo: "web", number: 7 });
    expect(calls.find((c) => c.cmd === "open_review")?.args).toMatchObject({
      id: "PR_7",
      repo: "acme/web",
      number: 7,
      title: "#7 · Fix it · Ana",
      teams: [],
      queue: null,
    });
  });

  it("says when there's no such pull request, or none you can see", async () => {
    answering({ repository: { pullRequest: null } });
    await expect(openPullLink({ owner: "acme", repo: "web", number: 7 })).rejects.toBeInstanceOf(NoSuchPull);
    answering({ repository: null });
    await expect(openPullLink({ owner: "acme", repo: "web", number: 7 })).rejects.toThrow("No such pull request");
  });
});
