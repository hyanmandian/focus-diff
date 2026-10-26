import { describe, expect, it } from "vitest";

import { samplePull } from "./github-sample-pull";

describe("samplePull", () => {
  it("makes octo/web's pull request by ada, numbered as asked", () => {
    expect(samplePull(7)).toMatchObject({
      repo: "octo/web",
      number: 7,
      title: "Pull request 7",
      url: "https://github.com/octo/web/pull/7",
      author: "ada",
      draft: false,
      unread: false,
    });
  });

  it("takes what the test needs instead", () => {
    expect(samplePull(7, { author: "grace", draft: true })).toMatchObject({ number: 7, author: "grace", draft: true });
  });
});
