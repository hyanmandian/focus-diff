// Your pending review, as GitHub keeps it: the comments written during a review live there (so
// github.com shows them too, and a review started on the site carries on here), while the window
// shows them at once from what's on their way (src-tauri/src/drafts.rs) and what was last seen.

import { bridge, graphql, type DraftChange, type DraftsState } from "../bridge/bridge";
import { mutate } from "../comments/comments";
import type { Details } from "../details/details";
import { i18n } from "../i18n/i18n";
import type { Draft, PullRef, Thread } from "../review/review";

/** One of your pending review's comments, as GitHub has it. */
export type PendingComment = {
  id: string;
  body: string;
  html: string;
  path: string;
  line: number;
  startLine: number | null;
  file: boolean;
  /** The comment it answers, for a reply to a conversation. */
  replyTo: string | null;
};
export type PendingReview = { id: string; comments: PendingComment[] };

type RawComment = {
  id: string;
  body: string;
  bodyHTML: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine: number | null;
  subjectType: "LINE" | "FILE" | null;
  replyTo: { id: string } | null;
};
const FIELDS = "id body bodyHTML path line originalLine startLine originalStartLine subjectType replyTo { id }";

const toPending = (c: RawComment): PendingComment => ({
  id: c.id,
  body: c.body,
  html: c.bodyHTML,
  path: c.path,
  line: c.subjectType === "FILE" ? 0 : (c.line ?? c.originalLine ?? 0),
  startLine: c.startLine ?? c.originalStartLine,
  file: c.subjectType === "FILE",
  replyTo: c.replyTo?.id ?? null,
});

/** Your pending review on this pull request, if you have one (GitHub allows one at a time). */
export async function loadPending(d: PullRef): Promise<PendingReview | null> {
  type Page = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawComment[] };
  type Raw = {
    repository: {
      pullRequest: { reviews: { nodes: Array<{ id: string; viewerDidAuthor: boolean; comments: Page }> } };
    };
  };
  const data = await graphql<Raw>(
    `query($owner: String!, $name: String!, $number: Int!) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        reviews(states: PENDING, first: 5) { nodes { id viewerDidAuthor comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { ${FIELDS} } } } }
      } }
    }`,
    { owner: d.owner, name: d.repo, number: d.number },
  );
  const review = data.repository.pullRequest.reviews.nodes.find((r) => r.viewerDidAuthor);
  if (!review) return null;
  const comments = review.comments.nodes.map(toPending);
  // More than a hundred: the rest, a hundred a page.
  let cursor = review.comments.pageInfo.hasNextPage ? review.comments.pageInfo.endCursor : null;
  for (let page = 0; cursor && page < 50; page++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last one's cursor
    const more: { node: { comments: Page } | null } = await graphql(
      `query($id: ID!, $after: String) { node(id: $id) { ... on PullRequestReview { comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${FIELDS} } } } } }`,
      { id: review.id, after: cursor },
    );
    if (!more.node) break;
    comments.push(...more.node.comments.nodes.map(toPending));
    cursor = more.node.comments.pageInfo.hasNextPage ? more.node.comments.pageInfo.endCursor : null;
  }
  return { id: review.id, comments };
}

/** What the window shows as your pending comments: GitHub's (when it's been asked), with what's
 *  still on its way on top (the newest text wins, removed ones gone), else the copy kept from last
 *  time. Keys stay as the window made them, so nothing redraws when GitHub gives a comment its id.
 *  `threads`: the conversations, to know which side a comment is on and what a reply answers. */
