// What the review window needs beyond a pull request's details: each file's patch, the
// conversations on its lines, and the actions of reviewing (comments, replies, resolving, the
// review itself).

import { github, graphql } from "./bridge";
import { COMMENT_FIELDS, moreComments, toReactions, type RawComment, type Reaction } from "./comments";
import type { Details } from "./details";
import type { Actor } from "./engine";
import { i18n } from "./i18n";
import { hunkTail } from "./placement";

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

export type ThreadComment = {
  id: string;
  databaseId: number;
  author: Actor;
  html: string;
  at: string;
  url: string;
  /** Its Markdown, for editing it and for its suggestions. (Optional: copies kept from before.) */
  body?: string;
  /** In your pending review, not yet sent. */
  pending?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canReact?: boolean;
  edited?: boolean;
  reactions?: Reaction[];
  /** The author's number on GitHub, to credit them in a suggestion's commit. */
  authorId?: number | null;
};
export type Thread = {
  id: string;
  path: string;
  side: "additions" | "deletions";
  /** 0: on the file as a whole, not a line. */
  line: number;
  /** Where it starts, when it's on several lines. */
  startLine?: number | null;
  resolved: boolean;
  outdated: boolean;
  /** The commented line's code when the comment was made (the end of GitHub's diffHunk), to tell whether an
   *  outdated conversation's line is still that code (placement.ts). */
  context?: string;
  comments: ThreadComment[];
  /** Started in your pending review: shown as one of your pending comments, not a conversation. */
  pending?: boolean;
};

/** A comment written during this review, sent with it. It goes into your pending review on GitHub
 *  as soon as it can (src-tauri/src/drafts.rs), so github.com has it too. */
export type Draft = {
  key: string;
  path: string;
  side: "additions" | "deletions";
  line: number;
  startLine?: number;
  /** The side several lines start on, when it's the other one (across the two). */
  startSide?: "additions" | "deletions";
  body: string;
  /** Its id in your pending review on GitHub, once it's there. */
  id?: string;
  /** GitHub's HTML for it, once it's there. */
  html?: string;
  /** On the file as a whole rather than lines. */
  file?: boolean;
  /** A reply to this conversation, sent with the review. */
  replyTo?: string;
};

/** The git headers @pierre/diffs needs above a file's patch (GitHub sends the hunks only). */
export const header = (f: { filename: string; previous_filename?: string; status: string }) => {
  const old = f.previous_filename ?? f.filename;
  return [
    `diff --git a/${old} b/${f.filename}`,
    // Named a rename, the file's header says "old → new" and its old version is read under the old name.
    ...(old !== f.filename ? [`rename from ${old}`, `rename to ${f.filename}`] : []),
    f.status === "added" ? "--- /dev/null" : `--- a/${old}`,
    f.status === "removed" ? "+++ /dev/null" : `+++ b/${f.filename}`,
  ].join("\n");
};

/** What finds a pull request: enough to load its files and conversations before its details. */
export type PullRef = Pick<Details, "owner" | "repo" | "number">;

/** GitHub lists at most 3,000 files, 100 a page. */
const PAGES = 30;

/** `count`: how many files the pull request has, when known (its details): every page past the
 *  first is then asked for at once. Otherwise they're asked for a few at a time until one isn't full. */
