import type { EventKind } from "@/utils/config/config";

export type Actor = {
  __typename?: string;
  login: string;
  avatarUrl?: string | undefined;
  name?: string | null | undefined;
} | null;

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
  headRefName?: string;
  baseRefName?: string;
  isCrossRepository?: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
  author: Actor;
  mergedBy: Actor;
  labels: { nodes: Array<{ name: string }> };
  reviewRequests: {
    nodes: Array<{
      requestedReviewer:
        | null
        | { __typename: "User"; login: string; avatarUrl?: string | undefined }
        | { __typename: "Team"; slug: string; organization: { login: string } }
        | { __typename: string };
    }>;
  };
  latestOpinionatedReviews: { nodes: Array<{ author: Actor; state: string; submittedAt: string; url: string }> };
  comments: number;
};

type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

export type Event = { key: string; kind: EventKind; at: number; who: Actor; text?: string };

export type Item = {
  queueId: string;
  pr: PullRequest;
  events: Event[];
  status?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "MENTIONED";
  viaTeams?: string[] | undefined;
  ci: CiState | null;
  passed?: boolean;
  waitingSince?: number;
};
