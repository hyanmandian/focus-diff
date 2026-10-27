import { describe, expect, it } from "vite-plus/test";

import { isBot, requests, type PullRequest } from "./engine";

const withRequests = (nodes: PullRequest["reviewRequests"]["nodes"]) => ({ reviewRequests: { nodes } });

describe("isBot", () => {
  it("counts bots and the deleted, not people", () => {
    expect(isBot(null)).toBe(true);
    expect(isBot({ __typename: "Bot", login: "renovate" })).toBe(true);
    expect(isBot({ login: "dependabot[bot]" })).toBe(true);
    expect(isBot({ __typename: "User", login: "ana" })).toBe(false);
  });
});

describe("requests", () => {
  it("splits the review requests into people and teams, and says if you were asked yourself", () => {
    const pr = withRequests([
      { requestedReviewer: { __typename: "User", login: "me", avatarUrl: "a.png" } },
      { requestedReviewer: { __typename: "User", login: "ana" } },
      { requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" } } },
      { requestedReviewer: { __typename: "Mannequin" } },
      { requestedReviewer: null },
    ]);
    expect(requests(pr, "me")).toEqual({
      direct: true,
      teams: ["acme/web"],
      users: [
        { __typename: "User", login: "me", avatarUrl: "a.png" },
        { __typename: "User", login: "ana" },
      ],
    });
    expect(requests(pr, "bo").direct).toBe(false);
  });

  it("ignores reviewers whose shape it doesn't know", () => {
    const pr = withRequests([
      { requestedReviewer: { __typename: "User" } },
      { requestedReviewer: { __typename: "Team" } },
    ]);
    expect(requests(pr, "me")).toEqual({ direct: false, teams: [], users: [] });
  });
});
