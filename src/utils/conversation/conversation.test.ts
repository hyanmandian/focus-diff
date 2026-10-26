import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vite-plus/test";

import {
  keepConversation,
  loadConversation,
  readKeptConversation,
  type Conversation,
} from "@/utils/conversation/conversation";

const ref = { owner: "acme", repo: "shop", number: 7 };
const ana = { __typename: "User", login: "ana", avatarUrl: "a.png", name: "Ana" };
const at = (hour: number) => `2026-01-01T${String(hour).padStart(2, "0")}:00:00Z`;

const field = (args: InvokeArgs | undefined, key: string): unknown =>
  args && !Array.isArray(args) && !(args instanceof ArrayBuffer) && !(args instanceof Uint8Array)
    ? args[key]
    : undefined;

const said = (hour: number, extra: Record<string, unknown> = {}) => ({
  body: `said at ${hour}`,
  bodyHTML: `<p>said at ${hour}</p>`,
  createdAt: at(hour),
  url: `https://github.com/acme/shop/pull/7#${hour}`,
  lastEditedAt: null,
  viewerCanUpdate: true,
  viewerCanDelete: false,
  viewerCanReact: true,
  reactionGroups: [],
  ...extra,
});
const reviewComment = (id: string) => ({ id, path: "a.ts", line: 1, bodyHTML: `<p>${id}</p>`, author: ana, url: id });
const page = <T>(nodes: T[], next: string | null = null) => ({
  pageInfo: { hasNextPage: next !== null, endCursor: next },
  nodes,
});

/** A query as sent: its text, its variables and, of them, the cursor it asks after. */
type Query = { query: string; variables: unknown; after: unknown };

function readQuery(args: InvokeArgs | undefined): Query {
  const body = field(args, "body");
  const sent: unknown = typeof body === "string" ? JSON.parse(body) : null;
  if (typeof sent !== "object" || sent === null || !("query" in sent) || !("variables" in sent))
    return { query: "", variables: null, after: undefined };
  const { variables } = sent;
  const after =
    typeof variables === "object" && variables !== null && "after" in variables ? variables.after : undefined;
  return { query: String(sent.query), variables, after };
}

/** Answers GraphQL queries with `reply`, and keeps each query asked. */
function graphql(reply: (q: Query) => unknown) {
  const asked: Query[] = [];
  mockIPC((cmd, args) => {
    if (cmd !== "github") return null;
    const q = readQuery(args);
    asked.push(q);
    return { status: 200, body: JSON.stringify({ data: reply(q) }) };
  });
  return asked;
}

const pull = (timelineItems: unknown, first: Record<string, unknown> = {}) => ({
  repository: { pullRequest: { ...first, timelineItems } },
});

const longReview = {
  __typename: "PullRequestReview",
  id: "r1",
  author: ana,
  state: "COMMENTED",
  ...said(1),
  comments: page([reviewComment("rc1")], "c1"),
};
const isReviewComments = (q: Query) => q.query.includes("node(id:");

/** Two pages of comments, the description's fields on each. */
const twoPages = (q: Query) =>
  q.after === null
    ? pull(page([{ __typename: "IssueComment", id: "c1", author: ana, ...said(1) }], "p2"), { body: "First" })
    : pull(page([{ __typename: "IssueComment", id: "c2", author: ana, ...said(2) }]), { body: "Second" });

/** A review whose comments take three pages. */
function longComments(q: Query) {
  if (!isReviewComments(q)) return pull(page([longReview]));
  return q.after === "c1"
    ? { node: { comments: page([reviewComment("rc2")], "c2") } }
    : { node: { comments: page([reviewComment("rc3")]) } };
}

/** A review with more comments that's gone by the time they're asked for. */
const goneReview = (q: Query) => (isReviewComments(q) ? { node: null } : pull(page([longReview])));

/** Rust's kept store, as a map; `fail` makes every call fail. */
function kept(stored: Record<string, string> = {}, fail = false) {
  mockIPC((cmd, args) => {
    if (fail) throw new Error("disk");
    const id = String(field(args, "id"));
    if (cmd === "kept_read") return stored[id] ?? null;
    if (cmd === "kept_write") stored[id] = String(field(args, "contents"));
    return null;
  });
  return stored;
}

