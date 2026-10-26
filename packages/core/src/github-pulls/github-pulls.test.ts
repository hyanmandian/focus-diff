import { describe, expect, it } from "vitest";

import { civilFromDays, daysFromCivil, isoDate, parsePullRequest, readNodes, time } from "./github-pulls";

const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

describe("time", () => {
  it("reads GitHub's timestamps as milliseconds", () => {
    expect(time("2026-01-01T00:00:00Z")).toBe(T0);
    expect(time("2025-12-31T22:30:00Z")).toBe(T0 - 90 * 60_000);
    expect(time("1969-12-31T23:59:59Z")).toBe(-1000);
  });

  it("is 0 for no date, or one it can't read", () => {
    expect(time(null)).toBe(0);
    expect(time("nope")).toBe(0);
    expect(time("2026-01-01T00:00:0")).toBe(0);
    expect(time("2026-01-01T00:xx:00Z")).toBe(0);
  });
});

describe("dates", () => {
  it("count days from the epoch both ways", () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(civilFromDays(daysFromCivil(2000, 2, 29))).toStrictEqual([2000, 2, 29]);
    expect(civilFromDays(-1)).toStrictEqual([1969, 12, 31]);
    expect(isoDate(T0 - 1)).toBe("2025-12-31");
    expect(isoDate(-86_400_000 * 365)).toBe("1969-01-01");
  });
});

describe("reading pull requests", () => {
  it("fills in what's missing", () => {
    const pr = parsePullRequest({ id: "PR_1" })!;
    expect(pr).toMatchObject({ id: "PR_1", number: 0, title: "", isDraft: false, mergedAt: null, author: null });
    expect(pr.comments).toStrictEqual({ nodes: [] });
    expect(pr.commentCount).toStrictEqual({ totalCount: 0 });
    expect(pr.repository).toStrictEqual({ nameWithOwner: "" });
    expect("files" in pr || "requested" in pr).toBe(false);
  });

  it("keeps the fields people and reviewers have, and only those", () => {
    const pr = parsePullRequest({
      author: { __typename: "User", login: "ana", avatarUrl: "a", name: null },
      reviewRequests: {
        nodes: [
          { requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" }, members: null } },
          { requestedReviewer: { login: "ana", avatarUrl: "a" }, createdAt: "2026" },
        ],
      },
      files: null,
      requested: { nodes: [{ requestedReviewer: { __typename: "Team", members: { nodes: [{ login: "me" }] } } }] },
    })!;
    expect(pr.author).toStrictEqual({ __typename: "User", login: "ana", avatarUrl: "a" });
    expect(pr.reviewRequests.nodes).toStrictEqual([
      { requestedReviewer: { __typename: "Team", slug: "web", organization: { login: "acme" } } },
      { requestedReviewer: { __typename: "", login: "ana", avatarUrl: "a" }, createdAt: "2026" },
    ]);
    expect(pr.requested?.nodes[0]?.requestedReviewer?.members).toStrictEqual({ nodes: [{ login: "me" }] });
    expect("files" in pr).toBe(false);
  });

  it("drops a connection's nulls and nodes that don't read", () => {
    const pr = parsePullRequest({
      comments: { nodes: [null, {}, 3, { url: 7 }] },
      mine: {
        nodes: [
          { state: "APPROVED", commit: {} },
          { state: "COMMENTED", commit: { oid: "a" } },
        ],
      },
      commits: {
        nodes: [{ commit: { statusCheckRollup: {} } }, { commit: { statusCheckRollup: { state: "SUCCESS" } } }],
      },
      labels: null,
    })!;
    expect(pr.comments.nodes).toStrictEqual([{ author: null, createdAt: null, body: null, url: "" }]);
    expect(pr.mine.nodes).toStrictEqual([{ state: "COMMENTED", submittedAt: null, commit: { oid: "a" } }]);
    expect(pr.commits.nodes).toStrictEqual([
      { commit: { committedDate: null, statusCheckRollup: { state: "SUCCESS" } } },
    ]);
    expect(pr.labels.nodes).toStrictEqual([]);
    expect(parsePullRequest({ commits: { nodes: [{ commit: null }] } })?.commits.nodes).toStrictEqual([]);
    expect(parsePullRequest({ commits: { nodes: [{}] } })?.commits.nodes).toStrictEqual([
      { commit: { committedDate: null, statusCheckRollup: null } },
    ]);
  });

  it("isn't one with a field of the wrong type", () => {
    for (const bad of [
      null,
      "PR",
      [],
      { number: "seven" },
      { number: -1 },
      { additions: 1.5 },
      { isDraft: "no" },
      { title: null },
      { repository: null },
      { commentCount: null },
      { comments: { nodes: null } },
      { comments: { nodes: {} } },
      { comments: "none" },
      { author: { login: 3 } },
    ]) {
      expect(parsePullRequest(bad)).toBeNull();
    }
  });

  it("reads connections on their own too", () => {
    expect(readNodes(undefined, String)).toStrictEqual({ nodes: [] });
    expect(readNodes({}, String)).toStrictEqual({ nodes: [] });
    expect(() => readNodes({ nodes: 1 }, String)).toThrow("nodes");
  });
});