export function mergeDrafts(
  kept: Draft[],
  github: PendingReview | null,
  state: DraftsState,
  threads: Thread[],
): Draft[] {
  const keyOf = new Map(Object.entries(state.ids).map(([key, id]) => [id, key]));
  const keptBy = new Map(kept.map((d) => [d.key, d]));
  const threadOf = new Map(threads.flatMap((t) => t.comments.map((c) => [c.id, t] as const)));
  let drafts: Draft[] = kept;
  if (github) {
    drafts = github.comments.map((c): Draft => {
      const key = keyOf.get(c.id) ?? c.id;
      const answers = c.replyTo ? threadOf.get(c.replyTo) : undefined;
      // GitHub doesn't say a comment's side, its conversation does; one written here, the window knew.
      const side = keptBy.get(key)?.side ?? threadOf.get(c.id)?.side ?? answers?.side ?? "additions";
      return {
        key,
        id: c.id,
        body: c.body,
        html: c.html,
        path: c.path,
        side,
        line: answers ? answers.line : c.line,
        ...(c.startLine && c.startLine !== c.line ? { startLine: c.startLine } : {}),
        ...(c.file ? { file: true } : {}),
        ...(answers ? { replyTo: answers.id } : {}),
      };
    });
  }
  for (const { change } of state.jobs) {
    if (change.op === "remove") {
      drafts = drafts.filter((d) => d.key !== change.key);
      continue;
    }
    const put = change;
    const at = drafts.findIndex((d) => d.key === put.key);
    const next: Draft = {
      key: put.key,
      path: put.path,
      side: put.side,
      line: put.line,
      body: put.body,
      ...(put.startLine ? { startLine: put.startLine } : {}),
      ...(put.startSide ? { startSide: put.startSide } : {}),
      ...(put.file ? { file: true } : {}),
      ...(put.replyTo ? { replyTo: put.replyTo } : {}),
      ...(put.id || state.ids[put.key] ? { id: put.id ?? state.ids[put.key] } : {}),
    };
    // GitHub's HTML is of the old text; until it has the new, the text shows as written.
    if (at >= 0)
      drafts = drafts.map((d, i) =>
        i === at ? { ...next, ...(d.body === put.body && d.html ? { html: d.html } : {}) } : d,
      );
    else drafts = [...drafts, next];
  }
  return drafts;
}

/** The changes a kept list has that are on neither GitHub nor their way there: comments written
 *  before pending reviews lived on GitHub, or whose sending was lost. They're sent again. */
export function unsent(kept: Draft[], github: PendingReview | null, state: DraftsState): Draft[] {
  const queued = new Set(state.jobs.map((j) => j.change.key));
  const onGitHub = new Set(github?.comments.map((c) => c.id) ?? []);
  return kept.filter((d) => !queued.has(d.key) && !d.id && !state.ids[d.key] && !onGitHub.has(d.key));
}

/** A draft as its change on the way to GitHub. */
export const toPut = (pull: string, d: Draft): Extract<DraftChange, { op: "put" }> => ({
  op: "put",
  key: d.key,
  pull,
  path: d.path,
  line: d.line,
  side: d.side,
  body: d.body,
  ...(d.startLine ? { startLine: d.startLine } : {}),
  ...(d.startSide ? { startSide: d.startSide } : {}),
  ...(d.file ? { file: true } : {}),
  ...(d.id ? { id: d.id } : {}),
  ...(d.replyTo ? { replyTo: d.replyTo } : {}),
});

/** Sends the review: every pending comment reaches GitHub first (Rust says when, or what it
 *  refused), then the review that holds them is submitted. With none, a review is made outright. */
export async function submitPending(
  d: Pick<Details, "id" | "owner" | "repo" | "number">,
  event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
  body: string,
  drafts: number,
) {
  if (event === "COMMENT" && !body.trim() && !drafts) throw new Error(i18n()("config.reviewEmpty"));
  await bridge.draftsFlush(d.id);
  const review = await loadPending(d);
  if (review) {
    await mutate(
      "mutation($id: ID!, $event: PullRequestReviewEvent!, $body: String) { submitPullRequestReview(input: { pullRequestReviewId: $id, event: $event, body: $body }) { clientMutationId } }",
      {
        id: review.id,
        event,
        body: body.trim(),
      },
    );
  } else {
    await mutate(
      "mutation($id: ID!, $event: PullRequestReviewEvent!, $body: String) { addPullRequestReview(input: { pullRequestId: $id, event: $event, body: $body }) { clientMutationId } }",
      {
        id: d.id,
        event,
        body: body.trim(),
      },
    );
  }
  await bridge.draftsForget(d.id);
}

/** Throws the pending review away, here and on GitHub. */
export async function discardPending(d: Pick<Details, "id" | "owner" | "repo" | "number">) {
  await bridge.draftsForget(d.id);
  const review = await loadPending(d);
  if (review)
    await mutate(
      "mutation($id: ID!) { deletePullRequestReview(input: { pullRequestReviewId: $id }) { clientMutationId } }",
      { id: review.id },
    );
}
