import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Reaction } from "../../utils/comments/comments";
import { StaleHead, type Applied } from "../../utils/commit/commit";
import type { Conversation } from "../../utils/conversation/conversation";
import type { Details } from "../../utils/details/details";
import { mockCommands } from "../../utils/fake-platform/fake-platform";
import type { Draft, PullRef, ReviewFile, Thread, ThreadComment } from "../../utils/review/review";
import { SuggestionError } from "../../utils/suggestion/suggestion";
import type { Pending } from "../use-pending/use-pending";
import { copyText, ConversationProvider, useConversation, useConversationApi } from "./use-conversation";

// GitHub's side of comments, the conversation and commits are utils of their own (comments.ts,
// conversation.ts, commit.ts, review.ts): here, what they answer.
const gh = vi.hoisted(() => ({
  load: vi.fn<(ref: unknown) => Promise<unknown>>(),
  edit: vi.fn<(kind: string, id: string, body: string) => Promise<string>>(),
  remove: vi.fn<(kind: string, id: string) => Promise<unknown>>(),
  react: vi.fn<(subject: string, content: string, on: boolean) => Promise<unknown>>(),
  commit: vi.fn<(c: unknown) => Promise<void>>(),
  resolve: vi.fn<(thread: { id: string }, resolved: boolean) => Promise<void>>(),
}));
vi.mock("../../utils/conversation/conversation", async (original) => ({
  ...(await original<object>()),
  loadConversation: gh.load,
}));
vi.mock("../../utils/comments/comments", async (original) => ({
  ...(await original<object>()),
  edit: gh.edit,
  remove: gh.remove,
  react: gh.react,
}));
vi.mock("../../utils/commit/commit", async (original) => ({
  ...(await original<object>()),
  commitSuggestions: gh.commit,
}));
vi.mock("../../utils/review/review", async (original) => ({ ...(await original<object>()), setResolved: gh.resolve }));

const REF: PullRef = { owner: "acme", repo: "api", number: 42 };
const PR = "PR_1";

const DETAILS: Details = {
  id: PR,
  number: 42,
  title: "Rename the queue",
  url: "https://github.com/acme/api/pull/42",
  html: "<p>Renames it.</p>",
  owner: "acme",
  repo: "api",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "rename",
  headRefOid: "abc123",
  updatedAt: "2026-10-26T10:00:00Z",
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  createdAt: "2026-10-25T10:00:00Z",
  author: { login: "mona", name: "Mona Lisa" },
  reviewDecision: null,
  reviewers: [
    { actor: { login: "hubot" }, state: "PENDING" },
    { actor: { login: "platform" }, state: "PENDING", team: "acme/platform" },
    { actor: { login: "me" }, state: "COMMENTED" },
  ],
  checks: [],
  files: [],
  entries: [{ kind: "comment", id: "IC_0", author: { login: "octocat" }, html: "", at: "", url: "" }],
  mergeMethods: ["squash"],
};

const said = { body: "", canEdit: true, canDelete: true, canReact: true, edited: false, reactions: [] };
const CONVERSATION: Conversation = {
  body: "Renames it.",
  html: "<p>Renames it.</p>",
  canEdit: true,
  canReact: true,
  reactions: [],
  canApplySuggestion: true,
  headRepo: "acme/api",
  headRef: "rename",
  headOid: "abc123",
  entries: [
    {
      kind: "comment",
      id: "IC_1",
      author: { login: "linus" },
      html: "<p>Hi</p>",
      at: "",
      url: "",
      ...said,
      body: "Hi",
    },
    {
      kind: "review",
      id: "PRR_1",
      author: null,
      state: "COMMENTED",
      html: "<p>Review</p>",
      at: "",
      url: "",
      comments: [],
      ...said,
      body: "Review",
    },
  ],
};

const comment = (id: string, login: string, over: Partial<ThreadComment> = {}): ThreadComment => ({
  id,
  databaseId: 1,
  author: { login },
  html: `<p>${id}</p>`,
  at: "",
  url: "",
  body: id,
  ...over,
});
const thread = (id: string, comments: ThreadComment[], over: Partial<Thread> = {}): Thread => ({
  id,
  path: "src/app.ts",
  side: "additions",
  line: 3,
  resolved: false,
  outdated: false,
  comments,
  ...over,
});

