// What happened on a pull request besides what was said: commits pushed, force pushes, review
// requests, labels, title changes, drafts and readiness, merging and closing, references from
// elsewhere, deployments. GitHub's timeline, a page at a time from the newest, each event made
// compact (runs of commits by one person, and of label changes, read as one line).

import { graphql } from "../bridge/bridge";
import type { PullRef } from "../review/review";

type Who = string | null;
type Commit = { oid: string; short: string; headline: string; url: string };

type SimpleKind =
  | "ready"
  | "draft"
  | "closed"
  | "reopened"
  | "autoMergeEnabled"
  | "autoMergeDisabled"
  | "queued"
  | "dequeued"
  | "branchDeleted"
  | "branchRestored";

export type TimelineEvent = { id: string; at: string; actor: Who } & (
  | { kind: "commits"; commits: Commit[] }
  | { kind: "forcePushed"; before: string | null; after: string | null; ref: string }
  | { kind: "reviewRequested" | "reviewRequestRemoved"; reviewer: string }
  | { kind: "labels"; added: Array<{ name: string; color: string }>; removed: Array<{ name: string; color: string }> }
  | { kind: "renamed"; from: string; to: string }
  | { kind: SimpleKind }
  | { kind: "merged"; commit: string | null; into: string }
  | {
      kind: "referenced";
      number: number;
      title: string;
      url: string;
      repo: string;
      isPull: boolean;
      willClose: boolean;
    }
  | { kind: "commitReferenced"; commit: string; headline: string; url: string }
  | { kind: "deployed"; environment: string }
  | { kind: "assigned" | "unassigned"; assignee: string }
  | { kind: "milestoned" | "demilestoned"; milestone: string }
  | { kind: "reviewDismissed"; reviewer: string | null; message: string | null }
  | { kind: "baseChanged"; from: string; to: string }
);

const ITEMS = [
  "PULL_REQUEST_COMMIT",
  "HEAD_REF_FORCE_PUSHED_EVENT",
  "REVIEW_REQUESTED_EVENT",
  "REVIEW_REQUEST_REMOVED_EVENT",
  "LABELED_EVENT",
  "UNLABELED_EVENT",
  "RENAMED_TITLE_EVENT",
  "READY_FOR_REVIEW_EVENT",
  "CONVERT_TO_DRAFT_EVENT",
  "MERGED_EVENT",
  "CLOSED_EVENT",
  "REOPENED_EVENT",
  "CROSS_REFERENCED_EVENT",
  "REFERENCED_EVENT",
  "DEPLOYED_EVENT",
  "ASSIGNED_EVENT",
  "UNASSIGNED_EVENT",
  "MILESTONED_EVENT",
  "DEMILESTONED_EVENT",
  "REVIEW_DISMISSED_EVENT",
  "AUTO_MERGE_ENABLED_EVENT",
  "AUTO_MERGE_DISABLED_EVENT",
  "ADDED_TO_MERGE_QUEUE_EVENT",
  "REMOVED_FROM_MERGE_QUEUE_EVENT",
  "HEAD_REF_DELETED_EVENT",
  "HEAD_REF_RESTORED_EVENT",
  "BASE_REF_CHANGED_EVENT",
];

const WHO = "actor { login }";
const REVIEWER =
  "requestedReviewer { __typename ... on User { login } ... on Team { name } ... on Mannequin { login } ... on Bot { login } }";
const ASSIGNEE =
  "assignee { __typename ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Organization { login } }";

