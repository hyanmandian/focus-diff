import { describe, expect, it } from "vite-plus/test";

import { comment, leaveReview, loadDetails, markReady, merge, review, type Details } from "@/utils/details/details";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Args } from "@/utils/platform/platform";

const ana = { __typename: "User", login: "ana", avatarUrl: "a.png", name: "Ana" };
const bruno = { __typename: "User", login: "bruno", avatarUrl: "b.png", name: null };

type Sent = { method: unknown; path: unknown; body: unknown };

const field = (args: Args | undefined, key: string): unknown =>
  args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array)
    ? args[key]
    : undefined;

function github(reply: unknown) {
  const sent: Sent[] = [];
  mockCommands((cmd, args) => {
    if (cmd !== "github") return null;
    const body = field(args, "body");
    sent.push({
      method: field(args, "method"),
      path: field(args, "path"),
      body: typeof body === "string" ? JSON.parse(body) : null,
    });
    return { status: 200, body: JSON.stringify(reply) };
  });
  return sent;
}

function pullRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: "PR_1",
    number: 7,
    title: "Add checkout",
    url: "https://github.com/acme/shop/pull/7",
    bodyHTML: "<p>Body</p>",
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    viewerDidAuthor: false,
    viewerCanUpdate: true,
    baseRefName: "main",
    headRefName: "feature",
    headRefOid: "abc",
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    reviewDecision: null,
    author: ana,
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    commits: { nodes: [] },
    files: { nodes: [{ path: "a.ts", additions: 10, deletions: 2, changeType: "MODIFIED" }] },
    timelineItems: { nodes: [] },
    ...overrides,
  };
}

const everyMethod = { squash: true, merge: true, rebase: true };

function answer(pr: Record<string, unknown>, allowed = everyMethod) {
  return github({
    data: {
      repository: {
        squashMergeAllowed: allowed.squash,
        mergeCommitAllowed: allowed.merge,
        rebaseMergeAllowed: allowed.rebase,
        pullRequest: pr,
      },
    },
  });
}

const at = (hour: number) => `2026-01-01T0${hour}:00:00Z`;

const d: Details = {
  id: "PR_1",
  number: 7,
  title: "Add checkout",
  url: "https://github.com/acme/shop/pull/7",
  html: "",
  owner: "acme",
  repo: "shop",
  isDraft: true,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: true,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "feature",
  headRefOid: "abc",
  updatedAt: "2026-01-02T00:00:00Z",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  createdAt: "2026-01-01T00:00:00Z",
  author: ana,
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
};

