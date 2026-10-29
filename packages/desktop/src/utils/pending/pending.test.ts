import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "@/utils/fake-platform/fake-platform";
import {
  discardPending,
  loadPending,
  mergeDrafts,
  submitPending,
  toPut,
  unsent,
  type PendingReview,
} from "@/utils/pending/pending";
import type { Args } from "@/utils/platform/platform";
import type { Draft, Thread } from "@/utils/review/review";

const pull = { id: "PR_1", owner: "acme", repo: "web", number: 7 };

type Call = { cmd: string; fields: Record<string, unknown> };
const fields = (args: Args | undefined): Record<string, unknown> =>
  args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array ? {} : args;
const ok = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

function rust(...replies: unknown[]) {
  const calls: Call[] = [];
  let next = 0;
  mockCommands((cmd, args) => {
    calls.push({ cmd, fields: fields(args) });
    return cmd === "github" ? replies[next++] : null;
  });
  return calls;
}
const named = (calls: Call[]) =>
  calls.map((c) =>
    c.cmd === "github" ? (/mutation[^{]*\{ (\w+)/u.exec(String(c.fields.body))?.[1] ?? "query") : c.cmd,
  );

const rawComment = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  body: `body ${id}`,
  bodyHTML: `<p>body ${id}</p>`,
  path: "a.ts",
  line: 4,
  originalLine: 2,
  startLine: null,
  originalStartLine: null,
  subjectType: "LINE",
  replyTo: null,
  ...more,
});
const commentsPage = (nodes: unknown[], next: string | null = null) => ({
  pageInfo: { hasNextPage: next !== null, endCursor: next },
  nodes,
});
const reviews = (nodes: unknown[]) => ok({ data: { repository: { pullRequest: { reviews: { nodes } } } } });
const mine = (comments: unknown[], next: string | null = null) => ({
  id: "R_1",
  viewerDidAuthor: true,
  comments: commentsPage(comments, next),
});
const morePage = (comments: unknown[], next: string | null = null) =>
  ok({ data: { node: { comments: commentsPage(comments, next) } } });
const done = ok({ data: { done: { clientMutationId: null } } });

const empty = { jobs: [], ids: {} };
const draft = (key: string, body: string, extra: Partial<Draft> = {}): Draft => ({
  key,
  path: "a.ts",
  side: "additions",
  line: 3,
  body,
  ...extra,
});
const onGitHub = (comments: Partial<PendingReview["comments"][number]>[]): PendingReview => ({
  id: "R_1",
  comments: comments.map((c) => ({
    id: "C_1",
    body: "",
    html: "",
    path: "a.ts",
    line: 3,
    startLine: null,
    file: false,
    replyTo: null,
    ...c,
  })),
});

describe("mergeDrafts", () => {
  it("shows the kept copy until GitHub's been asked", () => {
    const kept = [draft("k1", "kept")];
    expect(mergeDrafts(kept, null, empty, [])).toEqual(kept);
  });

  it("takes GitHub's comments under the keys the window gave them", () => {
    const merged = mergeDrafts(
      [draft("k1", "old", { side: "deletions" })],
      onGitHub([{ id: "C_1", body: "from github", html: "<p>from github</p>" }]),
      { jobs: [], ids: { k1: "C_1" } },
      [],
    );
    expect(merged).toEqual([
      {
        key: "k1",
        id: "C_1",
        body: "from github",
        html: "<p>from github</p>",
        path: "a.ts",
        side: "deletions",
        line: 3,
      },
    ]);
  });

  it("loads a review started on github.com, replies and file comments included", () => {
    const thread: Thread = {
      id: "T_1",
      path: "b.ts",
      side: "deletions",
      line: 8,
      resolved: false,
      outdated: false,
      comments: [{ id: "X_1", databaseId: 1, author: null, html: "", at: "", url: "" }],
    };
    const merged = mergeDrafts(
      [],
      onGitHub([
        { id: "C_2", body: "a reply", path: "b.ts", line: 0, replyTo: "X_1" },
        { id: "C_3", body: "on the file", line: 0, file: true },
      ]),
      empty,
      [thread],
    );
    expect(merged.map((d) => [d.key, d.replyTo, d.side, d.line, d.file])).toEqual([
      ["C_2", "T_1", "deletions", 8, undefined],
      ["C_3", undefined, "additions", 0, true],
    ]);
  });

  it("puts what's on its way over GitHub's: the newest text, new ones after, removed ones gone", () => {
    const github = onGitHub([
      { id: "C_1", body: "first", html: "<p>first</p>" },
      { id: "C_2", body: "second" },
    ]);
    const state = {
      ids: { k1: "C_1", k2: "C_2" },
      jobs: [
        { change: toPut("PR_1", draft("k1", "first, edited")), error: null },
        { change: { op: "remove" as const, key: "k2", pull: "PR_1" }, error: null },
        { change: toPut("PR_1", draft("k3", "new")), error: "refused" },
      ],
    };
    const merged = mergeDrafts([], github, state, []);
    expect(merged.map((d) => [d.key, d.body, d.id, d.html])).toEqual([
      ["k1", "first, edited", "C_1", undefined],
      ["k3", "new", undefined, undefined],
    ]);
  });
});