const QUERY = `query($owner: String!, $name: String!, $number: Int!, $before: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    timelineItems(last: 60, before: $before, itemTypes: [${ITEMS.join(", ")}]) {
      pageInfo { hasPreviousPage startCursor }
      nodes {
        __typename
        ... on PullRequestCommit { id commit { oid abbreviatedOid messageHeadline committedDate url author { user { login } name } } }
        ... on HeadRefForcePushedEvent { id createdAt ${WHO} beforeCommit { abbreviatedOid } afterCommit { abbreviatedOid } ref { name } }
        ... on ReviewRequestedEvent { id createdAt ${WHO} ${REVIEWER} }
        ... on ReviewRequestRemovedEvent { id createdAt ${WHO} ${REVIEWER} }
        ... on LabeledEvent { id createdAt ${WHO} label { name color } }
        ... on UnlabeledEvent { id createdAt ${WHO} label { name color } }
        ... on RenamedTitleEvent { id createdAt ${WHO} previousTitle currentTitle }
        ... on ReadyForReviewEvent { id createdAt ${WHO} }
        ... on ConvertToDraftEvent { id createdAt ${WHO} }
        ... on MergedEvent { id createdAt ${WHO} commit { abbreviatedOid } mergeRefName }
        ... on ClosedEvent { id createdAt ${WHO} }
        ... on ReopenedEvent { id createdAt ${WHO} }
        ... on CrossReferencedEvent { id createdAt ${WHO} willCloseTarget source { __typename ... on Issue { number title url repository { nameWithOwner } } ... on PullRequest { number title url repository { nameWithOwner } } } }
        ... on ReferencedEvent { id createdAt ${WHO} commit { abbreviatedOid messageHeadline url } }
        ... on DeployedEvent { id createdAt ${WHO} deployment { environment } }
        ... on AssignedEvent { id createdAt ${WHO} ${ASSIGNEE} }
        ... on UnassignedEvent { id createdAt ${WHO} ${ASSIGNEE} }
        ... on MilestonedEvent { id createdAt ${WHO} milestoneTitle }
        ... on DemilestonedEvent { id createdAt ${WHO} milestoneTitle }
        ... on ReviewDismissedEvent { id createdAt ${WHO} dismissalMessage review { author { login } } }
        ... on AutoMergeEnabledEvent { id createdAt ${WHO} }
        ... on AutoMergeDisabledEvent { id createdAt ${WHO} }
        ... on AddedToMergeQueueEvent { id createdAt ${WHO} }
        ... on RemovedFromMergeQueueEvent { id createdAt ${WHO} }
        ... on HeadRefDeletedEvent { id createdAt ${WHO} }
        ... on HeadRefRestoredEvent { id createdAt ${WHO} }
        ... on BaseRefChangedEvent { id createdAt ${WHO} previousRefName currentRefName }
      }
    }
  } }
}`;

type Login = { login: string } | null;
type GitHubEvent<T extends string, F = unknown> = { __typename: T; id: string; createdAt: string; actor?: Login } & F;
type Abbreviated = { abbreviatedOid: string } | null;
type SimpleType =
  | "ReadyForReviewEvent"
  | "ConvertToDraftEvent"
  | "ClosedEvent"
  | "ReopenedEvent"
  | "AutoMergeEnabledEvent"
  | "AutoMergeDisabledEvent"
  | "AddedToMergeQueueEvent"
  | "RemovedFromMergeQueueEvent"
  | "HeadRefDeletedEvent"
  | "HeadRefRestoredEvent";

