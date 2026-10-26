// The queues' data as the panel gets it. The rules that make it (searches, events, what's new)
// are in src-tauri/src/engine.rs; these are the shapes, and the helpers the cards use.

import type { EventKind } from "./config";

export type Actor = { __typename?: string; login: string; avatarUrl?: string; name?: string | null } | null;
export type Comment = { author: Actor; createdAt: string; body?: string; url: string };

/** What the panel gets of a pull request (PanelPr in src-tauri/src/engine.rs). */
export type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
  author: Actor;
  mergedBy: Actor;
  labels: { nodes: Array<{ name: string }> };
  reviewRequests: {
    nodes: Array<{ requestedReviewer: null | { __typename: "User"; login: string; avatarUrl?: string } | { __typename: "Team"; slug: string; organization: { login: string } } | { __typename: string } }>;
  };
  latestOpinionatedReviews: { nodes: Array<{ author: Actor; state: string; submittedAt: string; url: string }> };
  /** Comments and review conversations. */
  comments: number;
};

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

/** `text`: the start of what a comment or review said, for its notification. */
export type Event = { key: string; kind: EventKind; at: number; who: Actor; text?: string };

export type Item = {
  queueId: string;
  pr: PullRequest;
  events: Event[];
  /** How you left it (involved queues). */
  status?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "MENTIONED";
  /** review queues: requested through these teams rather than you. */
  viaTeams?: string[];
  ci: CiState | null;
  /** CI went green again on the same commit since last time: worth a notification only. */
  passed?: boolean;
  /** review queues: since when it's been waiting on you (ms). */
  waitingSince?: number;
};

export const isBot = (a: Actor) => !a || a.__typename === "Bot" || /\[bot\]$/.test(a.login);

export function requests(pr: PullRequest, me: string) {
  const reviewers = pr.reviewRequests.nodes.map((n) => n.requestedReviewer).filter((r) => r !== null);
  const teams: string[] = [];
  const users: Array<{ login: string; avatarUrl?: string }> = [];
  let direct = false;
  for (const r of reviewers) {
    if (r.__typename === "User" && "login" in r) {
      users.push(r);
      if (r.login === me) direct = true;
    } else if (r.__typename === "Team" && "slug" in r) {
      teams.push(`${r.organization.login}/${r.slug}`);
    }
  }
  return { direct, teams, users };
}