describe("loadDetails", () => {
  it("asks for the pull request by owner, name and number and reads its basics", async () => {
    const sent = answer(pullRequest());
    const loaded = await loadDetails("acme/shop", 7);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/graphql" });
    expect(JSON.stringify(sent[0]?.body)).toContain('"variables":{"owner":"acme","name":"shop","number":7}');
    expect(loaded).toMatchObject({
      id: "PR_1",
      title: "Add checkout",
      html: "<p>Body</p>",
      owner: "acme",
      repo: "shop",
      files: [{ path: "a.ts" }],
      reviewers: [],
      checks: [],
      entries: [],
      mergeMethods: ["squash", "merge", "rebase"],
    });
  });

  it("offers only the merge methods the repository allows", async () => {
    answer(pullRequest(), { squash: false, merge: true, rebase: false });
    expect((await loadDetails("acme/shop", 7)).mergeMethods).toEqual(["merge"]);
    answer(pullRequest(), { squash: true, merge: false, rebase: true });
    expect((await loadDetails("acme/shop", 7)).mergeMethods).toEqual(["squash", "rebase"]);
  });

  it("copes with a repository name without an owner", async () => {
    const sent = answer(pullRequest());
    const loaded = await loadDetails("", 7);
    expect(loaded).toMatchObject({ owner: "", repo: "" });
    expect(JSON.stringify(sent[0]?.body)).toContain('"owner":"","name":""');
  });

  it("lists who reviewed, then who's still asked, people and teams, without repeating anyone", async () => {
    answer(
      pullRequest({
        latestOpinionatedReviews: {
          nodes: [
            { author: ana, state: "APPROVED" },
            { author: null, state: "COMMENTED" },
          ],
        },
        reviewRequests: {
          nodes: [
            { requestedReviewer: null },
            { requestedReviewer: ana },
            { requestedReviewer: bruno },
            { requestedReviewer: { __typename: "Team", name: "Payments", slug: "payments" } },
            { requestedReviewer: { __typename: "Team", name: "Ghost" } },
          ],
        },
      }),
    );
    const { reviewers } = await loadDetails("acme/shop", 7);
    expect(reviewers).toEqual([
      { actor: ana, state: "APPROVED" },
      { actor: bruno, state: "PENDING" },
      { actor: { login: "payments", name: "Payments" }, state: "PENDING", team: "Payments" },
    ]);
  });

  it("reads checks and statuses, failing first, then running, then the rest", async () => {
    const contexts = [
      { __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "l" },
      { __typename: "CheckRun", name: "skip", status: "COMPLETED", conclusion: "SKIPPED", detailsUrl: null },
      { __typename: "CheckRun", name: "neutral", status: "COMPLETED", conclusion: "NEUTRAL", detailsUrl: null },
      { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: null },
      { __typename: "CheckRun", name: "none", status: "COMPLETED", conclusion: null, detailsUrl: null },
      { __typename: "CheckRun", name: "stopped", status: "COMPLETED", conclusion: "CANCELLED", detailsUrl: null },
      { __typename: "CheckRun", name: "build", status: "IN_PROGRESS", conclusion: null, detailsUrl: null },
      { __typename: "StatusContext", context: "ci/ok", state: "SUCCESS", targetUrl: "t" },
      { __typename: "StatusContext", context: "ci/wait", state: "PENDING", targetUrl: null },
      { __typename: "StatusContext", context: "ci/expected", state: "EXPECTED", targetUrl: null },
      { __typename: "StatusContext", context: "ci/bad", state: "ERROR", targetUrl: null },
      { __typename: "StatusContext", state: "SUCCESS" },
    ];
    answer(pullRequest({ commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: contexts } } } }] } }));
    const { checks } = await loadDetails("acme/shop", 7);
    expect(checks).toEqual([
      { name: "test", state: "failure", url: null },
      { name: "ci/bad", state: "failure", url: null },
      { name: "build", state: "pending", url: null },
      { name: "ci/wait", state: "pending", url: null },
      { name: "ci/expected", state: "pending", url: null },
      { name: "skip", state: "neutral", url: null },
      { name: "neutral", state: "neutral", url: null },
      { name: "none", state: "neutral", url: null },
      { name: "stopped", state: "neutral", url: null },
      { name: "lint", state: "success", url: "l" },
      { name: "ci/ok", state: "success", url: "t" },
      { name: "Check", state: "success", url: null },
    ]);
  });

  it("has no checks when the last commit has none", async () => {
    answer(pullRequest({ commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }));
    expect((await loadDetails("acme/shop", 7)).checks).toEqual([]);
  });

  it("lists comments and reviews newest first, leaving out empty replies", async () => {
    const inline = { id: "rc1", path: "a.ts", line: 3, bodyHTML: "<p>Here</p>", author: bruno, url: "rc1-url" };
    answer(
      pullRequest({
        timelineItems: {
          nodes: [
            {
              __typename: "IssueComment",
              id: "c1",
              author: ana,
              bodyHTML: "<p>Hi</p>",
              createdAt: at(1),
              url: "c1-url",
            },
            {
              __typename: "PullRequestReview",
              id: "r1",
              author: bruno,
              state: "CHANGES_REQUESTED",
              bodyHTML: "",
              createdAt: at(2),
              url: "r1-url",
              comments: { nodes: [inline] },
            },
            {
              __typename: "PullRequestReview",
              id: "empty",
              author: bruno,
              state: "COMMENTED",
              bodyHTML: "  ",
              createdAt: at(3),
              url: "x",
              comments: { nodes: null },
            },
            {
              __typename: "PullRequestReview",
              id: "said",
              author: ana,
              state: "COMMENTED",
              bodyHTML: "<p>Looks fine</p>",
              createdAt: at(4),
              url: "said-url",
              comments: { nodes: [] },
            },
            {
              __typename: "PullRequestReview",
              id: "thread",
              author: ana,
              state: "COMMENTED",
              bodyHTML: "",
              createdAt: at(5),
              url: "thread-url",
              comments: { nodes: [{ ...inline, id: "rc2", line: null }] },
            },
          ],
        },
      }),
    );
    const { entries } = await loadDetails("acme/shop", 7);
    expect(entries.map((e) => e.id)).toEqual(["thread", "said", "r1", "c1"]);
    expect(entries[3]).toEqual({ kind: "comment", id: "c1", author: ana, html: "<p>Hi</p>", at: at(1), url: "c1-url" });
    expect(entries[2]).toEqual({
      kind: "review",
      id: "r1",
      author: bruno,
      state: "CHANGES_REQUESTED",
      html: "",
      at: at(2),
      url: "r1-url",
      comments: [{ id: "rc1", path: "a.ts", line: 3, html: "<p>Here</p>", author: bruno, url: "rc1-url" }],
    });
    expect(entries[0]).toMatchObject({ comments: [{ id: "rc2", line: null }] });
  });
});

describe("actions on a pull request", () => {
  it("sends a review with its verdict and words", async () => {
    const sent = github({});
    await review(d, "APPROVE", "Ship it");
    expect(sent).toEqual([
      { method: "POST", path: "/repos/acme/shop/pulls/7/reviews", body: { event: "APPROVE", body: "Ship it" } },
    ]);
  });

  it("comments and answers with the new comment's id", async () => {
    const sent = github({ node_id: "IC_9" });
    await expect(comment(d, "Thanks")).resolves.toBe("IC_9");
    expect(sent).toEqual([{ method: "POST", path: "/repos/acme/shop/issues/7/comments", body: { body: "Thanks" } }]);
  });

  it("merges with the method picked", async () => {
    const sent = github({});
    await merge(d, "squash");
    expect(sent).toEqual([{ method: "PUT", path: "/repos/acme/shop/pulls/7/merge", body: { merge_method: "squash" } }]);
  });

  it("marks a draft ready for review", async () => {
    const sent = github({ data: {} });
    await markReady(d);
    expect(sent[0]).toMatchObject({ method: "POST", path: "/graphql", body: { variables: { id: "PR_1" } } });
    expect(JSON.stringify(sent[0]?.body)).toContain("markPullRequestReadyForReview");
  });

  it("takes you, and the teams you were asked through, off the review requests", async () => {
    const sent = github({});
    await leaveReview(d, "you", ["acme/payments", "solo"]);
    expect(sent).toEqual([
      {
        method: "DELETE",
        path: "/repos/acme/shop/pulls/7/requested_reviewers",
        body: { reviewers: ["you"], team_reviewers: ["payments", "solo"] },
      },
    ]);
  });
});
