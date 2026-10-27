import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { NoSuchPull, openPullLink, parsePullLink, pullLinkUrl } from "@/utils/pull-link/pull-link";

describe("parsePullLink", () => {
  it("reads a pull request's link, with whatever GitHub adds after the number", () => {
    const pull = { owner: "acme", repo: "web", number: 1807 };
    for (const link of [
      "https://github.com/acme/web/pull/1807",
      "  https://github.com/acme/web/pull/1807/  ",
      "https://www.github.com/acme/web/pull/1807",
      "github.com/acme/web/pull/1807",
      "https://github.com/acme/web/pull/1807/files",
      "https://github.com/acme/web/pull/1807/changes",
      "https://github.com/acme/web/pull/1807/commits/abc123",
      "https://github.com/acme/web/pull/1807?w=1",
      "https://github.com/acme/web/pull/1807#issuecomment-1",
      "https://github.com/acme/web/pull/1807/files?diff=split#diff-abc",
    ])
      expect(parsePullLink(link)).toEqual(pull);
    expect(parsePullLink("https://github.com/a-b-c/my.repo_2/pull/1")).toEqual({
      owner: "a-b-c",
      repo: "my.repo_2",
      number: 1,
    });
  });

  it("takes nothing else for one", () => {
    const taken = [
      "",
      "hello",
      "http://github.com/acme/web/pull/1",
      "https://github.com/acme/web/issues/1",
      "https://github.com/acme/web/pulls",
      "https://github.com/acme/web/pull/0",
      "https://github.com/acme/web/pull/x",
      "https://gist.github.com/acme/web/pull/1",
      "https://github.com.evil.io/acme/web/pull/1",
      "https://evil.io/github.com/acme/web/pull/1",
      "https://github.com/-acme/web/pull/1",
      "https://github.com/acme-/web/pull/1",
      "https://github.com/ac--me/web/pull/1",
      `https://github.com/${"a".repeat(40)}/web/pull/1`,
      "https://github.com/acme/../pull/1",
      "https://github.com/acme/./pull/1",
      "https://github.com/acme/web/pull/1 and more",
      "https://github.com/acme/web/pull/1/<script>",
    ].filter((text) => parsePullLink(text));
    expect(taken).toEqual([]);
  });

  it("writes the link back as GitHub does", () => {
    expect(pullLinkUrl({ owner: "acme", repo: "web", number: 7 })).toBe("https://github.com/acme/web/pull/7");
  });
});

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
