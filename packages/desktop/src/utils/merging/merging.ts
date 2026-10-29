import { github, graphql } from "@/utils/bridge/bridge";
import { fresh } from "@/utils/checks/checks";
import type { Commit } from "@/utils/commits/commits";
import type { Details } from "@/utils/details/details";
import { canWrite, type Manage } from "@/utils/manage/manage";
import type { PullRef } from "@/utils/review/review";

export type Method = Details["mergeMethods"][number];

export type MergeStatus =
  | "merged"
  | "closed"
  | "draft"
  | "queued"
  | "auto"
  | "conflicts"
  | "behind"
  | "blocked"
  | "unstable"
  | "checking"
  | "ready";
export type Reason =
  | "approvals"
  | "changes"
  | "codeOwners"
  | "failing"
  | "pending"
  | "conversations"
  | "behind"
  | "conflicts";

export type MergeView = {
  status: MergeStatus;
  tone: "success" | "warning" | "destructive" | "muted" | "merged";
  reasons: Reason[];
  canMerge: boolean;
  canBypass: boolean;
  canAutoMerge: boolean;
  canDisableAutoMerge: boolean;
  canEnqueue: boolean;
  canDequeue: boolean;
  canUpdateBranch: boolean;
};

type Input = {
  details: Pick<Details, "state" | "isDraft" | "mergeable" | "mergeStateStatus" | "reviewDecision" | "mergeMethods">;
  manage: Manage;
  failing: number;
  pending: number;
  unresolved: number;
};

export function mergeView({ details: d, manage: m, failing, pending, unresolved }: Input): MergeView {
  const write = canWrite(m);
  const open = d.state === "OPEN";
  const none: Omit<MergeView, "status" | "tone"> = {
    reasons: [],
    canMerge: false,
    canBypass: false,
    canAutoMerge: false,
    canDisableAutoMerge: false,
    canEnqueue: false,
    canDequeue: false,
    canUpdateBranch: false,
  };
  if (d.state === "MERGED") return { ...none, status: "merged", tone: "merged" };
  if (d.state === "CLOSED") return { ...none, status: "closed", tone: "muted" };
  if (d.isDraft) return { ...none, status: "draft", tone: "muted" };

  const reasons: Reason[] = [];
  if (d.reviewDecision === "CHANGES_REQUESTED") reasons.push("changes");
  else if (d.reviewDecision === "REVIEW_REQUIRED")
    reasons.push(
      m.rule?.codeOwners && m.reviewers.some((r) => r.codeOwner && r.requested) ? "codeOwners" : "approvals",
    );
  if (failing) reasons.push("failing");
  if (pending) reasons.push("pending");
  if (m.rule?.conversations && unresolved) reasons.push("conversations");
  const state = d.mergeStateStatus;
  const conflicts = d.mergeable === "CONFLICTING" || state === "DIRTY";
  if (conflicts) reasons.push("conflicts");
  if (state === "BEHIND") reasons.push("behind");

  const status: MergeStatus = m.isInMergeQueue
    ? "queued"
    : m.autoMerge
      ? "auto"
      : conflicts
        ? "conflicts"
        : state === "BEHIND"
          ? "behind"
          : state === "BLOCKED"
            ? "blocked"
            : state === "UNSTABLE"
              ? "unstable"
              : state === "CLEAN" || state === "HAS_HOOKS"
                ? "ready"
                : "checking";
  const tone: MergeView["tone"] =
    status === "ready"
      ? "success"
      : status === "conflicts"
        ? "destructive"
        : status === "checking" || status === "queued" || status === "auto"
          ? "muted"
          : "warning";
  const methods = d.mergeMethods.length > 0;
  const mergeable = (status === "ready" || status === "unstable") && !m.isMergeQueueEnabled;
  return {
    status,
    tone,
    reasons,
    canMerge: open && write && methods && mergeable,
    canBypass:
      open &&
      methods &&
      m.viewerCanMergeAsAdmin &&
      !conflicts &&
      !mergeable &&
      status !== "checking" &&
      status !== "queued",
    canAutoMerge:
      open &&
      methods &&
      m.autoMergeAllowed &&
      m.viewerCanEnableAutoMerge &&
      !m.autoMerge &&
      !m.isMergeQueueEnabled &&
      !conflicts &&
      (status === "blocked" || status === "behind" || status === "unstable" || status === "checking"),
    canDisableAutoMerge: Boolean(m.autoMerge) && m.viewerCanDisableAutoMerge,
    canEnqueue: open && write && m.isMergeQueueEnabled && !m.isInMergeQueue && !conflicts,
    canDequeue: open && write && m.isInMergeQueue,
    canUpdateBranch: open && m.viewerCanUpdateBranch,
  };
}

