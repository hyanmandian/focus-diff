import { describe, expect, it } from "vitest";

import { sampleActivity, sampleNotify, samplePull } from "./github-sample-pull";

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

describe("sampleActivity", () => {
  it("makes a comment on octo/web's pull request 12, changed as the test needs", () => {
    expect(sampleActivity("t1")).toMatchObject({ thread: "t1", repo: "octo/web", number: 12, kind: "comment" });
    expect(sampleActivity("t2", { kind: "review" })).toMatchObject({ thread: "t2", kind: "review" });
  });
});

describe("sampleNotify", () => {
  it("turns notifications on for just the events given, with their exceptions, and for the repos given", () => {
    const settings = sampleNotify({ "review-requested": ["drafts"] }, ["octo/web"]);
    expect(settings).toMatchObject({ enabled: true, repos: ["octo/web"] });
    expect(settings.events["review-requested"]).toEqual({ on: true, except: ["drafts"], repos: [], when: "now" });
    expect(Object.values(settings.events).filter((event) => event.on)).toHaveLength(1);
    expect(sampleNotify({}).repos).toEqual([]);
  });
});
