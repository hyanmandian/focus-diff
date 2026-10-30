import { useCallback, useEffect, useRef, useState } from "react";

import { github, graphql } from "@/utils/bridge/bridge";
import { fresh } from "@/utils/checks/checks";
import type { Actor } from "@/utils/engine/engine";
import { errorText } from "@/utils/error/error";
import type { PullRef } from "@/utils/review/review";
import { cachedList, shelve, shelved } from "@/utils/shelf/shelf";

export type Permission = "ADMIN" | "MAINTAIN" | "WRITE" | "TRIAGE" | "READ";
export type Label = { id: string; name: string; color: string; description: string | null };
export type Milestone = { id: string; number: number; title: string; dueOn: string | null };
export type Team = { slug: string; name: string; combinedSlug: string };
export type LinkedIssue = {
  id: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  stateReason: string | null;
  url: string;
  repo: string;
};
type Deployment = {
  id: string;
  environment: string;
  state: string;
  url: string | null;
  logUrl: string | null;
  at: string;
};
export type Reviewer = {
  key: string;
  actor: Actor;
  team: Team | null;
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING" | null;
  requested: boolean;
  codeOwner: boolean;
};

export type Manage = {
  viewerPermission: Permission | null;
  autoMergeAllowed: boolean;
  deleteBranchOnMerge: boolean;
  squashTitle: "PR_TITLE" | "COMMIT_OR_PR_TITLE";
  squashMessage: "PR_BODY" | "COMMIT_MESSAGES" | "BLANK";
  mergeTitle: "PR_TITLE" | "MERGE_MESSAGE";
  mergeMessage: "PR_BODY" | "PR_TITLE" | "BLANK";
  orgOwned: boolean;
  body: string;
  isMergeQueueEnabled: boolean;
  isInMergeQueue: boolean;
  queuePosition: number | null;
  viewerCanUpdateBranch: boolean;
  viewerCanEnableAutoMerge: boolean;
  viewerCanDisableAutoMerge: boolean;
  viewerCanMergeAsAdmin: boolean;
  viewerCanDeleteHeadRef: boolean;
  autoMerge: { method: "MERGE" | "SQUASH" | "REBASE"; by: string | null } | null;
  headRefExists: boolean;
  headOwner: string;
  headRepo: string;
  rule: { approvals: number; codeOwners: boolean; checks: string[]; conversations: boolean; linear: boolean } | null;
  labels: Label[];
  assignees: NonNullable<Actor>[];
  milestone: Milestone | null;
  issues: LinkedIssue[];
  reviewers: Reviewer[];
  deployments: Deployment[];
};

const ACTOR = "__typename login avatarUrl(size: 64) ... on User { name }";