/** GitHub's timeline nodes, as the query above asks for them. */
export type TimelineNode =
  | {
      __typename: "PullRequestCommit";
      id: string;
      createdAt?: undefined;
      actor?: undefined;
      commit: {
        oid: string;
        abbreviatedOid: string;
        messageHeadline: string;
        committedDate: string;
        url: string;
        author: { user: Login; name: string | null } | null;
      };
    }
  | GitHubEvent<
      "HeadRefForcePushedEvent",
      { beforeCommit: Abbreviated; afterCommit: Abbreviated; ref: { name: string } | null }
    >
  | GitHubEvent<
      "ReviewRequestedEvent" | "ReviewRequestRemovedEvent",
      { requestedReviewer: { __typename: string; login?: string; name?: string } | null }
    >
  | GitHubEvent<"LabeledEvent" | "UnlabeledEvent", { label: { name: string; color: string } }>
  | GitHubEvent<"RenamedTitleEvent", { previousTitle: string; currentTitle: string }>
  | GitHubEvent<"MergedEvent", { commit: Abbreviated; mergeRefName: string }>
  | GitHubEvent<
      "CrossReferencedEvent",
      {
        willCloseTarget: boolean;
        source: {
          __typename: "Issue" | "PullRequest";
          number: number;
          title: string;
          url: string;
          repository: { nameWithOwner: string };
        } | null;
      }
    >
  | GitHubEvent<"ReferencedEvent", { commit: { abbreviatedOid: string; messageHeadline: string; url: string } | null }>
  | GitHubEvent<"DeployedEvent", { deployment: { environment: string } | null }>
  | GitHubEvent<"AssignedEvent" | "UnassignedEvent", { assignee: { __typename: string; login?: string } | null }>
  | GitHubEvent<"MilestonedEvent" | "DemilestonedEvent", { milestoneTitle: string }>
  | GitHubEvent<"ReviewDismissedEvent", { dismissalMessage: string | null; review: { author: Login } | null }>
  | GitHubEvent<"BaseRefChangedEvent", { previousRefName: string; currentRefName: string }>
  | GitHubEvent<SimpleType>;

/** Two changes this close together, by the same person, read as one. */
const TOGETHER = 2 * 60_000;

/** GitHub's timeline nodes (oldest first) as events (oldest first): consecutive commits by one
 *  author in one line, label changes made together in one, unknown kinds left out. */
export function mapTimeline(nodes: TimelineNode[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const n of nodes) {
    const base = { id: n.id, at: n.createdAt ?? "", actor: n.actor?.login ?? null };
    const last = events.at(-1);
    switch (n.__typename) {
      case "PullRequestCommit": {
        const c = n.commit;
        const author = c.author?.user?.login ?? c.author?.name ?? null;
        const commit = { oid: c.oid, short: c.abbreviatedOid, headline: c.messageHeadline, url: c.url };
        if (last?.kind === "commits" && last.actor === author) {
          last.commits.push(commit);
          last.at = c.committedDate;
        } else events.push({ ...base, at: c.committedDate, actor: author, kind: "commits", commits: [commit] });
        break;
      }
      case "HeadRefForcePushedEvent":
        events.push({
          ...base,
          kind: "forcePushed",
          before: n.beforeCommit?.abbreviatedOid ?? null,
          after: n.afterCommit?.abbreviatedOid ?? null,
          ref: n.ref?.name ?? "",
        });
        break;
      case "ReviewRequestedEvent":
      case "ReviewRequestRemovedEvent": {
        const r = n.requestedReviewer;
        if (!r) break;
        events.push({
          ...base,
          kind: n.__typename === "ReviewRequestedEvent" ? "reviewRequested" : "reviewRequestRemoved",
          reviewer: r.login ?? r.name ?? "",
        });
        break;
      }
      case "LabeledEvent":
      case "UnlabeledEvent": {
        const label = { name: n.label.name, color: n.label.color };
        const added = n.__typename === "LabeledEvent";
        if (
          last?.kind === "labels" &&
          last.actor === base.actor &&
          Date.parse(base.at) - Date.parse(last.at) < TOGETHER
        ) {
          (added ? last.added : last.removed).push(label);
          last.at = base.at;
        } else events.push({ ...base, kind: "labels", added: added ? [label] : [], removed: added ? [] : [label] });
        break;
      }
      case "RenamedTitleEvent":
        events.push({ ...base, kind: "renamed", from: n.previousTitle, to: n.currentTitle });
        break;
      case "MergedEvent":
        events.push({ ...base, kind: "merged", commit: n.commit?.abbreviatedOid ?? null, into: n.mergeRefName });
        break;
      case "CrossReferencedEvent": {
        const s = n.source;
        if (!s?.url) break;
        events.push({
          ...base,
          kind: "referenced",
          number: s.number,
          title: s.title,
          url: s.url,
          repo: s.repository.nameWithOwner,
          isPull: s.__typename === "PullRequest",
          willClose: n.willCloseTarget,
        });
        break;
      }
      case "ReferencedEvent":
        if (!n.commit) break;
        events.push({
          ...base,
          kind: "commitReferenced",
          commit: n.commit.abbreviatedOid,
          headline: n.commit.messageHeadline,
          url: n.commit.url,
        });
        break;
      case "DeployedEvent":
        events.push({ ...base, kind: "deployed", environment: n.deployment?.environment ?? "" });
        break;
      case "AssignedEvent":
      case "UnassignedEvent":
        if (!n.assignee?.login) break;
        events.push({
          ...base,
          kind: n.__typename === "AssignedEvent" ? "assigned" : "unassigned",
          assignee: n.assignee.login,
        });
        break;
      case "MilestonedEvent":
      case "DemilestonedEvent":
        events.push({
          ...base,
          kind: n.__typename === "MilestonedEvent" ? "milestoned" : "demilestoned",
          milestone: n.milestoneTitle,
        });
        break;
      case "ReviewDismissedEvent":
        events.push({
          ...base,
          kind: "reviewDismissed",
          reviewer: n.review?.author?.login ?? null,
          message: n.dismissalMessage ?? null,
        });
        break;
      case "BaseRefChangedEvent":
        events.push({ ...base, kind: "baseChanged", from: n.previousRefName, to: n.currentRefName });
        break;
      // Kinds GitHub may add later match no case and are left out.
      case "ReadyForReviewEvent":
      case "ConvertToDraftEvent":
      case "ClosedEvent":
      case "ReopenedEvent":
      case "AutoMergeEnabledEvent":
      case "AutoMergeDisabledEvent":
      case "AddedToMergeQueueEvent":
      case "RemovedFromMergeQueueEvent":
      case "HeadRefDeletedEvent":
      case "HeadRefRestoredEvent":
        events.push({ ...base, kind: SIMPLE[n.__typename] });
        break;
    }
  }
  return events;
}

