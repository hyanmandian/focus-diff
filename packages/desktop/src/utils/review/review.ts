import { github, graphql } from "@/utils/bridge/bridge";
import { COMMENT_FIELDS, moreComments, toReactions, type RawComment, type Reaction } from "@/utils/comments/comments";
import type { Details } from "@/utils/details/details";
import type { Actor } from "@/utils/engine/engine";
import { i18n } from "@/utils/i18n/i18n";
import { hunkTail } from "@/utils/placement/placement";

export type ReviewFile = {
  path: string;
  previousPath: string | null;
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  additions: number;
  deletions: number;
  patch: string;
};

export type ThreadComment = {
  id: string;
  databaseId: number;
  author: Actor;
  html: string;
  at: string;
  url: string;
  body?: string;
  pending?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canReact?: boolean;
  edited?: boolean;
  reactions?: Reaction[];
  authorId?: number | null;
};
export type Thread = {
  id: string;
  path: string;
  side: "additions" | "deletions";
  line: number;
  startLine?: number | null;
  resolved: boolean;
  outdated: boolean;
  context?: string;
  comments: ThreadComment[];
  pending?: boolean;
};

export type Draft = {
  key: string;
  path: string;
  side: "additions" | "deletions";
  line: number;
  startLine?: number;
  startSide?: "additions" | "deletions";
  body: string;
  id?: string;
  html?: string;
  file?: boolean;
  replyTo?: string;
};

export const header = (f: { filename: string; previous_filename?: string; status: string }) => {
  const old = f.previous_filename ?? f.filename;
  return [
    `diff --git a/${old} b/${f.filename}`,
    ...(old === f.filename ? [] : [`rename from ${old}`, `rename to ${f.filename}`]),
    f.status === "added" ? "--- /dev/null" : `--- a/${old}`,
    f.status === "removed" ? "+++ /dev/null" : `+++ b/${f.filename}`,
  ].join("\n");
};

export type PullRef = Pick<Details, "owner" | "repo" | "number">;

const PAGES = 30;

export async function loadFiles(d: PullRef, count?: number): Promise<ReviewFile[]> {
  type Raw = {
    filename: string;
    previous_filename?: string;
    status: ReviewFile["status"];
    additions: number;
    deletions: number;
    patch?: string;
  };
  const page = (n: number) =>
    github<Raw[]>("GET", `/repos/${d.owner}/${d.repo}/pulls/${d.number}/files?per_page=100&page=${n}`);
  const pages = [await page(1)];
  if (pages[0]!.length === 100) {
    const known = count ? Math.min(PAGES, Math.ceil(count / 100)) : 0;
    if (known > 1) pages.push(...(await Promise.all(Array.from({ length: known - 1 }, (_, i) => page(i + 2)))));
    const step = known ? 1 : 4;
    for (let next = Math.max(2, known + 1); next <= PAGES && pages.at(-1)!.length === 100; next += step) {
      pages.push(
        // oxlint-disable-next-line eslint/no-await-in-loop -- whether to go on depends on the last page being full
        ...(await Promise.all(Array.from({ length: Math.min(step, PAGES - next + 1) }, (_, i) => page(next + i)))),
      );
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
            hunk?: { nodes: Array<{ diffHunk: string | null }> } | null;
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
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last one's cursor
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
    const batch = data.repository.pullRequest.reviewThreads;
    for (const t of batch.nodes) {
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
      const cursor = t.comments.pageInfo.hasNextPage ? t.comments.pageInfo.endCursor : null;
      if (cursor)
        longer.push(
          moreComments(t.id, cursor).then((rest) => void thread.comments.push(...rest.map((c) => toComment(c)))),
        );
    }
    if (!batch.pageInfo.hasNextPage) break;
    after = batch.pageInfo.endCursor;
  }
  await Promise.all(longer);
  return threads;
}

export type ViewedState = "VIEWED" | "UNVIEWED" | "DISMISSED";

export async function loadViewed(d: PullRef): Promise<Map<string, ViewedState>> {
  type Raw = {
    repository: {
      pullRequest: {
        files: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{ path: string; viewerViewedState: ViewedState }>;
        };
      };
    };
  };
  const states = new Map<string, ViewedState>();
  let after: string | null = null;
  for (let page = 0; page < 30; page++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last one's cursor
    const data: Raw = await graphql<Raw>(
      `
        query ($owner: String!, $name: String!, $number: Int!, $after: String) {
          repository(owner: $owner, name: $name) {
            pullRequest(number: $number) {
              files(first: 100, after: $after) {
                pageInfo {
                  hasNextPage
                  endCursor
                }
                nodes {
                  path
                  viewerViewedState
                }
              }
            }
          }
        }
      `,
      { owner: d.owner, name: d.repo, number: d.number, after },
    );
    const files = data.repository.pullRequest.files;
    for (const f of files.nodes) states.set(f.path, f.viewerViewedState);
    if (!files.pageInfo.hasNextPage) break;
    after = files.pageInfo.endCursor;
  }
  return states;
}

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
        ...(draft.startLine !== undefined &&
        (draft.startLine !== draft.line || (draft.startSide ?? draft.side) !== draft.side)
          ? { start_line: draft.startLine, start_side: toSide(draft.startSide ?? draft.side) }
          : {}),
      };

export const commentNow = (d: Details, draft: Draft) =>
  github("POST", `${base(d)}/comments`, { ...draftPayload(draft), commit_id: d.headRefOid });

export const reply = (d: Details, thread: Thread, body: string) => {
  const first = thread.comments[0];
  if (!first) throw new Error(i18n()("config.replyNoComment"));
  return github("POST", `${base(d)}/comments/${first.databaseId}/replies`, { body });
};

export const setResolved = (thread: Thread, resolved: boolean) =>
  graphql(
    `mutation($id: ID!) { ${resolved ? "resolveReviewThread" : "unresolveReviewThread"}(input: { threadId: $id }) { thread { id } } }`,
    { id: thread.id },
  );
