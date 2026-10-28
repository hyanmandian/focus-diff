import { describe, expect, it } from "vite-plus/test";

import type { RawComment } from "@/utils/comments/comments";
import type { Details } from "@/utils/details/details";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Args } from "@/utils/platform/platform";
import {
  commentNow,
  header,
  loadFiles,
  loadThreads,
  loadViewed,
  reply,
  setResolved,
  type Draft,
  type Thread,
} from "@/utils/review/review";

type Request = { method: string; path: string; body: string };

function sent(args: Args | undefined, key: string): unknown {
  if (args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array)
    return undefined;
  return args[key];
}

function github(answer: (request: Request) => unknown) {
  const asked: Request[] = [];
  mockCommands((_cmd, args) => {
    const request = {
      method: String(sent(args, "method")),
      path: String(sent(args, "path")),
      body: String(sent(args, "body")),
    };
    asked.push(request);
    return { status: 200, body: JSON.stringify(answer(request)) };
  });
  return asked;
}

const sentJson = (request: Request | undefined): unknown => JSON.parse(String(request?.body));

const ref = { owner: "acme", repo: "app", number: 7 };

describe("file headers", () => {
  it("names a changed file on both sides", () => {
    expect(header({ filename: "a.ts", status: "modified" })).toBe("diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts");
  });

  it("names a rename from the old name to the new", () => {
    expect(header({ filename: "b.ts", previous_filename: "a.ts", status: "renamed" })).toBe(
      "diff --git a/a.ts b/b.ts\nrename from a.ts\nrename to b.ts\n--- a/a.ts\n+++ b/b.ts",
    );
  });

  it("has no old side for an added file, and no new side for a removed one", () => {
    expect(header({ filename: "a.ts", status: "added" })).toContain("--- /dev/null\n+++ b/a.ts");
    expect(header({ filename: "a.ts", status: "removed" })).toContain("--- a/a.ts\n+++ /dev/null");
  });
});

function files(total: number) {
  const pages: number[] = [];
  github((request) => {
    const page = Number(new URL(request.path, "https://api.github.com").searchParams.get("page"));
    pages.push(page);
    const from = (page - 1) * 100;
    return Array.from({ length: Math.max(0, Math.min(100, total - from)) }, (_, i) => ({
      filename: `f${from + i}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1 +1 @@\n-a\n+b",
    }));
  });
  return pages;
}

describe("loading files", () => {
  it("turns GitHub's files into patches with headers", async () => {
    github(() => [
      {
        filename: "b.ts",
        previous_filename: "a.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
        patch: "@@ -1 +1 @@",
      },
      { filename: "logo.png", status: "added", additions: 0, deletions: 0 },
    ]);
    expect(await loadFiles(ref)).toEqual([
      {
        path: "b.ts",
        previousPath: "a.ts",
        status: "renamed",
        additions: 1,
        deletions: 1,
        patch: "diff --git a/a.ts b/b.ts\nrename from a.ts\nrename to b.ts\n--- a/a.ts\n+++ b/b.ts\n@@ -1 +1 @@\n",
      },
      { path: "logo.png", previousPath: null, status: "added", additions: 0, deletions: 0, patch: "" },
    ]);
  });

  it("asks for one page when it isn't full", async () => {
    const pages = files(42);
    expect(await loadFiles(ref)).toHaveLength(42);
    expect(pages).toEqual([1]);
  });

  it("asks for every page at once when it knows how many files there are", async () => {
    const pages = files(250);
    expect(await loadFiles(ref, 250)).toHaveLength(250);
    expect(pages).toEqual([1, 2, 3]);
  });

  it("carries on one page at a time past a count that's behind", async () => {
    const pages = files(350);
    expect(await loadFiles(ref, 200)).toHaveLength(350);
    expect(pages).toEqual([1, 2, 3, 4]);
    const again = files(150);
    expect(await loadFiles(ref, 100)).toHaveLength(150);
    expect(again).toEqual([1, 2]);
  });

  it("asks a few pages at a time without a count, keeping what comes before a short page", async () => {
    const pages = files(250);
    expect(await loadFiles(ref)).toHaveLength(250);
    expect(pages).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at GitHub's 3,000 files", async () => {
    const pages = files(3500);
    expect(await loadFiles(ref)).toHaveLength(3000);
    expect(pages).toHaveLength(30);
  });
});

const comment = (id: string, extra: Partial<RawComment> = {}): RawComment => ({
  id,
  databaseId: 1,
  author: { login: "ana", databaseId: 42 },
  body: "Why?",
  bodyHTML: "<p>Why?</p>",
  createdAt: "2026-01-01T00:00:00Z",
  url: `https://github.com/acme/app/pull/7#${id}`,
  state: "SUBMITTED",
  lastEditedAt: null,
  viewerCanUpdate: true,
  viewerCanDelete: true,
  viewerCanReact: true,
  replyTo: null,
  reactionGroups: [],
  ...extra,
});
const none = { hasNextPage: false, endCursor: null };
const thread = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: "a.ts",
  line: 3,
  originalLine: 2,
  startLine: null,
  subjectType: "LINE",
  diffSide: "RIGHT",
  hunk: { nodes: [{ diffHunk: "@@ -1,3 +1,3 @@\n a\n+b" }] },
  comments: { pageInfo: none, nodes: [comment(`${id}-c1`)] },
  ...extra,
});
const threadsPage = (nodes: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null } = none) => ({
  data: { repository: { pullRequest: { reviewThreads: { pageInfo, nodes } } } },
});

function twoPages(request: Request) {
  if (request.body.includes("PullRequestReviewThread"))
    return { data: { node: { comments: { pageInfo: none, nodes: [comment("T1-c2")] } } } };
  if (request.body.includes('"after":"p2"')) return threadsPage([thread("T2")]);
  return threadsPage(
    [thread("T1", { comments: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [comment("T1-c1")] } })],
    { hasNextPage: true, endCursor: "p2" },
  );
}

