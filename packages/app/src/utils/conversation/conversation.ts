// The whole conversation on a pull request, however long: every comment and review (the details
// query, utils/details/details.ts, has only the latest), each with its Markdown, reactions and what you may
// do to it; and what the description and suggestions need (its Markdown, whether you can edit it,
// apply suggestions, the branch to commit them to). Kept on disk like the rest of a review (kept.ts),
// so it shows at once next time.

import { graphql } from "../bridge/bridge";
import { AUTHOR, REACTION_FIELDS, toReactions, type Reaction } from "../comments/comments";
import type { Entry } from "../details/details";
import { invoke } from "../platform/platform";
import type { PullRef } from "../review/review";

/** What a comment or review says beyond its HTML, and what you may do with it. */
export type Said = {
  body: string;
  canEdit: boolean;
  canDelete: boolean;
  canReact: boolean;
  edited: boolean;
  reactions: Reaction[];
};
export type ConversationEntry = Entry & Said;

export type Conversation = {
  /** The description's Markdown and HTML (newer than the details' when it's just been edited). */
  body: string;
  html: string;
  canEdit: boolean;
  canReact: boolean;
  reactions: Reaction[];
  /** Whether you can commit suggestions to the pull request's branch. */
  canApplySuggestion: boolean;
  /** Where its branch is ("owner/name"): a fork, perhaps. */
  headRepo: string | null;
  headRef: string;
  headOid: string;
  /** Newest first, as the Overview shows them. */
  entries: ConversationEntry[];
};

const SAID = `body bodyHTML createdAt url lastEditedAt viewerCanUpdate viewerCanDelete viewerCanReact ${REACTION_FIELDS}`;
const REVIEW_COMMENTS = `comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { id path line bodyHTML author { ${AUTHOR} } url } }`;

type RawSaid = {
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
  lastEditedAt: string | null;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  viewerCanReact: boolean;
  reactionGroups: Parameters<typeof toReactions>[0];
};
type RawReviewComment = {
  id: string;
  path: string;
  line: number | null;
  bodyHTML: string;
  author: Entry["author"];
  url: string;
};
type Page<T> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: T[] };
type RawItem =
  | ({ __typename: "IssueComment"; id: string; author: Entry["author"] } & RawSaid)
  | ({
      __typename: "PullRequestReview";
      id: string;
      author: Entry["author"];
      state: string;
      comments: Page<RawReviewComment>;
    } & RawSaid);

const said = (n: RawSaid): Said => ({
  body: n.body,
  canEdit: n.viewerCanUpdate,
  canDelete: n.viewerCanDelete,
  canReact: n.viewerCanReact,
  edited: Boolean(n.lastEditedAt),
  reactions: toReactions(n.reactionGroups),
});

const toComment = (c: RawReviewComment) => ({
  id: c.id,
  path: c.path,
  line: c.line,
  html: c.bodyHTML,
  author: c.author,
  url: c.url,
});