const SIMPLE: Record<SimpleType, SimpleKind> = {
  ReadyForReviewEvent: "ready",
  ConvertToDraftEvent: "draft",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  AutoMergeEnabledEvent: "autoMergeEnabled",
  AutoMergeDisabledEvent: "autoMergeDisabled",
  AddedToMergeQueueEvent: "queued",
  RemovedFromMergeQueueEvent: "dequeued",
  HeadRefDeletedEvent: "branchDeleted",
  HeadRefRestoredEvent: "branchRestored",
};

export type TimelinePage = { nodes: TimelineNode[]; older: string | null };

/** A page of the timeline, the newest first time, older ones with the cursor it gave (`older`). */
export async function loadTimeline(ref: PullRef, before: string | null = null): Promise<TimelinePage> {
  type R = {
    repository: {
      pullRequest: {
        timelineItems: { pageInfo: { hasPreviousPage: boolean; startCursor: string | null }; nodes: TimelineNode[] };
      };
    };
  };
  const data = await graphql<R>(QUERY, { owner: ref.owner, name: ref.repo, number: ref.number, before });
  const items = data.repository.pullRequest.timelineItems;
  return {
    nodes: items.nodes.filter((n) => n.__typename),
    older: items.pageInfo.hasPreviousPage ? items.pageInfo.startCursor : null,
  };
}

/** The conversation's entries and the timeline's events in one list, newest first (both come
 *  newest first). */
export function byTime<E extends { at: string }>(
  entries: E[],
  events: TimelineEvent[],
): Array<{ kind: "entry"; entry: E } | { kind: "event"; event: TimelineEvent }> {
  const out: Array<{ kind: "entry"; entry: E } | { kind: "event"; event: TimelineEvent }> = [];
  let i = 0;
  let j = 0;
  while (i < entries.length || j < events.length) {
    const entry = entries[i];
    const event = events[j];
    if (entry && (!event || Date.parse(entry.at) >= Date.parse(event.at))) {
      out.push({ kind: "entry", entry });
      i++;
    } else {
      // The loop's condition leaves an event here whenever there's no entry to take.
      out.push({ kind: "event", event: event! });
      j++;
    }
  }
  return out;
}