export async function loadFiles(d: PullRef, count?: number): Promise<ReviewFile[]> {
  type Raw = { filename: string; previous_filename?: string; status: ReviewFile["status"]; additions: number; deletions: number; patch?: string };
  const page = (n: number) => github<Raw[]>("GET", `/repos/${d.owner}/${d.repo}/pulls/${d.number}/files?per_page=100&page=${n}`);
  const pages = [await page(1)];
  if (pages[0]!.length === 100) {
    const known = count ? Math.min(PAGES, Math.ceil(count / 100)) : 0;
    if (known > 1) pages.push(...(await Promise.all(Array.from({ length: known - 1 }, (_, i) => page(i + 2)))));
    // Carry on while pages come back full: a few at a time without a count, one by one past a
    // count that's behind what's there now.
    const step = known ? 1 : 4;
    for (let next = Math.max(2, known + 1); next <= PAGES && pages[pages.length - 1]!.length === 100; next += step) {
      pages.push(...(await Promise.all(Array.from({ length: Math.min(step, PAGES - next + 1) }, (_, i) => page(next + i)))));
    }
  }
  const files: ReviewFile[] = [];
  for (const batch of pages) {
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

const toComment = (c: RawComment): ThreadComment => ({
  id: c.id,
  databaseId: c.databaseId,
  author: c.author,
  html: c.bodyHTML,
  at: c.createdAt,
  url: c.url,
  body: c.body,
  pending: c.state === "PENDING",
  canEdit: c.viewerCanUpdate,
  canDelete: c.viewerCanDelete,
  canReact: c.viewerCanReact,
  edited: Boolean(c.lastEditedAt),
  reactions: toReactions(c.reactionGroups),
  authorId: c.author?.databaseId ?? null,
});

export async function loadThreads(d: PullRef): Promise<Thread[]> {
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
            startLine: number | null;
            subjectType: "LINE" | "FILE" | null;
            diffSide: "LEFT" | "RIGHT";
            hunk: { nodes: Array<{ diffHunk: string | null }> };
            comments: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawComment[] };
          }>;
        };
      };
    };
  };
  const threads: Thread[] = [];
  const longer: Array<Promise<void>> = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: Raw = await graphql<Raw>(
      `query($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { id isResolved isOutdated path line originalLine startLine subjectType diffSide
              hunk: comments(first: 1) { nodes { diffHunk } }
              comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } } }
          }
        } }
      }`,
      { owner: d.owner, name: d.repo, number: d.number, after },
    );
    const page_ = data.repository.pullRequest.reviewThreads;
    for (const t of page_.nodes) {
      // A comment on the file as a whole has no line; it's kept, at the top of the file.
      const line = t.subjectType === "FILE" ? 0 : (t.line ?? t.originalLine ?? 0);
      const thread: Thread = {
        id: t.id,
        path: t.path,
        side: t.diffSide === "LEFT" ? "deletions" : "additions",
        line,
        startLine: t.startLine,
        resolved: t.isResolved,
        outdated: t.isOutdated,
        context: hunkTail(t.hunk?.nodes[0]?.diffHunk),
        comments: t.comments.nodes.map(toComment),
        pending: t.comments.nodes[0]?.state === "PENDING",
      };
      threads.push(thread);
      // A long conversation: the rest of it, alongside the other pages.
      const cursor = t.comments.pageInfo.hasNextPage ? t.comments.pageInfo.endCursor : null;
      if (cursor) longer.push(moreComments(t.id, cursor).then((rest) => void thread.comments.push(...rest.map(toComment))));
    }
    if (!page_.pageInfo.hasNextPage) break;
    after = page_.pageInfo.endCursor;
  }
  await Promise.all(longer);
  return threads;
}

/** What GitHub says you've viewed. DISMISSED: viewed once, changed since. */
export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

/** Your viewed files on github.com, by path, so the app and the site agree. */
export async function loadViewed(d: PullRef): Promise<Map<string, ViewedState>> {
  type Raw = { repository: { pullRequest: { files: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ path: string; viewerViewedState: ViewedState }> } } } };
  const states = new Map<string, ViewedState>();
  let after: string | null = null;
  // As many as the files list has, 100 a page.
  for (let page = 0; page < 30; page++) {
    const data: Raw = await graphql<Raw>(
      `query($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) { pullRequest(number: $number) {
          files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path viewerViewedState } }
        } }
      }`,
      { owner: d.owner, name: d.repo, number: d.number, after },
    );
    const files = data.repository.pullRequest.files;
    for (const f of files.nodes) states.set(f.path, f.viewerViewedState);
    if (!files.pageInfo.hasNextPage) break;
    after = files.pageInfo.endCursor;
  }
  return states;
}

// MARK: Actions

const base = (d: Details) => `/repos/${d.owner}/${d.repo}/pulls/${d.number}`;
const toSide = (side: Draft["side"]) => (side === "deletions" ? "LEFT" : "RIGHT");

const draftPayload = (draft: Draft) =>
  draft.file
    ? { path: draft.path, body: draft.body, subject_type: "file" }
    : {
        path: draft.path,
        body: draft.body,
        line: draft.line,
        side: toSide(draft.side),
        // Several lines: where they start, on the side they start on (the old side's, across the two).
        ...(draft.startLine !== undefined && (draft.startLine !== draft.line || (draft.startSide ?? draft.side) !== draft.side) ? { start_line: draft.startLine, start_side: toSide(draft.startSide ?? draft.side) } : {}),
      };

/** A single comment, posted right away rather than with the review. */
export const commentNow = (d: Details, draft: Draft) => github("POST", `${base(d)}/comments`, { ...draftPayload(draft), commit_id: d.headRefOid });

export const reply = (d: Details, thread: Thread, body: string) => {
  const first = thread.comments[0];
  if (!first) throw new Error(i18n()("config.replyNoComment"));
  return github("POST", `${base(d)}/comments/${first.databaseId}/replies`, { body });
};

export const setResolved = (thread: Thread, resolved: boolean) =>
  graphql(`mutation($id: ID!) { ${resolved ? "resolveReviewThread" : "unresolveReviewThread"}(input: { threadId: $id }) { thread { id } } }`, { id: thread.id });