describe("loading conversations", () => {
  it("keeps a conversation that comes without its hunk", async () => {
    github(() => threadsPage([thread("T1", { hunk: null }), thread("T2", { hunk: undefined })]));
    const threads = await loadThreads(ref);
    expect(threads.map((t) => [t.id, t.context])).toEqual([
      ["T1", undefined],
      ["T2", undefined],
    ]);
  });

  it("reads each conversation's place, state and comments", async () => {
    github(() =>
      threadsPage([
        thread("T1"),
        thread("T2", {
          subjectType: "FILE",
          diffSide: "LEFT",
          isResolved: true,
          isOutdated: true,
          hunk: { nodes: [] },
          comments: {
            pageInfo: none,
            nodes: [comment("T2-c1", { state: "PENDING", lastEditedAt: "2026-01-02T00:00:00Z", author: null })],
          },
        }),
        thread("T3", { line: null, startLine: 1 }),
        thread("T4", { line: null, originalLine: null }),
      ]),
    );
    const threads = await loadThreads(ref);
    expect(
      threads.map((t) => [t.id, t.side, t.line, t.startLine, t.resolved, t.outdated, t.pending, t.context]),
    ).toEqual([
      ["T1", "additions", 3, null, false, false, false, "b"],
      ["T2", "deletions", 0, null, true, true, true, undefined],
      ["T3", "additions", 2, 1, false, false, false, "b"],
      ["T4", "additions", 0, null, false, false, false, "b"],
    ]);
    expect(threads[0]!.comments).toEqual([
      {
        id: "T1-c1",
        databaseId: 1,
        author: { login: "ana", databaseId: 42 },
        html: "<p>Why?</p>",
        at: "2026-01-01T00:00:00Z",
        url: "https://github.com/acme/app/pull/7#T1-c1",
        body: "Why?",
        pending: false,
        canEdit: true,
        canDelete: true,
        canReact: true,
        edited: false,
        reactions: [],
        authorId: 42,
      },
    ]);
    expect(threads[1]!.comments[0]).toMatchObject({ pending: true, edited: true, authorId: null });
  });

  it("reads every page of conversations, and the rest of a long one", async () => {
    const asked = github(twoPages);
    const threads = await loadThreads(ref);
    expect(threads.map((t) => [t.id, t.comments.map((c) => c.id)])).toEqual([
      ["T1", ["T1-c1", "T1-c2"]],
      ["T2", ["T2-c1"]],
    ]);
    expect(sentJson(asked[0])).toMatchObject({ variables: { owner: "acme", name: "app", number: 7, after: null } });
  });

  it("stops after ten pages", async () => {
    const asked = github(() => threadsPage([], { hasNextPage: true, endCursor: "next" }));
    expect(await loadThreads(ref)).toEqual([]);
    expect(asked).toHaveLength(10);
  });
});

