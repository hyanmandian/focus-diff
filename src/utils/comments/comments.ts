// What can be done to what's been said on a pull request, beyond saying more: reactions, editing and
// deleting your own comments (and the description), and the fields every comment is read with.

import { github, GitHubError, graphql } from "@/utils/bridge/bridge";
import type { Actor } from "@/utils/engine/engine";
import { i18n } from "@/utils/i18n/i18n";

/** GitHub's eight reactions, in its order. */
export const REACTIONS = [
  "THUMBS_UP",
  "THUMBS_DOWN",
  "LAUGH",
  "HOORAY",
  "CONFUSED",
  "HEART",
  "ROCKET",
  "EYES",
] as const;
export type ReactionContent = (typeof REACTIONS)[number];
export const EMOJI: Record<ReactionContent, string> = {
  THUMBS_UP: "👍",
  THUMBS_DOWN: "👎",
  LAUGH: "😄",
  HOORAY: "🎉",
  CONFUSED: "😕",
  HEART: "❤️",
  ROCKET: "🚀",
  EYES: "👀",
};

/** One reaction on something: how many, whether you're one of them, and the first few who are. */
export type Reaction = { content: ReactionContent; count: number; mine: boolean; who: string[] };

export const REACTION_FIELDS =
  "reactionGroups { content viewerHasReacted reactors(first: 5) { totalCount nodes { ... on Actor { login } } } }";

type RawGroup = {
  content: ReactionContent;
  viewerHasReacted: boolean;
  reactors: { totalCount: number; nodes: Array<{ login?: string } | null> };
};

/** Only the reactions someone gave, in GitHub's order. */
export const toReactions = (groups: RawGroup[] | null | undefined): Reaction[] =>
  (groups ?? [])
    .filter((g) => g.reactors.totalCount > 0 && REACTIONS.includes(g.content))
    .sort((a, b) => REACTIONS.indexOf(a.content) - REACTIONS.indexOf(b.content))
    .map((g) => ({
      content: g.content,
      count: g.reactors.totalCount,
      mine: g.viewerHasReacted,
      who: g.reactors.nodes.flatMap((n) => (n?.login ? [n.login] : [])),
    }));

/** The reactions after you add or take back one, at once, before GitHub says. */
export function toggled(reactions: Reaction[], content: ReactionContent, me: string | null): Reaction[] {
  const at = reactions.find((r) => r.content === content);
  if (at?.mine) {
    return reactions.flatMap((r) =>
      r.content === content
        ? r.count > 1
          ? [{ ...r, count: r.count - 1, mine: false, who: r.who.filter((w) => w !== me) }]
          : []
        : [r],
    );
  }
  if (at)
    return reactions.map((r) =>
      r.content === content ? { ...r, count: r.count + 1, mine: true, who: me ? [me, ...r.who] : r.who } : r,
    );
  return [...reactions, { content, count: 1, mine: true, who: me ? [me] : [] }].sort(
    (a, b) => REACTIONS.indexOf(a.content) - REACTIONS.indexOf(b.content),
  );
}

/** A mutation: unlike a query, an error in it is the answer, even with data beside it. */
export async function mutate<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const reply = await github<{ data?: T; errors?: Array<{ message: string }> }>("POST", "/graphql", {
    query,
    variables,
  });
  if (reply.errors?.length || !reply.data)
    throw new GitHubError(200, reply.errors?.[0]?.message ?? i18n()("common.githubNoData"));
  return reply.data;
}

export const react = (subject: string, content: ReactionContent, on: boolean) =>
  mutate(
    `mutation($id: ID!, $content: ReactionContent!) { ${on ? "addReaction" : "removeReaction"}(input: { subjectId: $id, content: $content }) { clientMutationId } }`,
    { id: subject, content },
  );

/** What can be edited: a comment on lines, one on the pull request, a review's own text, or the
 *  pull request's description. */
export type Editable = "review-comment" | "issue-comment" | "review" | "pull";

const EDIT: Record<Editable, { mutation: string; input: string; field: string }> = {
  "review-comment": {
    mutation: "updatePullRequestReviewComment",
    input: "pullRequestReviewCommentId",
    field: "pullRequestReviewComment",
  },
  "issue-comment": { mutation: "updateIssueComment", input: "id", field: "issueComment" },
  review: { mutation: "updatePullRequestReview", input: "pullRequestReviewId", field: "pullRequestReview" },
  pull: { mutation: "updatePullRequest", input: "pullRequestId", field: "pullRequest" },
};

/** Changes the text; GitHub sends back its HTML, shown at once. */
export async function edit(kind: Editable, id: string, body: string): Promise<string> {
  const e = EDIT[kind];
  const data = await mutate<Record<string, Record<string, { bodyHTML: string }>>>(
    `mutation($id: ID!, $body: String!) { ${e.mutation}(input: { ${e.input}: $id, body: $body }) { ${e.field} { bodyHTML } } }`,
    { id, body },
  );
  return data[e.mutation]?.[e.field]?.bodyHTML ?? "";
}

export const remove = (kind: "review-comment" | "issue-comment", id: string) =>
  mutate(
    `mutation($id: ID!) { ${kind === "review-comment" ? "deletePullRequestReviewComment" : "deleteIssueComment"}(input: { id: $id }) { clientMutationId } }`,
    { id },
  );

/** The person a comment is by, with what a suggestion's commit credits them with. */
export const AUTHOR = "__typename login avatarUrl(size: 64) ... on User { name databaseId }";

/** Every comment on lines is read with these (utils/review/review.ts reads them with its conversations). */
export const COMMENT_FIELDS = `id databaseId author { ${AUTHOR} } body bodyHTML createdAt url state lastEditedAt viewerCanUpdate viewerCanDelete viewerCanReact replyTo { id } ${REACTION_FIELDS}`;

export type RawComment = {
  id: string;
  databaseId: number;
  author: (NonNullable<Actor> & { databaseId?: number }) | null;
  body: string;
  bodyHTML: string;
  createdAt: string;
  url: string;
  state?: "PENDING" | "SUBMITTED" | string;
  lastEditedAt: string | null;
  viewerCanUpdate: boolean;
  viewerCanDelete: boolean;
  viewerCanReact: boolean;
  replyTo: { id: string } | null;
  reactionGroups: RawGroup[];
};

/** A conversation's comments past its first hundred, a hundred a page. */
export async function moreComments(thread: string, after: string): Promise<RawComment[]> {
  type Raw = {
    node: { comments: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawComment[] } } | null;
  };
  const all: RawComment[] = [];
  let cursor: string | null = after;
  for (let page = 0; cursor && page < 50; page++) {
    const data: Raw = await graphql<Raw>(
      `query($id: ID!, $after: String) { node(id: $id) { ... on PullRequestReviewThread { comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } } } }`,
      { id: thread, after: cursor },
    );
    const comments = data.node?.comments;
    if (!comments) break;
    all.push(...comments.nodes);
    cursor = comments.pageInfo.hasNextPage ? comments.pageInfo.endCursor : null;
  }
  return all;
}
