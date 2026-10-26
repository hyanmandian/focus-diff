import { describe, expect, it } from "vite-plus/test";

import { GitHubError } from "../bridge/bridge";
import { mockCommands } from "../fake-platform/fake-platform";
import {
  edit,
  moreComments,
  mutate,
  react,
  remove,
  toggled,
  toReactions,
  type RawComment,
  type Reaction,
  type ReactionContent,
} from "./comments";

type Sent = { query: string; variables: Record<string, unknown> };

const isSent = (value: unknown): value is Sent =>
  typeof value === "object" && value !== null && "query" in value && "variables" in value;

/** The GraphQL request in a call to Rust's github command. */
function request(args: unknown): unknown {
  return typeof args === "object" && args !== null && "body" in args && typeof args.body === "string"
    ? JSON.parse(args.body)
    : null;
}

/** GitHub answering each GraphQL call with the next of `replies`; what was sent lands in the list. */
function graphqlReplies(...replies: unknown[]) {
  const sent: Sent[] = [];
  mockCommands((_cmd, args) => {
    const sending = request(args);
    if (isSent(sending)) sent.push(sending);
    return { status: 200, body: JSON.stringify(replies[sent.length - 1]) };
  });
  return sent;
}

const comment = (id: string): RawComment => ({
  id,
  databaseId: 1,
  author: null,
  body: "",
  bodyHTML: "",
  createdAt: "2026-01-01T00:00:00Z",
  url: "",
  lastEditedAt: null,
  viewerCanUpdate: false,
  viewerCanDelete: false,
  viewerCanReact: true,
  replyTo: null,
  reactionGroups: [],
});

/** A page of a conversation's comments, with more after it when there's a cursor. */
const page = (ids: string[], endCursor: string | null) => ({
  data: {
    node: {
      comments: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes: ids.map((id) => comment(id)) },
    },
  },
});

const group = (content: ReactionContent, count: number, mine = false, logins: Array<string | null> = []) => ({
  content,
  viewerHasReacted: mine,
  reactors: { totalCount: count, nodes: logins.map((login) => (login ? { login } : null)) },
});

describe("reactions", () => {
  it("keeps only those someone gave, in GitHub's order, with who gave them", () => {
    const later = { ...group("EYES", 3), content: "SPARKLES" };
    expect(
      toReactions([
        group("HEART", 2, true, ["ana", null]),
        group("THUMBS_UP", 1, false, ["bo"]),
        group("EYES", 0),
        // @ts-expect-error -- a reaction GitHub might add one day
        later,
      ]),
    ).toEqual([
      { content: "THUMBS_UP", count: 1, mine: false, who: ["bo"] },
      { content: "HEART", count: 2, mine: true, who: ["ana"] },
    ]);
    expect(toReactions(null)).toEqual([]);
  });

  const heart: Reaction = { content: "HEART", count: 2, mine: true, who: ["me", "ana"] };
  const rocket: Reaction = { content: "ROCKET", count: 1, mine: false, who: ["bo"] };

  it("takes yours back at once, dropping one only you gave", () => {
    expect(toggled([heart, rocket], "HEART", "me")).toEqual([
      { content: "HEART", count: 1, mine: false, who: ["ana"] },
      rocket,
    ]);
    expect(toggled([{ ...heart, count: 1, who: ["me"] }, rocket], "HEART", "me")).toEqual([rocket]);
  });

  it("adds yours at once, a new one in GitHub's order", () => {
    expect(toggled([heart, rocket], "ROCKET", "me")).toEqual([
      heart,
      { ...rocket, count: 2, mine: true, who: ["me", "bo"] },
    ]);
    expect(toggled([heart, rocket], "ROCKET", null)).toEqual([heart, { ...rocket, count: 2, mine: true }]);
    expect(toggled([heart, rocket], "THUMBS_UP", "me")).toEqual([
      { content: "THUMBS_UP", count: 1, mine: true, who: ["me"] },
      heart,
      rocket,
    ]);
    expect(toggled([], "EYES", null)).toEqual([{ content: "EYES", count: 1, mine: true, who: [] }]);
  });

  it("adds or removes a reaction on GitHub", async () => {
    const sent = graphqlReplies({ data: {} }, { data: {} });
    await react("C1", "HEART", true);
    await react("C1", "HEART", false);
    expect(sent[0]?.query).toContain("addReaction");
    expect(sent[1]?.query).toContain("removeReaction");
    expect(sent[1]?.variables).toEqual({ id: "C1", content: "HEART" });
  });
});