const filesPage = (nodes: unknown[], pageInfo: { hasNextPage: boolean; endCursor: string | null }) => ({
  data: { repository: { pullRequest: { files: { pageInfo, nodes } } } },
});

const viewedPages = (request: Request) =>
  request.body.includes('"after":"p2"')
    ? filesPage([{ path: "b.ts", viewerViewedState: "DISMISSED" }], { hasNextPage: false, endCursor: null })
    : filesPage([{ path: "a.ts", viewerViewedState: "VIEWED" }], { hasNextPage: true, endCursor: "p2" });

describe("viewed files", () => {
  it("reads what you've viewed on github.com, every page", async () => {
    const asked = github(viewedPages);
    expect(await loadViewed(ref)).toEqual(
      new Map([
        ["a.ts", "VIEWED"],
        ["b.ts", "DISMISSED"],
      ]),
    );
    expect(asked).toHaveLength(2);
  });

  it("stops after thirty pages", async () => {
    const asked = github(() => filesPage([], { hasNextPage: true, endCursor: "next" }));
    await loadViewed(ref);
    expect(asked).toHaveLength(30);
  });
});

const pull: Details = {
  id: "PR_1",
  number: 7,
  title: "Fix the thing",
  url: "https://github.com/acme/app/pull/7",
  html: "",
  owner: "acme",
  repo: "app",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: false,
  baseRefName: "main",
  headRefName: "fix",
  headRefOid: "abc",
  updatedAt: "2026-01-01T00:00:00Z",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  createdAt: "2026-01-01T00:00:00Z",
  author: { login: "ana" },
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
};
const draft = (extra: Partial<Draft> = {}): Draft => ({
  key: "k",
  path: "a.ts",
  side: "additions",
  line: 5,
  body: "Nice",
  ...extra,
});
const posted = async (d: Draft) => {
  const asked = github(() => ({}));
  await commentNow(pull, d);
  return { path: asked[0]?.path, body: sentJson(asked[0]) };
};

const conversation = (comments: Thread["comments"]): Thread => ({
  id: "T1",
  path: "a.ts",
  side: "additions",
  line: 1,
  resolved: false,
  outdated: false,
  comments,
});

describe("reviewing", () => {
  it("posts a comment on a line of the head commit", async () => {
    expect(await posted(draft())).toEqual({
      path: "/repos/acme/app/pulls/7/comments",
      body: { path: "a.ts", body: "Nice", line: 5, side: "RIGHT", commit_id: "abc" },
    });
  });

  it("posts a comment on several lines, from where they start", async () => {
    expect((await posted(draft({ startLine: 2 }))).body).toMatchObject({ start_line: 2, start_side: "RIGHT" });
    expect((await posted(draft({ side: "deletions", startLine: 5, startSide: "additions" }))).body).toMatchObject({
      side: "LEFT",
      start_line: 5,
      start_side: "RIGHT",
    });
  });

  it("posts a one-line range as a single line", async () => {
    expect((await posted(draft({ startLine: 5 }))).body).not.toHaveProperty("start_line");
    expect((await posted(draft({ startLine: 5, startSide: "additions" }))).body).not.toHaveProperty("start_line");
  });

  it("posts a comment on the file as a whole", async () => {
    expect((await posted(draft({ file: true }))).body).toEqual({
      path: "a.ts",
      body: "Nice",
      subject_type: "file",
      commit_id: "abc",
    });
  });

  it("replies to a conversation's first comment", async () => {
    const asked = github(() => ({}));
    await reply(pull, conversation([{ id: "C1", databaseId: 99, author: null, html: "", at: "", url: "" }]), "Done");
    expect(asked[0]).toEqual({
      method: "POST",
      path: "/repos/acme/app/pulls/7/comments/99/replies",
      body: '{"body":"Done"}',
    });
  });

  it("can't reply to a conversation without comments", () => {
    expect(() => reply(pull, conversation([]), "Done")).toThrow("This conversation has no comment to reply to.");
  });

  it("resolves and unresolves a conversation", async () => {
    const asked = github(() => ({ data: {} }));
    await setResolved(conversation([]), true);
    await setResolved(conversation([]), false);
    expect(asked[0]?.body).toContain("resolveReviewThread");
    expect(asked[1]?.body).toContain("unresolveReviewThread");
    expect(sentJson(asked[1])).toMatchObject({ variables: { id: "T1" } });
  });
});