const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    viewerPermission autoMergeAllowed deleteBranchOnMerge
    squashMergeCommitTitle squashMergeCommitMessage mergeCommitTitle mergeCommitMessage
    owner { __typename }
    pullRequest(number: $number) {
      body isMergeQueueEnabled isInMergeQueue mergeQueueEntry { position }
      viewerCanUpdateBranch viewerCanEnableAutoMerge viewerCanDisableAutoMerge viewerCanMergeAsAdmin viewerCanDeleteHeadRef
      autoMergeRequest { mergeMethod enabledBy { login } }
      headRef { id } headRefName headRepository { name owner { login } }
      baseRef { refUpdateRule { requiredApprovingReviewCount requiresCodeOwnerReviews requiredStatusCheckContexts requiresConversationResolution requiresLinearHistory } }
      labels(first: 50) { nodes { id name color description } }
      assignees(first: 20) { nodes { ${ACTOR} } }
      milestone { id number title dueOn }
      closingIssuesReferences(first: 10) { nodes { id number title state stateReason url repository { nameWithOwner } } }
      reviewRequests(first: 50) { nodes { asCodeOwner requestedReviewer { __typename ... on User { ${ACTOR} } ... on Team { name slug combinedSlug } } } }
      latestReviews(first: 50) { nodes { author { ${ACTOR} } state } }
      commits(last: 1) { nodes { commit { deployments(last: 10) { nodes { id environment state createdAt latestStatus { state environmentUrl logUrl } } } } } }
    }
  }
}`;

type Raw = {
  repository: {
    viewerPermission: Permission | null;
    autoMergeAllowed: boolean;
    deleteBranchOnMerge: boolean;
    squashMergeCommitTitle: Manage["squashTitle"];
    squashMergeCommitMessage: Manage["squashMessage"];
    mergeCommitTitle: Manage["mergeTitle"];
    mergeCommitMessage: Manage["mergeMessage"];
    owner: { __typename: string };
    pullRequest: {
      body: string;
      isMergeQueueEnabled: boolean;
      isInMergeQueue: boolean;
      mergeQueueEntry: { position: number } | null;
      viewerCanUpdateBranch: boolean;
      viewerCanEnableAutoMerge: boolean;
      viewerCanDisableAutoMerge: boolean;
      viewerCanMergeAsAdmin: boolean;
      viewerCanDeleteHeadRef: boolean;
      autoMergeRequest: { mergeMethod: "MERGE" | "SQUASH" | "REBASE"; enabledBy: { login: string } | null } | null;
      headRef: { id: string } | null;
      headRefName: string;
      headRepository: { name: string; owner: { login: string } } | null;
      baseRef: {
        refUpdateRule: null | {
          requiredApprovingReviewCount: number | null;
          requiresCodeOwnerReviews: boolean;
          requiredStatusCheckContexts: Array<string | null> | null;
          requiresConversationResolution: boolean;
          requiresLinearHistory: boolean;
        };
      } | null;
      labels: { nodes: Label[] };
      assignees: { nodes: NonNullable<Actor>[] };
      milestone: Milestone | null;
      closingIssuesReferences: { nodes: Array<Omit<LinkedIssue, "repo"> & { repository: { nameWithOwner: string } }> };
      reviewRequests: {
        nodes: Array<{
          asCodeOwner: boolean;
          requestedReviewer:
            | null
            | ({ __typename: "User" } & NonNullable<Actor>)
            | ({ __typename: "Team" } & Team)
            | { __typename: "Mannequin" | "Bot" };
        }>;
      };
      latestReviews: { nodes: Array<{ author: Actor; state: NonNullable<Reviewer["state"]> }> };
      commits: {
        nodes: Array<{
          commit: {
            deployments: {
              nodes: Array<{
                id: string;
                environment: string | null;
                state: string;
                createdAt: string;
                latestStatus: { state: string; environmentUrl: string | null; logUrl: string | null } | null;
              }>;
            } | null;
          };
        }>;
      };
    };
  };
};

export function reviewerList(
  requests: Raw["repository"]["pullRequest"]["reviewRequests"]["nodes"],
  reviews: Raw["repository"]["pullRequest"]["latestReviews"]["nodes"],
): Reviewer[] {
  const list: Reviewer[] = [];
  for (const { requestedReviewer: r, asCodeOwner } of requests) {
    if (!r) continue;
    if (r.__typename === "Team" && "slug" in r)
      list.push({
        key: `team:${r.slug}`,
        actor: null,
        team: { slug: r.slug, name: r.name, combinedSlug: r.combinedSlug },
        state: null,
        requested: true,
        codeOwner: asCodeOwner,
      });
    else if ("login" in r)
      list.push({ key: r.login, actor: r, team: null, state: null, requested: true, codeOwner: asCodeOwner });
  }
  for (const review of reviews) {
    if (!review.author) continue;
    const asked = list.find((x) => x.key === review.author!.login);
    if (asked) asked.state = review.state;
    else
      list.push({
        key: review.author.login,
        actor: review.author,
        team: null,
        state: review.state,
        requested: false,
        codeOwner: false,
      });
  }
  return list;
}

const link = (url: string | null | undefined) => (url === "" ? null : (url ?? null));

export async function loadManage(ref: PullRef, again = false): Promise<Manage> {
  const data = await graphql<Raw>(again ? fresh(QUERY) : QUERY, {
    owner: ref.owner,
    name: ref.repo,
    number: ref.number,
  });
  const { pullRequest: pr, ...repo } = data.repository;
  const rule = pr.baseRef?.refUpdateRule;
  return {
    viewerPermission: repo.viewerPermission,
    autoMergeAllowed: repo.autoMergeAllowed,
    deleteBranchOnMerge: repo.deleteBranchOnMerge,
    squashTitle: repo.squashMergeCommitTitle,
    squashMessage: repo.squashMergeCommitMessage,
    mergeTitle: repo.mergeCommitTitle,
    mergeMessage: repo.mergeCommitMessage,
    orgOwned: repo.owner.__typename === "Organization",
    body: pr.body,
    isMergeQueueEnabled: pr.isMergeQueueEnabled,
    isInMergeQueue: pr.isInMergeQueue,
    queuePosition: pr.mergeQueueEntry?.position ?? null,
    viewerCanUpdateBranch: pr.viewerCanUpdateBranch,
    viewerCanEnableAutoMerge: pr.viewerCanEnableAutoMerge,
    viewerCanDisableAutoMerge: pr.viewerCanDisableAutoMerge,
    viewerCanMergeAsAdmin: pr.viewerCanMergeAsAdmin,
    viewerCanDeleteHeadRef: pr.viewerCanDeleteHeadRef,
    autoMerge: pr.autoMergeRequest
      ? { method: pr.autoMergeRequest.mergeMethod, by: pr.autoMergeRequest.enabledBy?.login ?? null }
      : null,
    headRefExists: Boolean(pr.headRef),
    headOwner: pr.headRepository?.owner.login ?? ref.owner,
    headRepo: pr.headRepository?.name ?? ref.repo,
    rule: rule
      ? {
          approvals: rule.requiredApprovingReviewCount ?? 0,
          codeOwners: rule.requiresCodeOwnerReviews,
          checks: (rule.requiredStatusCheckContexts ?? []).filter((c): c is string => Boolean(c)),
          conversations: rule.requiresConversationResolution,
          linear: rule.requiresLinearHistory,
        }
      : null,
    labels: pr.labels.nodes,
    assignees: pr.assignees.nodes,
    milestone: pr.milestone,
    issues: pr.closingIssuesReferences.nodes.map(({ repository, ...i }) => ({ ...i, repo: repository.nameWithOwner })),
    reviewers: reviewerList(pr.reviewRequests.nodes, pr.latestReviews.nodes),
    deployments: (pr.commits.nodes[0]?.commit.deployments?.nodes ?? []).map((d) => ({
      id: d.id,
      environment: d.environment ?? "",
      state: d.latestStatus?.state ?? d.state,
      url: link(d.latestStatus?.environmentUrl),
      logUrl: link(d.latestStatus?.logUrl),
      at: d.createdAt,
    })),
  };
}

export const canWrite = (m: Manage | null) =>
  m?.viewerPermission === "ADMIN" || m?.viewerPermission === "MAINTAIN" || m?.viewerPermission === "WRITE";
export const canTriage = (m: Manage | null) => canWrite(m) || m?.viewerPermission === "TRIAGE";

export function useManage(prId: string, ref: PullRef) {
  const [manage, setManage] = useState<Manage | null>(() => shelved<Manage>(`manage:${prId}`)?.value ?? null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);
  const reload = useCallback(
    async (again = false) => {
      const mine = ++latest.current;
      try {
        const m = await loadManage(ref, again);
        if (mine !== latest.current) return;
        setManage(m);
        setError(null);
        shelve(`manage:${prId}`, m);
      } catch (e) {
        if (mine === latest.current) setError(errorText(e));
      }
    },
    [prId, ref],
  );
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- reload sets state only once GitHub answers, not synchronously
    void reload();
  }, [reload]);
  const patch = useCallback((change: (m: Manage) => Manage) => {
    setManage((m) => (m ? change(m) : m));
  }, []);
  return { manage, error, reload, patch };
}

export type Person = NonNullable<Actor>;

const DAY = 24 * 3_600_000;
const HOUR = 3_600_000;

export function people(ref: PullRef, query: string, onValue: (list: Person[]) => void) {
  type R = { repository: { assignableUsers: { nodes: Person[] } } };
  const load = () =>
    graphql<R>(
      `query($owner: String!, $name: String!, $q: String) { repository(owner: $owner, name: $name) { assignableUsers(first: 100, query: $q) { nodes { ${ACTOR} } } } }`,
      {
        owner: ref.owner,
        name: ref.repo,
        q: query || null,
      },
    ).then((d) => d.repository.assignableUsers.nodes);
  if (query) return load().then(onValue);
  return cachedList(`people:${ref.owner}/${ref.repo}`, DAY, load, onValue);
}

export function teams(ref: PullRef, query: string, onValue: (list: Team[]) => void) {
  type R = { organization: { teams: { nodes: Team[] } } | null };
  const load = () =>
    graphql<R>(
      `
        query ($org: String!, $q: String) {
          organization(login: $org) {
            teams(first: 100, query: $q, orderBy: { field: NAME, direction: ASC }) {
              nodes {
                name
                slug
                combinedSlug
              }
            }
          }
        }
      `,
      {
        org: ref.owner,
        q: query || null,
      },
    ).then((d) => d.organization?.teams.nodes ?? []);
  if (query) return load().then(onValue);
  return cachedList(`teams:${ref.owner}`, DAY, load, onValue);
}

export function labels(ref: PullRef, onValue: (list: Label[]) => void) {
  type R = { repository: { labels: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Label[] } } };
  const load = async () => {
    const all: Label[] = [];
    let after: string | null = null;
    for (let page = 0; page < 10; page++) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last one's cursor
      const data: R = await graphql<R>(
        `
          query ($owner: String!, $name: String!, $after: String) {
            repository(owner: $owner, name: $name) {
              labels(first: 100, after: $after, orderBy: { field: NAME, direction: ASC }) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  id
                  name
                  color
                  description
                }
              }
            }
          }
        `,
        { owner: ref.owner, name: ref.repo, after },
      );
      all.push(...data.repository.labels.nodes);
      if (!data.repository.labels.pageInfo.hasNextPage) break;
      after = data.repository.labels.pageInfo.endCursor;
    }
    return all;
  };
  return cachedList(`labels:${ref.owner}/${ref.repo}`, DAY, load, onValue);
}

export function milestones(ref: PullRef, onValue: (list: Milestone[]) => void) {
  type R = { repository: { milestones: { nodes: Milestone[] } } };
  const load = () =>
    graphql<R>(
      `
        query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            milestones(first: 100, states: OPEN, orderBy: { field: DUE_DATE, direction: ASC }) {
              nodes {
                id
                number
                title
                dueOn
              }
            }
          }
        }
      `,
      { owner: ref.owner, name: ref.repo },
    ).then((d) => d.repository.milestones.nodes);
  return cachedList(`milestones:${ref.owner}/${ref.repo}`, HOUR, load, onValue);
}

const issue = (ref: PullRef) => `/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
const pull = (ref: PullRef) => `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;

export const requestReviews = (ref: PullRef, users: string[], teamSlugs: string[] = []) =>
  github("POST", `${pull(ref)}/requested_reviewers`, { reviewers: users, team_reviewers: teamSlugs });
export const removeReviewRequests = (ref: PullRef, users: string[], teamSlugs: string[] = []) =>
  github("DELETE", `${pull(ref)}/requested_reviewers`, { reviewers: users, team_reviewers: teamSlugs });
export const addAssignees = (ref: PullRef, logins: string[]) =>
  github("POST", `${issue(ref)}/assignees`, { assignees: logins });
export const removeAssignees = (ref: PullRef, logins: string[]) =>
  github("DELETE", `${issue(ref)}/assignees`, { assignees: logins });
export const addLabels = (ref: PullRef, names: string[]) => github("POST", `${issue(ref)}/labels`, { labels: names });
export const removeLabel = (ref: PullRef, name: string) =>
  github("DELETE", `${issue(ref)}/labels/${encodeURIComponent(name)}`);
export const setMilestone = (ref: PullRef, milestone: number | null) => github("PATCH", issue(ref), { milestone });

const byId = (name: string) => (id: string) =>
  graphql(`mutation($id: ID!) { ${name}(input: { pullRequestId: $id }) { clientMutationId } }`, { id });

export const closePull = byId("closePullRequest");
export const reopenPull = byId("reopenPullRequest");
export const convertToDraft = byId("convertPullRequestToDraft");
