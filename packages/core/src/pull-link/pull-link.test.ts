import { describe, expect, it } from "vitest";

import { parsePullLink, pullLinkUrl } from "./pull-link";

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