const thread = (id: string, side: Thread["side"], line: number, comment: string): Thread => ({
  id,
  path: "a.ts",
  side,
  line,
  resolved: false,
  outdated: false,
  comments: [{ id: comment, databaseId: 1, author: null, html: "", at: "", url: "" }],
});

describe("mergeDrafts, in more detail", () => {
  it("takes a comment's side from its own conversation, and a reply to one it can't find as it is", () => {
    const merged = mergeDrafts(
      [],
      onGitHub([
        { id: "P_1", startLine: 1, line: 3 },
        { id: "P_2", startLine: 3, line: 3, replyTo: "gone" },
      ]),
      empty,
      [thread("T_1", "deletions", 3, "P_1")],
    );
    expect(merged).toEqual([
      { key: "P_1", id: "P_1", body: "", html: "", path: "a.ts", side: "deletions", line: 3, startLine: 1 },
      { key: "P_2", id: "P_2", body: "", html: "", path: "a.ts", side: "additions", line: 3 },
    ]);
  });

  it("keeps GitHub's HTML while the text on its way is the same, and everything a change says", () => {
    const state = {
      ids: { k2: "C_2" },
      jobs: [
        { change: toPut("PR_1", draft("k1", "same")), error: null },
        {
          change: toPut("PR_1", draft("k2", "multi", { startLine: 1, startSide: "deletions", replyTo: "T_1" })),
          error: null,
        },
        { change: toPut("PR_1", draft("k3", "whole file", { file: true, line: 0, id: "C_3" })), error: null },
      ],
    };
    const merged = mergeDrafts(
      [draft("k0", "untouched"), draft("k1", "same", { html: "<p>same</p>" })],
      null,
      state,
      [],
    );
    expect(merged).toEqual([
      draft("k0", "untouched"),
      draft("k1", "same", { html: "<p>same</p>" }),
      draft("k2", "multi", { startLine: 1, startSide: "deletions", replyTo: "T_1", id: "C_2" }),
      draft("k3", "whole file", { file: true, line: 0, id: "C_3" }),
    ]);
  });
});

describe("toPut", () => {
  it("sends a draft with only what it has", () => {
    expect(toPut("PR_1", draft("k", "hi"))).toEqual({
      op: "put",
      key: "k",
      pull: "PR_1",
      path: "a.ts",
      line: 3,
      side: "additions",
      body: "hi",
    });
    const full = draft("k", "hi", {
      startLine: 1,
      startSide: "deletions",
      file: true,
      id: "C_1",
      replyTo: "T_1",
    });
    expect(toPut("PR_1", full)).toMatchObject({
      startLine: 1,
      startSide: "deletions",
      file: true,
      id: "C_1",
      replyTo: "T_1",
    });
  });
});

describe("unsent", () => {
  it("leaves out comments GitHub already has under their key", () => {
    expect(unsent([draft("C_9", "there")], onGitHub([{ id: "C_9" }]), empty)).toEqual([]);
  });

  it("finds comments kept here that are neither on GitHub nor on their way", () => {
    const kept = [
      draft("old", "written before"),
      draft("k1", "queued"),
      draft("k2", "sent", { id: "C_2" }),
      draft("k3", "synced"),
    ];
    const state = { jobs: [{ change: toPut("PR_1", kept[1]!), error: null }], ids: { k3: "C_3" } };
    expect(unsent(kept, null, state).map((d) => d.key)).toEqual(["old"]);
  });
});