describe("mutate", () => {
  it("takes an error as the answer, even with data beside it", async () => {
    graphqlReplies({ data: { x: 1 }, errors: [{ message: "Not allowed" }] });
    await expect(mutate("mutation { x }", {})).rejects.toEqual(new GitHubError(200, "Not allowed"));
  });

  it("says GitHub sent nothing when there's no data and no error", async () => {
    graphqlReplies({});
    await expect(mutate("mutation { x }", {})).rejects.toBeInstanceOf(GitHubError);
    graphqlReplies({ errors: [] });
    await expect(mutate("mutation { x }", {})).rejects.toBeInstanceOf(GitHubError);
  });
});

describe("editing and deleting", () => {
  it("edits each kind with its own mutation, showing GitHub's HTML", async () => {
    const sent = graphqlReplies(
      { data: { updatePullRequestReviewComment: { pullRequestReviewComment: { bodyHTML: "<p>a</p>" } } } },
      { data: { updateIssueComment: { issueComment: { bodyHTML: "<p>b</p>" } } } },
      { data: { updatePullRequestReview: { pullRequestReview: { bodyHTML: "<p>c</p>" } } } },
      { data: { updatePullRequest: { pullRequest: { bodyHTML: "<p>d</p>" } } } },
    );
    expect(await edit("review-comment", "C1", "a")).toBe("<p>a</p>");
    expect(await edit("issue-comment", "C2", "b")).toBe("<p>b</p>");
    expect(await edit("review", "R1", "c")).toBe("<p>c</p>");
    expect(await edit("pull", "P1", "d")).toBe("<p>d</p>");
    expect(sent[0]?.query).toContain("pullRequestReviewCommentId: $id");
    expect(sent[3]?.variables).toEqual({ id: "P1", body: "d" });
  });

  it("shows nothing when GitHub sends no HTML back", async () => {
    graphqlReplies({ data: { updateIssueComment: null } }, { data: {} });
    expect(await edit("issue-comment", "C2", "b")).toBe("");
    expect(await edit("issue-comment", "C2", "b")).toBe("");
  });

  it("deletes a comment on lines, or on the pull request", async () => {
    const sent = graphqlReplies({ data: {} }, { data: {} });
    await remove("review-comment", "C1");
    await remove("issue-comment", "C2");
    expect(sent[0]?.query).toContain("deletePullRequestReviewComment");
    expect(sent[1]?.query).toContain("deleteIssueComment");
  });
});

describe("moreComments", () => {
  it("reads page after page from where it's told", async () => {
    const sent = graphqlReplies(page(["a", "b"], "c2"), page(["c"], null));
    expect((await moreComments("T1", "c1")).map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(sent.map((s) => s.variables)).toEqual([
      { id: "T1", after: "c1" },
      { id: "T1", after: "c2" },
    ]);
  });

  it("stops when the conversation is gone", async () => {
    graphqlReplies({ data: { node: null } });
    expect(await moreComments("T1", "c1")).toEqual([]);
  });

  it("stops after fifty pages", async () => {
    const sent = graphqlReplies(...Array.from({ length: 60 }, (_, i) => page([`c${i}`], `cursor${i}`)));
    expect(await moreComments("T1", "c1")).toHaveLength(50);
    expect(sent).toHaveLength(50);
  });
});