export function defaultMessage(
  method: Method,
  m: Pick<Manage, "squashTitle" | "squashMessage" | "mergeTitle" | "mergeMessage" | "headOwner" | "body">,
  pr: { number: number; title: string; headRefName: string },
  commits: Pick<Commit, "headline" | "body">[],
): { title: string; body: string } {
  const prTitle = `${pr.title} (#${pr.number})`;
  if (method === "squash") {
    const only = commits.length === 1 ? commits[0] : undefined;
    if (m.squashTitle === "COMMIT_OR_PR_TITLE" && only)
      return { title: `${only.headline} (#${pr.number})`, body: only.body };
    const body =
      m.squashMessage === "PR_BODY"
        ? m.body
        : m.squashMessage === "COMMIT_MESSAGES"
          ? commits.map((c) => `* ${c.headline}${c.body ? `\n\n${c.body}` : ""}`).join("\n\n")
          : "";
    return { title: prTitle, body };
  }
  if (method === "merge") {
    const title =
      m.mergeTitle === "MERGE_MESSAGE"
        ? `Merge pull request #${pr.number} from ${m.headOwner}/${pr.headRefName}`
        : prTitle;
    const body = m.mergeMessage === "PR_BODY" ? m.body : m.mergeMessage === "PR_TITLE" ? pr.title : "";
    return { title, body };
  }
  return { title: "", body: "" };
}

type MergeState = Pick<
  Details,
  "state" | "isDraft" | "mergeable" | "mergeStateStatus" | "reviewDecision" | "headRefOid" | "updatedAt"
>;
export async function loadMergeState(ref: PullRef): Promise<MergeState> {
  type R = { repository: { pullRequest: MergeState } };
  const data = await graphql<R>(
    fresh(
      `query($owner: String!, $name: String!, $number: Int!) { repository(owner: $owner, name: $name) { pullRequest(number: $number) { state isDraft mergeable mergeStateStatus reviewDecision headRefOid updatedAt } } }`,
    ),
    { owner: ref.owner, name: ref.repo, number: ref.number },
  );
  return data.repository.pullRequest;
}

const base = (d: Pick<Details, "owner" | "repo" | "number">) => `/repos/${d.owner}/${d.repo}/pulls/${d.number}`;

export const mergePull = (
  d: Pick<Details, "owner" | "repo" | "number" | "headRefOid">,
  method: Method,
  message?: { title: string; body: string },
) =>
  github("PUT", `${base(d)}/merge`, {
    merge_method: method,
    sha: d.headRefOid,
    ...(message && method !== "rebase" ? { commit_title: message.title, commit_message: message.body } : {}),
  });

const METHOD = { merge: "MERGE", squash: "SQUASH", rebase: "REBASE" } as const;

export const enableAutoMerge = (
  d: Pick<Details, "id" | "headRefOid">,
  method: Method,
  message?: { title: string; body: string },
) =>
  graphql(
    `
      mutation ($id: ID!, $method: PullRequestMergeMethod!, $head: GitObjectID, $title: String, $body: String) {
        enablePullRequestAutoMerge(
          input: {
            pullRequestId: $id
            mergeMethod: $method
            expectedHeadOid: $head
            commitHeadline: $title
            commitBody: $body
          }
        ) {
          clientMutationId
        }
      }
    `,
    {
      id: d.id,
      method: METHOD[method],
      head: d.headRefOid,
      title: method === "rebase" ? null : (message?.title ?? null),
      body: method === "rebase" ? null : (message?.body ?? null),
    },
  );
export const disableAutoMerge = (d: Pick<Details, "id">) =>
  graphql("mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { clientMutationId } }", {
    id: d.id,
  });

export const enqueue = (d: Pick<Details, "id" | "headRefOid">) =>
  graphql(
    "mutation($id: ID!, $head: GitObjectID) { enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $head }) { clientMutationId } }",
    { id: d.id, head: d.headRefOid },
  );
export const dequeue = (d: Pick<Details, "id">) =>
  graphql("mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { clientMutationId } }", { id: d.id });

export const updateBranch = (d: Pick<Details, "id" | "headRefOid">, how: "MERGE" | "REBASE") =>
  graphql(
    "mutation($id: ID!, $head: GitObjectID, $how: PullRequestBranchUpdateMethod) { updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $head, updateMethod: $how }) { clientMutationId } }",
    {
      id: d.id,
      head: d.headRefOid,
      how,
    },
  );

export const deleteBranch = (m: Pick<Manage, "headOwner" | "headRepo">, branch: string) =>
  github(
    "DELETE",
    `/repos/${m.headOwner}/${m.headRepo}/git/refs/heads/${branch
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
  );