export async function loadConversation(d: PullRef): Promise<Conversation> {
  type Raw = {
    repository: {
      pullRequest: {
        body?: string;
        bodyHTML?: string;
        viewerCanUpdate?: boolean;
        viewerCanReact?: boolean;
        viewerCanApplySuggestion?: boolean;
        headRefName?: string;
        headRefOid?: string;
        headRepository?: { nameWithOwner: string } | null;
        reactionGroups?: Parameters<typeof toReactions>[0];
        timelineItems: Page<RawItem>;
      };
    };
  };
  let head: Omit<Conversation, "entries"> | null = null;
  const entries: ConversationEntry[] = [];
  const longer: Array<Promise<unknown>> = [];
  let after: string | null = null;
  // As long as it is, a hundred a page (with the pull request's own fields on the first).
  for (let page = 0; page < 100; page++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page needs the cursor the one before gave
    const data: Raw = await graphql<Raw>(
      `query($owner: String!, $name: String!, $number: Int!, $after: String, $first: Boolean!) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          body @include(if: $first) bodyHTML @include(if: $first) viewerCanUpdate @include(if: $first) viewerCanReact @include(if: $first)
          viewerCanApplySuggestion @include(if: $first) headRefName @include(if: $first) headRefOid @include(if: $first)
          headRepository @include(if: $first) { nameWithOwner }
          reactionGroups @include(if: $first) { content viewerHasReacted reactors(first: 5) { totalCount nodes { ... on Actor { login } } } }
          timelineItems(first: 100, after: $after, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW]) { pageInfo { hasNextPage endCursor } nodes {
            __typename
            ... on IssueComment { id author { ${AUTHOR} } ${SAID} }
            ... on PullRequestReview { id author { ${AUTHOR} } state ${SAID} ${REVIEW_COMMENTS} }
          } }
        } }
      }`,
      { owner: d.owner, name: d.repo, number: d.number, after, first: page === 0 },
    );
    const pr = data.repository.pullRequest;
    head ??= {
      body: pr.body ?? "",
      html: pr.bodyHTML ?? "",
      canEdit: Boolean(pr.viewerCanUpdate),
      canReact: Boolean(pr.viewerCanReact),
      reactions: toReactions(pr.reactionGroups),
      canApplySuggestion: Boolean(pr.viewerCanApplySuggestion),
      headRepo: pr.headRepository?.nameWithOwner ?? null,
      headRef: pr.headRefName ?? "",
      headOid: pr.headRefOid ?? "",
    };
    for (const node of pr.timelineItems.nodes) {
      if (node.__typename === "IssueComment") {
        entries.push({
          kind: "comment",
          id: node.id,
          author: node.author,
          html: node.bodyHTML,
          at: node.createdAt,
          url: node.url,
          ...said(node),
        });
      } else {
        // Your pending review isn't part of the conversation yet: its comments show as pending.
        if (node.state === "PENDING") continue;
        const comments = node.comments.nodes.map(toComment);
        entries.push({
          kind: "review",
          id: node.id,
          author: node.author,
          state: node.state,
          html: node.bodyHTML,
          at: node.createdAt,
          url: node.url,
          comments,
          ...said(node),
        });
        const cursor = node.comments.pageInfo.hasNextPage ? node.comments.pageInfo.endCursor : null;
        if (cursor) longer.push(moreReviewComments(node.id, cursor).then((rest) => comments.push(...rest)));
      }
    }
    if (!pr.timelineItems.pageInfo.hasNextPage) break;
    after = pr.timelineItems.pageInfo.endCursor;
  }
  await Promise.all(longer);
  return { ...head!, entries: entries.toReversed() };
}

/** A review's comments past its first hundred. */
async function moreReviewComments(review: string, after: string) {
  const all: ReturnType<typeof toComment>[] = [];
  let cursor: string | null = after;
  for (let page = 0; cursor && page < 50; page++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page needs the cursor the one before gave
    const data: { node: { comments: Page<RawReviewComment> } | null } = await graphql(
      `query($id: ID!, $after: String) { node(id: $id) { ... on PullRequestReview { comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { id path line bodyHTML author { ${AUTHOR} } url } } } } }`,
      { id: review, after: cursor },
    );
    if (!data.node) break;
    all.push(...data.node.comments.nodes.map(toComment));
    cursor = data.node.comments.pageInfo.hasNextPage ? data.node.comments.pageInfo.endCursor : null;
  }
  return all;
}

// Beside the review's own copy (kept.ts), under the pull request's id and a suffix.
const keptId = (prId: string) => `${prId}-conversation`;

export async function readKeptConversation(prId: string): Promise<Conversation | null> {
  try {
    const text = await invoke<string | null>("kept_read", { id: keptId(prId) });
    if (!text) return null;
    const kept: unknown = JSON.parse(text);
    return isConversation(kept) ? kept : null;
  } catch {
    return null;
  }
}

/** Enough of a check that a kept copy from an older version, or a damaged one, isn't taken for one. */
const isConversation = (value: unknown): value is Conversation =>
  typeof value === "object" && value !== null && "entries" in value && Array.isArray(value.entries);

export function keepConversation(prId: string, conversation: Conversation) {
  // Only slower next time if it fails.
  invoke("kept_write", { id: keptId(prId), contents: JSON.stringify(conversation) }).catch(() => {});
}
