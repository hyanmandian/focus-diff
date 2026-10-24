// What the review window needs beyond a pull request's details: each file's patch, the
// conversations on its lines, and the actions of reviewing (comments, replies, resolving, the
// review itself).

import { github, graphql } from "./bridge";
import type { Details } from "./details";
import type { Actor } from "./engine";

export type ReviewFile = {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  /** A unified diff of the file, with git headers, as @pierre/diffs reads it. Empty when GitHub
   *  sends no patch (binary or too large). */
  patch: string;
};

export type ThreadComment = { id: string; databaseId: number; author: Actor; html: string; at: string; url: string };
export type Thread = {
  id: string;
  path: string;
  side: "additions" | "deletions";
  line: number;
  resolved: boolean;
  outdated: boolean;
  comments: ThreadComment[];
};

/** A comment written during this review, sent with it. */
export type Draft = { key: string; path: string; side: "additions" | "deletions"; line: number; startLine?: number; body: string };

const header = (f: { filename: string; previous_filename?: string; status: string }) => {
  const old = f.previous_filename ?? f.filename;
  return [
    `diff --git a/${old} b/${f.filename}`,
    f.status === "added" ? "--- /dev/null" : `--- a/${old}`,
    f.status === "removed" ? "+++ /dev/null" : `+++ b/${f.filename}`,
  ].join("\n");
};

export async function loadFiles(d: Details): Promise<ReviewFile[]> {
  type Raw = { filename: string; previous_filename?: string; status: ReviewFile["status"]; additions: number; deletions: number; patch?: string };
  const files: ReviewFile[] = [];
  // GitHub lists at most 3,000 files, 100 a page.
  for (let page = 1; page <= 30; page++) {
    const batch = await github<Raw[]>("GET", `/repos/${d.owner}/${d.repo}/pulls/${d.number}/files?per_page=100&page=${page}`);
    for (const f of batch) {
      files.push({
        path: f.filename,
        previousPath: f.previous_filename ?? null,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ? `${header(f)}\n${f.patch}\n` : "",
      });
    }
    if (batch.length < 100) break;
  }
  return files;
}

const ACTOR = "__typename login avatarUrl(size: 64) ... on User { name }";

export async function loadThreads(d: Details): Promise<Thread[]> {
  type Raw = {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{
            id: string;
            isResolved: boolean;
            isOutdated: boolean;
            path: string;
            line: number | null;
            originalLine: number | null;
            diffSide: "LEFT" | "RIGHT";
            comments: { nodes: Array<{ id: string; databaseId: number; author: Actor; bodyHTML: string; createdAt: string; url: string }> };
          }>;
        };
      };
    };
  };
  const threads: Thread[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: Raw = await graphql<Raw>(
      `query($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id isResolved isOutdated path line originalLine diffSide
              comments(first: 50) { nodes { id databaseId author { ${ACTOR} } bodyHTML createdAt url } } }
          }
        } }
      }`,
      { owner: d.owner, name: d.repo, number: d.number, after },
    );
    const page_ = data.repository.pullRequest.reviewThreads;
    for (const t of page_.nodes) {
      const line = t.line ?? t.originalLine;
      if (line === null) continue;
      threads.push({
        id: t.id,
        path: t.path,
        side: t.diffSide === "LEFT" ? "deletions" : "additions",
        line,
        resolved: t.isResolved,
        outdated: t.isOutdated,
        comments: t.comments.nodes.map((c) => ({ id: c.id, databaseId: c.databaseId, author: c.author, html: c.bodyHTML, at: c.createdAt, url: c.url })),
      });
    }
    if (!page_.pageInfo.hasNextPage) break;
    after = page_.pageInfo.endCursor;
  }
  return threads;
}

// MARK: Actions

const base = (d: Details) => `/repos/${d.owner}/${d.repo}/pulls/${d.number}`;
const toSide = (side: Draft["side"]) => (side === "deletions" ? "LEFT" : "RIGHT");

const draftPayload = (draft: Draft) => ({
  path: draft.path,
  body: draft.body,
  line: draft.line,
  side: toSide(draft.side),
  ...(draft.startLine !== undefined && draft.startLine !== draft.line ? { start_line: draft.startLine, start_side: toSide(draft.side) } : {}),
});

/** The review, with the comments written during it. */
export function submitReview(d: Details, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string, drafts: Draft[]) {
  if (event === "COMMENT" && !body.trim() && !drafts.length) throw new Error("Write a comment, or add some on the lines, first.");
  return github("POST", `${base(d)}/reviews`, { event, body: body.trim(), comments: drafts.map(draftPayload) });
}

/** A single comment, posted right away rather than with the review. */
export const commentNow = (d: Details, draft: Draft) => github("POST", `${base(d)}/comments`, { ...draftPayload(draft), commit_id: d.headRefOid });

export const reply = (d: Details, thread: Thread, body: string) => {
  const first = thread.comments[0];
  if (!first) throw new Error("This conversation has no comment to reply to.");
  return github("POST", `${base(d)}/comments/${first.databaseId}/replies`, { body });
};

export const setResolved = (thread: Thread, resolved: boolean) =>
  graphql(`mutation($id: ID!) { ${resolved ? "resolveReviewThread" : "unresolveReviewThread"}(input: { threadId: $id }) { thread { id } } }`, { id: thread.id });