describe("loadConversation", () => {
  it("reads the description and every comment and review, newest first", async () => {
    const asked = graphql(() =>
      pull(
        page([
          { __typename: "IssueComment", id: "c1", author: ana, ...said(1, { lastEditedAt: at(2) }) },
          {
            __typename: "PullRequestReview",
            id: "r1",
            author: ana,
            state: "APPROVED",
            ...said(3, {
              reactionGroups: [
                { content: "HEART", viewerHasReacted: true, reactors: { totalCount: 1, nodes: [{ login: "you" }] } },
              ],
            }),
            comments: page([reviewComment("rc1")]),
          },
        ]),
        {
          body: "Description",
          bodyHTML: "<p>Description</p>",
          viewerCanUpdate: true,
          viewerCanReact: true,
          viewerCanApplySuggestion: true,
          headRefName: "feature",
          headRefOid: "abc",
          headRepository: { nameWithOwner: "fork/shop" },
          reactionGroups: [],
        },
      ),
    );
    const conversation = await loadConversation(ref);
    expect(asked).toHaveLength(1);
    expect(asked[0]?.variables).toEqual({ owner: "acme", name: "shop", number: 7, after: null, first: true });
    expect(conversation).toMatchObject({
      body: "Description",
      html: "<p>Description</p>",
      canEdit: true,
      canReact: true,
      reactions: [],
      canApplySuggestion: true,
      headRepo: "fork/shop",
      headRef: "feature",
      headOid: "abc",
    });
    expect(conversation.entries).toEqual([
      {
        kind: "review",
        id: "r1",
        author: ana,
        state: "APPROVED",
        html: "<p>said at 3</p>",
        at: at(3),
        url: "https://github.com/acme/shop/pull/7#3",
        comments: [{ id: "rc1", path: "a.ts", line: 1, html: "<p>rc1</p>", author: ana, url: "rc1" }],
        body: "said at 3",
        canEdit: true,
        canDelete: false,
        canReact: true,
        edited: false,
        reactions: [{ content: "HEART", count: 1, mine: true, who: ["you"] }],
      },
      expect.objectContaining({ kind: "comment", id: "c1", html: "<p>said at 1</p>", edited: true }),
    ]);
  });

  it("falls back to empty values when the pull request's own fields are missing", async () => {
    graphql(() => pull(page([])));
    expect(await loadConversation(ref)).toEqual({
      body: "",
      html: "",
      canEdit: false,
      canReact: false,
      reactions: [],
      canApplySuggestion: false,
      headRepo: null,
      headRef: "",
      headOid: "",
      entries: [],
    });
  });

  it("leaves out your pending review", async () => {
    graphql(() =>
      pull(
        page([
          { __typename: "PullRequestReview", id: "p", author: ana, state: "PENDING", ...said(1), comments: page([]) },
        ]),
      ),
    );
    expect((await loadConversation(ref)).entries).toEqual([]);
  });

  it("follows the pages, asking for the pull request's own fields only on the first", async () => {
    const asked = graphql(twoPages);
    const conversation = await loadConversation(ref);
    expect(asked.map((q) => q.variables)).toEqual([
      { owner: "acme", name: "shop", number: 7, after: null, first: true },
      { owner: "acme", name: "shop", number: 7, after: "p2", first: false },
    ]);
    expect(conversation.body).toBe("First");
    expect(conversation.entries.map((e) => e.id)).toEqual(["c2", "c1"]);
  });

  it("reads a review's comments past its first hundred", async () => {
    const asked = graphql(longComments);
    const [review] = (await loadConversation(ref)).entries;
    expect(review).toMatchObject({ comments: [{ id: "rc1" }, { id: "rc2" }, { id: "rc3" }] });
    expect(asked.slice(1).map((q) => q.variables)).toEqual([
      { id: "r1", after: "c1" },
      { id: "r1", after: "c2" },
    ]);
  });

  it("stops reading a review's comments when the review is gone", async () => {
    graphql(goneReview);
    const [review] = (await loadConversation(ref)).entries;
    expect(review).toMatchObject({ comments: [{ id: "rc1" }] });
  });
});

describe("the kept copy", () => {
  const conversation: Conversation = {
    body: "",
    html: "",
    canEdit: false,
    canReact: false,
    reactions: [],
    canApplySuggestion: false,
    headRepo: null,
    headRef: "main",
    headOid: "abc",
    entries: [],
  };

  it("keeps a conversation beside the review's copy and reads it back", async () => {
    const stored = kept();
    keepConversation("PR_1", conversation);
    await expect.poll(() => stored["PR_1-conversation"]).toBe(JSON.stringify(conversation));
    await expect(readKeptConversation("PR_1")).resolves.toEqual(conversation);
  });

  it("has nothing when there's no copy, or one it can't read", async () => {
    kept({ "PR_2-conversation": JSON.stringify({ body: "old shape" }), "PR_3-conversation": "{" });
    await expect(readKeptConversation("PR_1")).resolves.toBeNull();
    await expect(readKeptConversation("PR_2")).resolves.toBeNull();
    await expect(readKeptConversation("PR_3")).resolves.toBeNull();
    kept({ "PR_4-conversation": "null" });
    await expect(readKeptConversation("PR_4")).resolves.toBeNull();
  });

  it("carries on when the disk fails", async () => {
    kept({}, true);
    await expect(readKeptConversation("PR_1")).resolves.toBeNull();
    expect(() => {
      keepConversation("PR_1", conversation);
    }).not.toThrow();
  });
});