describe("loadPending", () => {
  it("is nothing when you have no pending review", async () => {
    rust(reviews([{ ...mine([]), viewerDidAuthor: false }]));
    expect(await loadPending(pull)).toBeNull();
  });

  it("reads your pending review's comments, a hundred a page", async () => {
    const calls = rust(
      reviews([
        mine(
          [
            rawComment("C_1"),
            rawComment("C_2", { subjectType: "FILE", line: 9 }),
            rawComment("C_3", { line: null, originalLine: null, originalStartLine: 1, replyTo: { id: "X_1" } }),
          ],
          "c1",
        ),
      ]),
      morePage([rawComment("C_4", { line: null, startLine: 2 })], "c2"),
      morePage([rawComment("C_5", { subjectType: null })]),
    );
    const review = await loadPending(pull);
    expect(review?.id).toBe("R_1");
    expect(review?.comments.map((c) => [c.id, c.line, c.startLine, c.file, c.replyTo])).toEqual([
      ["C_1", 4, null, false, null],
      ["C_2", 0, null, true, null],
      ["C_3", 0, 1, false, "X_1"],
      ["C_4", 2, 2, false, null],
      ["C_5", 4, null, false, null],
    ]);
    expect(review?.comments[0]).toMatchObject({ body: "body C_1", html: "<p>body C_1</p>", path: "a.ts" });
    expect(JSON.parse(String(calls[1]?.fields.body))).toMatchObject({ variables: { id: "R_1", after: "c1" } });
    expect(JSON.parse(String(calls[2]?.fields.body))).toMatchObject({ variables: { after: "c2" } });
  });

  it("stops when the review is gone, or after fifty more pages", async () => {
    rust(reviews([mine([rawComment("C_1")], "c1")]), ok({ data: { node: null } }));
    expect((await loadPending(pull))?.comments).toHaveLength(1);

    const pages = Array.from({ length: 51 }, (_, i) => morePage([rawComment(`M_${i}`)], `c${i + 2}`));
    const calls = rust(reviews([mine([rawComment("C_1")], "c1")]), ...pages);
    expect((await loadPending(pull))?.comments).toHaveLength(51);
    expect(calls).toHaveLength(51);
  });
});

describe("sending the review", () => {
  it("won't send a comment that says nothing", async () => {
    const calls = rust();
    await expect(submitPending(pull, "COMMENT", "  ", 0)).rejects.toThrow(
      "Write a comment, or add some on the lines, first.",
    );
    expect(calls).toEqual([]);
  });

  it("submits the pending review once its comments are on GitHub, then forgets them", async () => {
    const calls = rust(reviews([mine([])]), done);
    await submitPending(pull, "COMMENT", "", 2);
    expect(named(calls)).toEqual(["drafts_flush", "query", "submitPullRequestReview", "drafts_forget"]);
    expect(JSON.parse(String(calls[2]?.fields.body))).toMatchObject({
      variables: { id: "R_1", event: "COMMENT", body: "" },
    });
    expect(calls[0]?.fields).toEqual({ pull: "PR_1" });
  });

  it("makes a review outright when there's no pending one", async () => {
    const calls = rust(reviews([]), done);
    await submitPending(pull, "APPROVE", " Looks good ", 0);
    expect(named(calls)).toEqual(["drafts_flush", "query", "addPullRequestReview", "drafts_forget"]);
    expect(JSON.parse(String(calls[2]?.fields.body))).toMatchObject({
      variables: { id: "PR_1", event: "APPROVE", body: "Looks good" },
    });
  });

  it("sends a comment with words even without comments on the lines", async () => {
    const calls = rust(reviews([]), done);
    await submitPending(pull, "COMMENT", "Thoughts", 0);
    expect(named(calls)).toContain("addPullRequestReview");
  });
});

describe("discardPending", () => {
  it("forgets the comments here and deletes the review on GitHub", async () => {
    const calls = rust(reviews([mine([])]), done);
    await discardPending(pull);
    expect(named(calls)).toEqual(["drafts_forget", "query", "deletePullRequestReview"]);
    expect(JSON.parse(String(calls[2]?.fields.body))).toMatchObject({ variables: { id: "R_1" } });
  });

  it("has nothing to delete on GitHub when there's no pending review", async () => {
    const calls = rust(reviews([]));
    await discardPending(pull);
    expect(named(calls)).toEqual(["drafts_forget", "query"]);
  });
});
