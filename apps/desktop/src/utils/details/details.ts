// Everything about one pull request for its detail view, and what can be done to it from there.

import { github, graphql } from "@/utils/bridge/bridge";
import type { Actor } from "@/utils/engine/engine";

export type Check = { name: string; state: "success" | "failure" | "pending" | "neutral"; url: string | null };
export type FileChange = { path: string; additions: number; deletions: number; changeType: string };
export type Entry =
  | { kind: "comment"; id: string; author: Actor; html: string; at: string; url: string }
  | {
      kind: "review";
      id: string;
      author: Actor;
      state: string;
      html: string;
      at: string;
      url: string;
      comments: Array<{ id: string; path: string; line: number | null; html: string; author: Actor; url: string }>;
    };

export type Details = {
  id: string;
  number: number;
  title: string;
  url: string;
  html: string;
  owner: string;
  repo: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  mergeStateStatus: string;
  viewerDidAuthor: boolean;
  viewerCanUpdate: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  createdAt: string;
  author: Actor;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  reviewers: Array<{ actor: Actor; state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "PENDING"; team?: string }>;
  checks: Check[];
  files: FileChange[];
  entries: Entry[];
  mergeMethods: Array<"squash" | "merge" | "rebase">;
};

const ACTOR = "__typename login avatarUrl(size: 64) ... on User { name }";

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed
    pullRequest(number: $number) {
      id number title url bodyHTML isDraft state mergeable mergeStateStatus viewerDidAuthor viewerCanUpdate
      baseRefName headRefName headRefOid additions deletions changedFiles createdAt updatedAt reviewDecision
      author { ${ACTOR} }
      reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { ${ACTOR} } ... on Team { name slug } } } }
      latestOpinionatedReviews(first: 20) { nodes { author { ${ACTOR} } state } }
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 60) { nodes {
        __typename
        ... on CheckRun { name conclusion status detailsUrl }
        ... on StatusContext { context state targetUrl }
      } } } } } }
      files(first: 100) { nodes { path additions deletions changeType } }
      timelineItems(last: 40, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW]) { nodes {
        __typename
        ... on IssueComment { id author { ${ACTOR} } bodyHTML createdAt url }
        ... on PullRequestReview { id author { ${ACTOR} } state bodyHTML createdAt url
          comments(first: 10) { nodes { id path line bodyHTML author { ${ACTOR} } url } } }
      } }
    }
  }
}`;

type ReviewState = Details["reviewers"][number]["state"];

/** The conversation's comments and reviews, as the query asks for them. */
type TimelineNode =
  | { __typename: "IssueComment"; id: string; author: Actor; bodyHTML: string; createdAt: string; url: string }
  | {
      __typename: "PullRequestReview";
      id: string;
      author: Actor;
      state: string;
      bodyHTML: string;
      createdAt: string;
      url: string;
      comments: {
        nodes: Array<{
          id: string;
          path: string;
          line: number | null;
          bodyHTML: string;
          author: Actor;
          url: string;
        }> | null;
      };
    };

type Raw = {
  repository: {
    squashMergeAllowed: boolean;
    mergeCommitAllowed: boolean;
    rebaseMergeAllowed: boolean;
    pullRequest: Omit<
      Details,
      "html" | "owner" | "repo" | "reviewers" | "checks" | "files" | "entries" | "mergeMethods"
    > & {
      bodyHTML: string;
      reviewRequests: {
        nodes: Array<{
          requestedReviewer:
            | null
            | ({ __typename: "User" } & NonNullable<Actor>)
            | { __typename: "Team"; name: string; slug: string };
        }>;
      };
      latestOpinionatedReviews: { nodes: Array<{ author: Actor; state: ReviewState }> };
      commits: {
        nodes: Array<{
          commit: { statusCheckRollup: null | { contexts: { nodes: Array<Record<string, string | null>> } } };
        }>;
      };
      files: { nodes: FileChange[] };
      timelineItems: { nodes: TimelineNode[] };
    };
  };
};

function checkState(node: Record<string, string | null>): Check["state"] {
  if (node.__typename === "StatusContext") {
    return node.state === "SUCCESS"
      ? "success"
      : node.state === "PENDING" || node.state === "EXPECTED"
        ? "pending"
        : "failure";
  }
  if (node.status !== "COMPLETED") return "pending";
  return node.conclusion === "SUCCESS"
    ? "success"
    : ["NEUTRAL", "SKIPPED"].includes(node.conclusion ?? "")
      ? "neutral"
      : "failure";
}

export async function loadDetails(nameWithOwner: string, number: number): Promise<Details> {
  const [owner = "", repo = ""] = nameWithOwner.split("/");
  const data = await graphql<Raw>(QUERY, { owner, name: repo, number });
  const { pullRequest: pr, ...repository } = data.repository;

  const reviewed = pr.latestOpinionatedReviews.nodes.filter((r) => r.author);
  const reviewers: Details["reviewers"] = reviewed.map((r) => ({ actor: r.author, state: r.state }));
  for (const { requestedReviewer: r } of pr.reviewRequests.nodes) {
    if (!r) continue;
    if (r.__typename === "Team" && "slug" in r)
      reviewers.push({ actor: { login: r.slug, name: r.name }, state: "PENDING", team: r.name });
    else if ("login" in r && !reviewers.some((x) => x.actor?.login === r.login))
      reviewers.push({ actor: r, state: "PENDING" });
  }

  const contexts = pr.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  const checks = contexts
    .map((c) => ({
      name: c.name ?? c.context ?? "Check",
      state: checkState(c),
      url: c.detailsUrl ?? c.targetUrl ?? null,
    }))
    // Failing first, then running, then the rest.
    .toSorted(
      (a, b) =>
        ["failure", "pending", "neutral", "success"].indexOf(a.state) -
        ["failure", "pending", "neutral", "success"].indexOf(b.state),
    );

  const entries: Entry[] = [];
  for (const node of pr.timelineItems.nodes) {
    if (node.__typename === "IssueComment") {
      const { id, author, bodyHTML: html, createdAt: at, url } = node;
      entries.push({ kind: "comment", id, author, html, at, url });
    } else {
      const comments = (node.comments.nodes ?? []).map((c) => ({
        id: c.id,
        path: c.path,
        line: c.line,
        html: c.bodyHTML,
        author: c.author,
        url: c.url,
      }));
      // Replies in threads come as empty "commented" reviews: only keep reviews that say something.
      if (node.state === "COMMENTED" && !node.bodyHTML.trim() && comments.length === 0) continue;
      const { id, author, state, bodyHTML: html, createdAt: at, url } = node;
      entries.push({ kind: "review", id, author, state, html, at, url, comments });
    }
  }

  const mergeMethods: Details["mergeMethods"] = [];
  if (repository.squashMergeAllowed) mergeMethods.push("squash");
  if (repository.mergeCommitAllowed) mergeMethods.push("merge");
  if (repository.rebaseMergeAllowed) mergeMethods.push("rebase");

  return {
    ...pr,
    html: pr.bodyHTML,
    owner,
    repo,
    reviewers,
    checks,
    files: pr.files.nodes,
    entries: entries.toReversed(), // newest first
    mergeMethods,
  };
}

// MARK: Actions

const base = (d: Details) => `/repos/${d.owner}/${d.repo}`;

export const review = (d: Details, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string) =>
  github("POST", `${base(d)}/pulls/${d.number}/reviews`, { event, body });

/** The new comment's id, the one the conversation knows it by. */
export const comment = async (d: Details, body: string) =>
  (await github<{ node_id: string }>("POST", `${base(d)}/issues/${d.number}/comments`, { body })).node_id;

export const merge = (d: Details, method: "squash" | "merge" | "rebase") =>
  github("PUT", `${base(d)}/pulls/${d.number}/merge`, { merge_method: method });

export const markReady = (d: Details) =>
  graphql("mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { clientMutationId } }", {
    id: d.id,
  });

/** Takes you off the pull request's review requests (and, if asked through them, these teams). */
export const leaveReview = (d: Details, me: string, teams: string[]) =>
  github("DELETE", `${base(d)}/pulls/${d.number}/requested_reviewers`, {
    reviewers: [me],
    team_reviewers: teams.map((t) => t.split("/")[1] ?? t),
  });