const THREADS = [
  thread("T1", [comment("C1", "grace"), comment("C2", "me")]),
  thread("T2", [comment("C3", "ada")], { resolved: true }),
  thread("T3", [comment("C4", "me", { pending: true })], { pending: true }),
];

const FILES: ReviewFile[] = [
  { path: "src/app.ts", previousPath: null, status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@" },
];

const DRAFT: Draft = { key: "k1", path: "src/app.ts", side: "additions", line: 3, body: "Later" };

function pending(): Pending {
  return {
    drafts: [DRAFT],
    errors: { k1: "Line gone" },
    sending: new Set(["k2"]),
    add: vi.fn<Pending["add"]>(),
    edit: vi.fn<Pending["edit"]>(),
    remove: vi.fn<Pending["remove"]>(),
    retry: vi.fn<Pending["retry"]>(),
    submit: vi.fn<Pending["submit"]>(),
    discard: vi.fn<Pending["discard"]>(),
  };
}

type Setup = { details?: Details | null; files?: ReviewFile[] | null; kept?: () => unknown };

/** The hook in a review window: its threads in a list of its own, what it says, Rust's kept copy. */
function setup({ details = DETAILS, files = FILES, kept = () => null }: Setup = {}) {
  const state = { threads: THREADS };
  const say = vi.fn<(message: string) => void>();
  const reloadAll = vi.fn<() => void>();
  const ipc: Array<[string, unknown]> = [];
  const answers: Record<string, () => unknown> = { kept_read: kept, kept_write: () => null, confirm: () => true };
  mockCommands((cmd, args) => {
    ipc.push([cmd, args]);
    return answers[cmd]?.();
  });
  const view = renderHook(
    (props: { details: Details | null }) =>
      useConversation({
        prId: PR,
        ref: REF,
        details: props.details,
        threads: state.threads,
        setThreads: (update) => {
          state.threads = update(state.threads);
        },
        files,
        me: "me",
        pending: PENDING,
        say,
        reloadAll,
      }),
    { initialProps: { details } },
  );
  return { ...view, state, say, reloadAll, ipc, answers };
}

let PENDING = pending();

beforeEach(() => {
  PENDING = pending();
  gh.load.mockReset().mockResolvedValue(CONVERSATION);
  gh.edit.mockReset().mockResolvedValue("<p>edited</p>");
  gh.remove.mockReset().mockResolvedValue({});
  gh.react.mockReset().mockResolvedValue({});
  gh.commit.mockReset().mockResolvedValue();
  gh.resolve.mockReset().mockResolvedValue();
});

const NOTHING = () => {};
const settle = () => act(() => Promise.resolve());

describe("useConversation", () => {
  it("shows the kept conversation until GitHub's arrives, and keeps GitHub's", async () => {
    let answer: (c: Conversation) => void = NOTHING;
    gh.load.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const kept = { ...CONVERSATION, body: "Kept" };
    const { result, ipc } = setup({ kept: () => JSON.stringify(kept) });
    await waitFor(() => {
      expect(result.current.conversation?.body).toBe("Kept");
    });
    await act(async () => {
      answer(CONVERSATION);
      await Promise.resolve();
    });
    expect(result.current.conversation?.body).toBe("Renames it.");
    expect(ipc).toContainEqual(["kept_write", { id: `${PR}-conversation`, contents: JSON.stringify(CONVERSATION) }]);
  });

  it("doesn't let the kept copy replace GitHub's when it comes after", async () => {
    let answer: (text: string) => void = NOTHING;
    const { result } = setup({
      kept: () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
    });
    await waitFor(() => {
      expect(result.current.conversation?.body).toBe("Renames it.");
    });
    await act(async () => {
      answer(JSON.stringify({ ...CONVERSATION, body: "Kept" }));
      await Promise.resolve();
    });
    expect(result.current.conversation?.body).toBe("Renames it.");
  });

  it("keeps what it has when GitHub can't be asked, and has nothing without a kept copy", async () => {
    gh.load.mockRejectedValue(new Error("offline"));
    const { result } = setup();
    await settle();
    await result.current.reload();
    expect(result.current.conversation).toBeNull();
  });

  it("describes the pull request and its people for what's drawn", async () => {
    const { result, rerender } = setup();
    let api = result.current.api;
    expect(api.repo).toBe("acme/api");
    expect(api.url).toBe("https://github.com/acme/api/pull/42");
    expect(api.me).toBe("me");
    expect(api.branch).toBe("rename");
    // Before the conversation loads: the details' latest comments.
    expect(api.people.map((p) => p.login)).toEqual(["mona", "hubot", "octocat", "grace", "ada"]);
    expect(api.people[0]).toEqual({ login: "mona", name: "Mona Lisa", avatarUrl: undefined });
    await waitFor(() => {
      expect(result.current.api.canApplySuggestion).toBe(true);
    });
    api = result.current.api;
    expect(api.people.map((p) => p.login)).toEqual(["mona", "hubot", "linus", "grace", "ada"]);
    // A pending conversation is one of your pending comments, not a conversation.
    expect(api.thread("T1")?.comments).toHaveLength(2);
    expect(api.thread("T3")).toBeUndefined();
    expect(api.patchOf("src/app.ts")).toBe("@@ -1 +1 @@");
    expect(api.patchOf("gone.ts")).toBeUndefined();
    expect(api.draft("k1")).toBe(DRAFT);
    expect(api.draftError("k1")).toBe("Line gone");
    expect(api.draftSending("k2")).toBe(true);
    expect(api.retryDrafts).toBe(PENDING.retry);

    rerender({ details: { ...DETAILS, state: "MERGED" } });
    expect(result.current.api.canApplySuggestion).toBe(false);
  });

  it("makes do without the details or the files", () => {
    gh.load.mockReturnValue(new Promise(() => {}));
    const { result } = setup({ details: null, files: null });
    const { api } = result.current;
    expect(api.url).toBe("https://github.com/acme/api/pull/42");
    expect(api.branch).toBe("");
    expect(api.canApplySuggestion).toBe(false);
    expect(api.people.map((p) => p.login)).toEqual(["grace", "ada"]);
    expect(api.patchOf("src/app.ts")).toBeUndefined();
  });

  it("can't apply suggestions without a branch to commit to", async () => {
    gh.load.mockResolvedValue({ ...CONVERSATION, headRepo: null });
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    expect(result.current.api.canApplySuggestion).toBe(false);
  });

  it("puts a reply into the pending review", () => {
    const { result } = setup();
    result.current.api.replyLater(THREADS[0]!, "Agreed");
    expect(PENDING.add).toHaveBeenCalledWith({
      path: "src/app.ts",
      side: "additions",
      line: 3,
      body: "Agreed",
      replyTo: "T1",
    });
  });

  it("edits a comment on lines and shows the edit", async () => {
    const { result, state } = setup();
    await result.current.api.editComment(comment("C1", "grace"), "Better");
    expect(gh.edit).toHaveBeenCalledWith("review-comment", "C1", "Better");
    expect(state.threads[0]?.comments[0]).toMatchObject({ body: "Better", html: "<p>edited</p>", edited: true });
    expect(state.threads[0]?.comments[1]?.body).toBe("C2");
    expect(state.threads[1]).toBe(THREADS[1]);
  });

  it("deletes a comment on lines after asking, and a conversation left empty with it", async () => {
    const { result, state, say, answers } = setup();
    answers.confirm = () => false;
    await result.current.api.deleteComment(comment("C3", "ada"));
    expect(gh.remove).not.toHaveBeenCalled();
    answers.confirm = () => true;
    await result.current.api.deleteComment(comment("C3", "ada"));
    expect(gh.remove).toHaveBeenCalledWith("review-comment", "C3");
    expect(state.threads.map((t) => t.id)).toEqual(["T1", "T3"]);
    await result.current.api.deleteComment(comment("C2", "me"));
    expect(state.threads[0]?.comments.map((c) => c.id)).toEqual(["C1"]);
    expect(say).toHaveBeenCalledWith("Comment deleted");
  });

  it("edits and deletes the pull request's comments and reviews", async () => {
    const { result, say, answers } = setup();
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    await act(() => result.current.api.editEntry("comment", "IC_1", "Hello"));
    expect(gh.edit).toHaveBeenLastCalledWith("issue-comment", "IC_1", "Hello");
    await act(() => result.current.api.editEntry("review", "PRR_1", "Looks good"));
    expect(gh.edit).toHaveBeenLastCalledWith("review", "PRR_1", "Looks good");
    expect(result.current.conversation?.entries.map((e) => [e.body, e.edited])).toEqual([
      ["Hello", true],
      ["Looks good", true],
    ]);

    answers.confirm = () => false;
    await act(() => result.current.api.deleteEntry("IC_1"));
    expect(gh.remove).not.toHaveBeenCalled();
    answers.confirm = () => true;
    await act(() => result.current.api.deleteEntry("IC_1"));
    expect(gh.remove).toHaveBeenCalledWith("issue-comment", "IC_1");
    expect(result.current.conversation?.entries.map((e) => e.id)).toEqual(["PRR_1"]);
    expect(say).toHaveBeenCalledWith("Comment deleted");
  });

  it("edits an entry before the conversation has loaded without making one up", async () => {
    gh.load.mockReturnValue(new Promise(() => {}));
    const { result } = setup();
    await act(() => result.current.api.editEntry("comment", "IC_0", "Edited"));
    expect(result.current.conversation).toBeNull();
  });

  it("edits the description, with the details to say which pull request", async () => {
    const { result, rerender } = setup();
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    await act(() => result.current.api.editDescription("New description"));
    expect(gh.edit).toHaveBeenCalledWith("pull", PR, "New description");
    expect(result.current.conversation).toMatchObject({ body: "New description", html: "<p>edited</p>" });
    rerender({ details: null });
    await act(() => result.current.api.editDescription("Again"));
    expect(gh.edit).toHaveBeenCalledOnce();
  });

  it("reacts, and shows the reaction wherever it went", async () => {
    const after: Reaction[] = [{ content: "HEART", count: 1, mine: true, who: ["me"] }];
    const { result, state } = setup();
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    await act(() => result.current.api.react("C1", "HEART", true, after));
    expect(gh.react).toHaveBeenCalledWith("C1", "HEART", true);
    expect(state.threads[0]?.comments[0]?.reactions).toBe(after);
    await act(() => result.current.api.react(PR, "HEART", true, after));
    expect(result.current.conversation?.reactions).toBe(after);
    await act(() => result.current.api.react("IC_1", "HEART", true, after));
    expect(result.current.conversation?.entries[0]?.reactions).toBe(after);
    expect(result.current.conversation?.entries[1]?.reactions).toEqual([]);
    const before = result.current.conversation;
    await act(() => result.current.api.react("elsewhere", "HEART", false, []));
    expect(result.current.conversation).toBe(before);
  });

  it("reacts before the conversation loads without making one up", async () => {
    gh.load.mockReturnValue(new Promise(() => {}));
    const { result } = setup();
    await act(() => result.current.api.react(PR, "ROCKET", true, []));
    expect(result.current.conversation).toBeNull();
  });

  it("says why a reaction didn't go", async () => {
    gh.react.mockRejectedValue(new Error("Forbidden"));
    const { result, say } = setup();
    await expect(result.current.api.react("C1", "HEART", true, [])).rejects.toThrow("Forbidden");
    expect(say).toHaveBeenCalledWith("Forbidden");
    gh.react.mockRejectedValue("Gone");
    await expect(result.current.api.react("C1", "HEART", true, [])).rejects.toBe("Gone");
    expect(say).toHaveBeenLastCalledWith("Gone");
  });

  it("copies a link and says so", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const { result, say } = setup();
    result.current.api.copyLink("https://github.com/acme/api/pull/42#discussion_r1");
    await waitFor(() => {
      expect(say).toHaveBeenCalledWith("Link copied");
    });
    expect(writeText).toHaveBeenCalledWith("https://github.com/acme/api/pull/42#discussion_r1");
  });

  it("gathers suggestions to commit together", () => {
    const one = applied("T1", "C1");
    const two = applied("T2", "C3");
    const { result } = setup();
    act(() => {
      result.current.api.toggleBatch(one);
    });
    act(() => {
      result.current.api.toggleBatch(two);
    });
    expect(result.current.api.batch).toEqual([one, two]);
    act(() => {
      result.current.api.toggleBatch(one);
    });
    expect(result.current.api.batch).toEqual([two]);
    act(() => {
      result.current.api.clearBatch();
    });
    expect(result.current.api.batch).toEqual([]);
  });

  it("commits suggestions, resolving their conversations here and on GitHub", async () => {
    gh.resolve.mockRejectedValueOnce(new Error("Not allowed"));
    const one = applied("T1", "C1");
    const two = applied("T2", "C3");
    const other = applied("T1", "C2");
    const { result, state, say, reloadAll } = setup();
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    act(() => {
      result.current.api.toggleBatch(one);
    });
    act(() => {
      result.current.api.toggleBatch(other);
    });
    await act(() => result.current.api.commit([one, two], "  ", "Thanks"));
    expect(gh.commit).toHaveBeenCalledWith({
      repo: "acme/api",
      branch: "rename",
      head: "abc123",
      items: [one, two],
      headline: "Apply suggestions from code review",
      body: "Thanks",
      me: "me",
    });
    expect(result.current.api.batch).toEqual([other]);
    expect(state.threads.map((t) => [t.id, t.resolved])).toEqual([
      ["T1", true],
      ["T2", true],
      ["T3", false],
    ]);
    // T2 was resolved already.
    expect(gh.resolve.mock.calls.map(([t, resolved]) => [t.id, resolved])).toEqual([["T1", true]]);
    expect(say).toHaveBeenCalledWith("2 suggestions committed");
    expect(reloadAll).toHaveBeenCalledOnce();

    await act(() => result.current.api.commit([applied("T9", "C9")], "Fix typo", ""));
    expect(gh.commit).toHaveBeenLastCalledWith(expect.objectContaining({ headline: "Fix typo" }));
    expect(say).toHaveBeenLastCalledWith("Suggestion committed");
  });

  it("commits nothing without a branch or the details", async () => {
    gh.load.mockResolvedValue({ ...CONVERSATION, headRepo: null });
    const { result, rerender } = setup();
    await act(() => result.current.api.commit([applied("T1", "C1")], "", ""));
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    await act(() => result.current.api.commit([applied("T1", "C1")], "", ""));
    gh.load.mockResolvedValue(CONVERSATION);
    await act(() => result.current.reload());
    rerender({ details: null });
    await act(() => result.current.api.commit([applied("T1", "C1")], "", ""));
    expect(gh.commit).not.toHaveBeenCalled();
  });

  it("says why suggestions couldn't be committed, bringing a moved branch up to date", async () => {
    const { result, reloadAll } = setup();
    await waitFor(() => {
      expect(result.current.conversation).not.toBeNull();
    });
    const items = [applied("T1", "C1")];
    gh.commit.mockRejectedValueOnce(new StaleHead("moved"));
    await expect(result.current.api.commit(items, "", "")).rejects.toThrow(/has new commits/u);
    expect(reloadAll).toHaveBeenCalledOnce();
    gh.commit.mockRejectedValueOnce(new SuggestionError("overlap"));
    await expect(result.current.api.commit(items, "", "")).rejects.toThrow(/change the same lines/u);
    gh.commit.mockRejectedValueOnce(new SuggestionError("outside"));
    await expect(result.current.api.commit(items, "", "")).rejects.toThrow(/no longer has the lines/u);
    gh.commit.mockRejectedValueOnce("Conflict");
    await expect(result.current.api.commit(items, "", "")).rejects.toThrow("Conflict");
    expect(reloadAll).toHaveBeenCalledOnce();
  });
});

function applied(threadId: string, commentId: string): Applied {
  return {
    thread: threadId,
    comment: commentId,
    path: "src/app.ts",
    author: { login: "grace" },
    start: 1,
    end: 1,
    lines: ["fixed"],
  };
}

describe("copyText", () => {
  it("falls back to a hidden field when the clipboard can't be used", async () => {
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const copied: string[] = [];
    const execCommand = vi.fn<(command: string) => boolean>((command) => {
      const field = document.querySelector("textarea");
      copied.push(`${command}:${field?.value}`);
      return true;
    });
    Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
    await copyText("https://example.com");
    expect(copied).toEqual(["copy:https://example.com"]);
    expect(document.querySelector("textarea")).toBeNull();
  });
});

describe("useConversationApi", () => {
  it("is null outside a review window, and the window's API inside one", () => {
    expect(renderHook(() => useConversationApi()).result.current).toBeNull();
    const { result } = setup();
    const api = result.current.api;
    const inside = renderHook(() => useConversationApi(), {
      wrapper: ({ children }) => <ConversationProvider value={api}>{children}</ConversationProvider>,
    });
    expect(inside.result.current).toBe(api);
  });
});
