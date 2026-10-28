import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { Composer, DraftView, FindingView, NewComment, ThreadView } from "@/components/thread/thread";
import { ConversationProvider, type ConversationApi } from "@/hooks/use-conversation/use-conversation";
import type { Exchange } from "@/utils/ai/ai";
import type { AiAnswer } from "@/utils/bridge/bridge";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Draft, Thread, ThreadComment } from "@/utils/review/review";

// The comment box's lookups (utils/writer/writer.ts) aren't what's tested here.
vi.mock("@/utils/writer/writer", () => ({
  emoji: vi.fn<() => Promise<never[]>>(() => Promise.resolve([])),
  mentionable: vi.fn<() => Promise<never[]>>(() => Promise.resolve([])),
  preview: vi.fn<() => Promise<string>>(() => Promise.resolve("")),
  referable: vi.fn<() => Promise<never[]>>(() => Promise.resolve([])),
  savedReplies: vi.fn<() => Promise<null>>(() => Promise.resolve(null)),
}));

// The Mac's ⌘ or everyone else's Ctrl, switched per test.
const platform = vi.hoisted(() => ({ mac: false }));
vi.mock("@/utils/os/os", async (original) => ({
  ...(await original<object>()),
  get isMac() {
    return platform.mac;
  },
}));

const nothing = () => {};

/** A promise settled from outside, for an answer that comes when the test says. */
function deferred<T>() {
  let resolve: (value: T) => void = nothing;
  let reject: (reason: unknown) => void = nothing;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function apiFor(overrides: Partial<ConversationApi> = {}): ConversationApi {
  return {
    repo: "acme/app",
    url: "https://github.com/acme/app/pull/12",
    me: "you",
    people: [],
    canApplySuggestion: false,
    branch: "feature",
    thread: vi.fn<ConversationApi["thread"]>(),
    patchOf: vi.fn<ConversationApi["patchOf"]>(),
    draft: vi.fn<ConversationApi["draft"]>(),
    draftError: vi.fn<ConversationApi["draftError"]>(),
    draftSending: () => false,
    retryDrafts: vi.fn<ConversationApi["retryDrafts"]>(),
    replyLater: vi.fn<ConversationApi["replyLater"]>(),
    editComment: vi.fn<ConversationApi["editComment"]>(() => Promise.resolve()),
    deleteComment: vi.fn<ConversationApi["deleteComment"]>(() => Promise.resolve()),
    editEntry: vi.fn<ConversationApi["editEntry"]>(),
    deleteEntry: vi.fn<ConversationApi["deleteEntry"]>(),
    editDescription: vi.fn<ConversationApi["editDescription"]>(),
    react: vi.fn<ConversationApi["react"]>(() => Promise.resolve()),
    copyLink: vi.fn<ConversationApi["copyLink"]>(),
    batch: [],
    toggleBatch: vi.fn<ConversationApi["toggleBatch"]>(),
    clearBatch: vi.fn<ConversationApi["clearBatch"]>(),
    commit: vi.fn<ConversationApi["commit"]>(),
    ...overrides,
  };
}

const withApi = (api: ConversationApi | null, ui: ReactNode) => (
  <ConversationProvider value={api}>{ui}</ConversationProvider>
);

const said = (n: number, more: Partial<ThreadComment> = {}): ThreadComment => ({
  id: `c${n}`,
  databaseId: n,
  author: { login: `person${n}`, name: `Person ${n}`, avatarUrl: "https://avatars.githubusercontent.com/u/1" },
  html: `<p>Comment ${n}</p>`,
  at: new Date(Date.now() - 60_000).toISOString(),
  url: `https://github.com/acme/app/pull/12#discussion_r${n}`,
  body: `Comment ${n}`,
  ...more,
});

const conversation = (more: Partial<Thread> = {}): Thread => ({
  id: "t1",
  path: "src/cart.ts",
  side: "additions",
  line: 12,
  resolved: false,
  outdated: false,
  comments: [said(1), said(2)],
  ...more,
});

const draftOf = (more: Partial<Draft> = {}): Draft => ({
  key: "d1",
  path: "src/cart.ts",
  side: "additions",
  line: 12,
  body: "Keep the code here",
  ...more,
});

/** Rust: the commands sent, by name and arguments. */
function rust() {
  const sent: Array<[string, unknown]> = [];
  mockCommands((cmd, args) => {
    sent.push([cmd, args]);
    return null;
  });
  return sent;
}

const suggestOffered = () => screen.queryByRole("button", { name: /Suggest/u });
const box = (name: string | RegExp) => screen.getByRole<HTMLTextAreaElement>("combobox", { name });

beforeEach(() => {
  platform.mac = false;
  rust();
  // As WebKit has it (happy-dom hasn't): it doesn't type here, so the field's own change does.
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
});

afterEach(() => {
  // Unmounted before the stand-ins below go.
  cleanup();
  Reflect.deleteProperty(document, "execCommand");
});

function threadView(thread: Thread, api: ConversationApi | null = apiFor(), more: { moved?: boolean } = {}) {
  const onReply = vi.fn<(body: string) => Promise<void>>(() => Promise.resolve());
  const onResolve = vi.fn<(resolved: boolean) => Promise<void>>(() => Promise.resolve());
  const result = render(
    withApi(api, <ThreadView thread={thread} onReply={onReply} onResolve={onResolve} className="x" {...more} />),
  );
  return { ...result, onReply, onResolve };
}

function draftView(draft: Draft, api: ConversationApi | null = apiFor()) {
  const onEdit = vi.fn<(body: string) => void>();
  const onRemove = vi.fn<() => void>();
  render(withApi(api, <DraftView draft={draft} onEdit={onEdit} onRemove={onRemove} />));
  return { onEdit, onRemove };
}

type Ask = (question: string, earlier: Exchange[], run: string) => Promise<AiAnswer>;
type Props = Partial<Parameters<typeof NewComment>[0]>;

function newComment(props: Props = {}, api: ConversationApi | null = apiFor()) {
  const onAdd = vi.fn<(body: string) => void>();
  const onSendNow = vi.fn<(body: string) => Promise<void>>(() => Promise.resolve());
  const onCancel = vi.fn<() => void>();
  const result = render(
    withApi(
      api,
      <NewComment
        lines="line 12"
        onAdd={onAdd}
        onSendNow={onSendNow}
        onCancel={onCancel}
        ask={null}
        askName="Claude"
        {...props}
      />,
    ),
  );
  return { ...result, onAdd, onSendNow, onCancel };
}
const tab = (name: string | RegExp) => screen.getByRole("tab", { name });
const question = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Your question about these lines" });

describe("Composer", () => {
  it("asks for something to be written first", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(body: string) => void>();
    render(<Composer placeholder="Reply" submitLabel="Send" onSubmit={onSubmit} onCancel={nothing} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("alert").textContent).toBe("Write something first.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("sends what's written, trimmed, and waits while it goes", async () => {
    const user = userEvent.setup();
    const sending = deferred<void>();
    const onSubmit = vi.fn<(body: string) => Promise<void>>(() => sending.promise);
    render(
      <Composer placeholder="Reply" submitLabel="Send" initial="  Done  " onSubmit={onSubmit} onCancel={nothing} />,
    );
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(onSubmit).toHaveBeenCalledWith("Done");
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", true);
    await act(async () => {
      sending.resolve();
      await sending.promise;
    });
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
  });

  it("says why it couldn't be sent", async () => {
    const user = userEvent.setup();
    const onSubmit = vi
      .fn<(body: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Not allowed"))
      .mockRejectedValueOnce("offline");
    render(<Composer placeholder="Reply" submitLabel="Send" initial="Hi" onSubmit={onSubmit} onCancel={nothing} />);
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not allowed");
    // ⌘/Ctrl+Enter from the field sends too.
    await user.click(box("Reply"));
    await user.keyboard("{Control>}{Enter}{/Control}");
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("offline");
    });
  });

  it("has a second way to send, and cancels", async () => {
    const user = userEvent.setup();
    const later = vi.fn<(body: string) => void>();
    const onCancel = vi.fn<() => void>();
    render(
      <Composer
        placeholder="Reply"
        submitLabel="Send"
        initial="Later"
        onSubmit={nothing}
        onCancel={onCancel}
        secondary={{ label: "Add to Review", onClick: later }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Add to Review" }));
    expect(later).toHaveBeenCalledWith("Later");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("ThreadView", () => {
  it("shows who said what and when, edited and outdated", () => {
    threadView(
      conversation({
        outdated: true,
        comments: [said(1, { edited: true }), said(2, { author: null }), said(3, { author: { login: "bob" } })],
      }),
      null,
    );
    expect(screen.getByText("Comment 1")).toBeTruthy();
    expect(screen.getAllByText(/edited/u)).toHaveLength(1);
    expect(screen.getAllByText(/outdated/u)).toHaveLength(3);
    expect(screen.getByText("Person")).toBeTruthy();
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.getByText("BO")).toBeTruthy();
    // Only shown outside a review window: no menus.
    expect(screen.queryByRole("button", { name: "More for this comment" })).toBeNull();
  });

  it("says where it was when its line is gone, or that it's on the file", () => {
    const { unmount } = threadView(conversation(), apiFor(), { moved: true });
    expect(screen.getByText("On line 12, which this diff no longer shows")).toBeTruthy();
    unmount();
    threadView(conversation({ line: 0 }), apiFor(), { moved: true });
    expect(screen.getByText("On the file")).toBeTruthy();
  });

  it("shows the conversation as it is now, though it was drawn before", () => {
    const now = conversation({ comments: [said(1), said(2), said(3, { html: "<p>Newest</p>" })] });
    threadView(conversation(), apiFor({ thread: () => now }));
    expect(screen.getByText("Newest")).toBeTruthy();
  });

  it("folds a resolved conversation until it's opened", async () => {
    const user = userEvent.setup();
    const { onResolve } = threadView(conversation({ resolved: true }));
    await user.click(screen.getByRole("button", { name: "Resolved conversation · 2 comments · show" }));
    expect(screen.getByText("Comment 1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Unresolve" }));
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it("folds the middle of a long conversation", async () => {
    const user = userEvent.setup();
    threadView(conversation({ comments: Array.from({ length: 10 }, (_, i) => said(i + 1)) }));
    expect(screen.getByText("Comment 1")).toBeTruthy();
    expect(screen.queryByText("Comment 2")).toBeNull();
    expect(screen.getByText("Comment 8")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show 6 more replies" }));
    expect(screen.getByText("Comment 2")).toBeTruthy();
  });

  it("resolves, waiting while GitHub does it", async () => {
    const user = userEvent.setup();
    const done = deferred<void>();
    const onReply = vi.fn<(body: string) => Promise<void>>();
    const onResolve = vi.fn<(resolved: boolean) => Promise<void>>(() => done.promise);
    render(withApi(apiFor(), <ThreadView thread={conversation()} onReply={onReply} onResolve={onResolve} />));
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect(onResolve).toHaveBeenCalledWith(true);
    expect(screen.getByRole("button", { name: "Resolve" })).toHaveProperty("disabled", true);
    await act(async () => {
      done.resolve();
      await done.promise;
    });
    expect(screen.getByRole("button", { name: "Resolve" })).toHaveProperty("disabled", false);
  });

  it("says why it couldn't resolve", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn<(resolved: boolean) => Promise<void>>(() => Promise.reject(new Error("Not allowed")));
    render(
      withApi(
        apiFor(),
        <ThreadView thread={conversation()} onReply={vi.fn<(body: string) => Promise<void>>()} onResolve={onResolve} />,
      ),
    );
    await user.click(screen.getByRole("button", { name: "Resolve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Not allowed");
    expect(screen.getByRole("button", { name: "Resolve" })).toHaveProperty("disabled", false);
  });

  it("replies now, or with your review", async () => {
    const user = userEvent.setup();
    const api = apiFor();
    const thread = conversation();
    const { onReply } = threadView(thread, api);
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.type(box("Reply"), "Agreed");
    await user.click(screen.getAllByRole("button", { name: "Reply" }).at(-1)!);
    expect(onReply).toHaveBeenCalledWith("Agreed");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.type(box("Reply"), "Later");
    await user.click(screen.getByRole("button", { name: "Add to Review" }));
    expect(api.replyLater).toHaveBeenCalledWith(thread, "Later");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("only replies now outside a review window", async () => {
    const user = userEvent.setup();
    threadView(conversation(), null);
    await user.click(screen.getByRole("button", { name: "Reply" }));
    expect(screen.queryByRole("button", { name: "Add to Review" })).toBeNull();
  });

  it("adds a quote to the reply being written", async () => {
    const user = userEvent.setup();
    threadView(conversation({ comments: [said(1, { body: "Use a map" }), said(2, { body: "Or a set" })] }));
    const [first, second] = screen.getAllByRole("button", { name: "More for this comment" });
    await user.click(screen.getByRole("button", { name: "Reply" }));
    await user.click(first!);
    await user.click(screen.getByRole("menuitem", { name: "Quote Reply" }));
    expect(box("Reply").value).toBe("> Use a map\n\n");
    await user.type(box("Reply"), "Agreed");
    await user.click(second!);
    await user.click(screen.getByRole("menuitem", { name: "Quote Reply" }));
    expect(box("Reply").value).toBe("> Use a map\n\nAgreed\n\n> Or a set\n\n");
  });

  it("quotes, edits and deletes a comment from its menu", async () => {
    const user = userEvent.setup();
    const api = apiFor();
    const mine = said(1, { canEdit: true, canDelete: true, canReact: true, body: "Use a map\nhere" });
    threadView(conversation({ comments: [mine, said(2, { body: undefined })] }), api);
    const [first, second] = screen.getAllByRole("button", { name: "More for this comment" });

    await user.click(first!);
    await user.click(screen.getByRole("menuitem", { name: "Quote Reply" }));
    expect(box("Reply").value).toBe("> Use a map\n> here\n\n");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await user.click(first!);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(box("Comment").value).toBe("Use a map\nhere");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("combobox")).toBeNull();

    await user.click(first!);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    await user.type(box("Comment"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(api.editComment).toHaveBeenCalledWith(mine, "Use a map\nhere!");
    await waitFor(() => {
      expect(screen.queryByRole("combobox")).toBeNull();
    });

    await user.click(first!);
    await user.click(screen.getByRole("menuitem", { name: /Delete/u }));
    expect(api.deleteComment).toHaveBeenCalledWith(mine);

    // Without its Markdown (an older copy), there's nothing to quote or edit.
    await user.click(second!);
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Quote Reply" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Edit" })).toBeNull();
  });

  it("reacts to a comment that can be reacted to", async () => {
    const user = userEvent.setup();
    const api = apiFor();
    threadView(
      conversation({
        comments: [said(1, { canReact: true, reactions: [{ content: "HEART", count: 1, mine: false, who: ["ana"] }] })],
      }),
      api,
    );
    await user.click(screen.getByRole("button", { name: /ana reacted with heart/iu }));
    expect(api.react).toHaveBeenCalledWith("c1", "HEART", true, expect.any(Array));
  });
});

describe("DraftView", () => {
  it("says what kind of pending comment it is", () => {
    draftView(draftOf(), null);
    expect(screen.getByText("Pending · sent with your review")).toBeTruthy();
    cleanup();
    draftView(draftOf({ file: true }));
    expect(screen.getByText("Pending, on the file · sent with your review")).toBeTruthy();
    cleanup();
    draftView(draftOf({ replyTo: "t1" }));
    expect(screen.getByText("Pending reply · sent with your review")).toBeTruthy();
  });

  it("says where it is: on its way, or on GitHub with GitHub's HTML", () => {
    draftView(draftOf({ html: "<p>Keep it</p>", id: "PRRC_1" }), apiFor({ draftSending: () => true }));
    expect(screen.getByRole("status").textContent).toContain("Saving to GitHub…");
    expect(screen.getByText("Keep the code here")).toBeTruthy();
    cleanup();
    const drawn = draftOf();
    draftView(drawn, apiFor({ draft: () => ({ ...drawn, html: "<p><em>Keep it</em></p>", id: "PRRC_1" }) }));
    expect(screen.getByText("· on GitHub")).toBeTruthy();
    expect(screen.getByText("Keep it").tagName).toBe("EM");
  });

  it("says why GitHub refused it, with a way to try again", async () => {
    const user = userEvent.setup();
    const api = apiFor({ draftError: () => "Line not in the diff", draftSending: () => true });
    draftView(draftOf({ id: "PRRC_1" }), api);
    expect(screen.getByRole("alert").textContent).toContain("GitHub didn't take it: Line not in the diff");
    expect(screen.queryByText("· on GitHub")).toBeNull();
    expect(screen.queryByText("Saving to GitHub…")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(api.retryDrafts).toHaveBeenCalledOnce();
  });

  it("is edited in place and removed", async () => {
    const user = userEvent.setup();
    const { onEdit, onRemove } = draftView(draftOf());
    await user.click(screen.getByRole("button", { name: "Edit comment" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit comment" }));
    await user.type(box("Comment"), ", please");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onEdit).toHaveBeenCalledWith("Keep the code here, please");
    await user.click(screen.getByRole("button", { name: "Remove comment" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe("FindingView", () => {
  it("shows the AI's comment, to add to the review or dismiss", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn<() => void>();
    const onDismiss = vi.fn<() => void>();
    const finding = {
      path: "src/cart.ts",
      line: 12,
      severity: "issue",
      body: "`total` can be **negative**",
      inDiff: true,
    } as const;
    render(<FindingView finding={finding} by="Claude" onAdd={onAdd} onDismiss={onDismiss} />);
    expect(screen.getByText(/Claude · Issue/u)).toBeTruthy();
    expect(screen.getByText("negative").tagName).toBe("STRONG");
    await user.click(screen.getByRole("button", { name: "Add to my review" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

describe("NewComment", () => {
  describe("as a comment", () => {
    it("goes into the review, or is posted now", async () => {
      const user = userEvent.setup();
      const { onAdd, onSendNow } = newComment();
      expect(tab("Comment").getAttribute("aria-selected")).toBe("true");
      expect(screen.getByText("Goes into your review · Ctrl+Enter")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Comment" }));
      expect(screen.getByRole("alert").textContent).toBe("Write something first.");
      await user.type(box("Your comment for the author"), "  Rename this  ");
      await user.click(screen.getByRole("button", { name: "Comment" }));
      expect(onAdd).toHaveBeenCalledWith("Rename this");
      await user.click(screen.getByRole("button", { name: "Post now" }));
      expect(onSendNow).toHaveBeenCalledWith("Rename this");
      // ⌘/Ctrl+Enter from the field.
      await user.click(box("Your comment for the author"));
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onAdd).toHaveBeenCalledTimes(2);
    });

    it("names ⌘↩ on the Mac", () => {
      platform.mac = true;
      newComment();
      expect(screen.getByText("Goes into your review · ⌘Enter")).toBeTruthy();
    });

    it("waits while it's posted, and says why it wasn't", async () => {
      const user = userEvent.setup();
      const posting = deferred<void>();
      const onSendNow = vi
        .fn<(body: string) => Promise<void>>()
        .mockReturnValueOnce(posting.promise)
        .mockRejectedValueOnce(new Error("Not allowed"))
        .mockRejectedValueOnce("offline")
        .mockRejectedValueOnce({ code: 1 });
      newComment({ onSendNow });
      await user.type(box("Your comment for the author"), "Hi");
      await user.click(screen.getByRole("button", { name: "Post now" }));
      expect(screen.getByRole("button", { name: "Close" })).toHaveProperty("disabled", true);
      await act(async () => {
        posting.resolve();
        await posting.promise;
      });
      await user.click(screen.getByRole("button", { name: "Post now" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Not allowed");
      await user.click(screen.getByRole("button", { name: "Post now" }));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toBe("offline");
      });
      await user.click(screen.getByRole("button", { name: "Post now" }));
      await waitFor(() => {
        expect(screen.getByRole("alert").textContent).toBe("[object Object]");
      });
    });

    it("offers the lines picked as a suggested change, on the new version's lines", async () => {
      const user = userEvent.setup();
      const patch = "@@ -1,2 +1,3 @@\n a\n+b\n+c";
      const api = apiFor({ patchOf: () => patch });
      newComment({ path: "src/cart.ts", range: { start: 3, end: 2, side: "additions" } }, api);
      await user.click(screen.getByRole("button", { name: /Suggest/u }));
      await waitFor(() => {
        expect(box("Your comment for the author").value).toBe("```suggestion\nb\nc\n```\n");
      });
    });

    it("offers no suggested change on the file, the old version's lines, or without the patch", () => {
      const patch = "@@ -1,2 +1,3 @@\n a\n+b\n+c";
      const api = apiFor({ patchOf: () => patch });
      newComment({ path: "src/cart.ts", range: { start: 2, end: 2 }, file: true }, api);
      expect(suggestOffered()).toBeNull();
      cleanup();
      newComment({ path: "src/cart.ts", range: { start: 1, end: 1, side: "deletions" } }, api);
      expect(suggestOffered()).toBeNull();
      cleanup();
      newComment({ path: "src/cart.ts", range: { start: 1, end: 2, side: "additions", endSide: "deletions" } }, api);
      expect(suggestOffered()).toBeNull();
      cleanup();
      newComment({ path: "src/cart.ts" }, api);
      expect(suggestOffered()).toBeNull();
      cleanup();
      newComment({ range: { start: 2, end: 2 } }, null);
      expect(suggestOffered()).toBeNull();
      cleanup();
      // With no side said, the new version's.
      newComment({ path: "src/cart.ts", range: { start: 2, end: 2 } }, api);
      expect(suggestOffered()).toBeTruthy();
    });

    it("closes with Escape", async () => {
      const user = userEvent.setup();
      const { onCancel } = newComment();
      await user.click(box("Your comment for the author"));
      await user.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalledOnce();
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(onCancel).toHaveBeenCalledTimes(2);
    });
  });

  describe("asking the AI", () => {
    it("points to Settings when there's no AI", async () => {
      const user = userEvent.setup();
      const sent = rust();
      newComment();
      await user.click(tab("Ask AI"));
      expect(screen.getByText(/Set up Claude Code or Cursor/u)).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Open Settings" }));
      expect(sent.map(([cmd]) => cmd)).toContain("open_settings");
      // The tab picked last is the one the next box opens on.
      expect(localStorage.getItem("selection-tab")).toBe("ask");
    });

    it("opens on the tab picked last, and on the comment when that can't be read or kept", async () => {
      const user = userEvent.setup();
      localStorage.setItem("selection-tab", "ask");
      const { unmount } = newComment({ ask: vi.fn<Ask>() });
      expect(tab("Ask Claude").getAttribute("aria-selected")).toBe("true");
      expect(document.activeElement).toBe(question());
      unmount();

      vi.spyOn(localStorage, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      vi.spyOn(localStorage, "setItem").mockImplementation(() => {
        throw new Error("denied");
      });
      newComment();
      expect(tab("Comment").getAttribute("aria-selected")).toBe("true");
      await user.click(tab("Ask AI"));
      expect(tab("Ask AI").getAttribute("aria-selected")).toBe("true");
    });

    it("asks with Enter, keeps the conversation going, and turns an answer into a comment", async () => {
      const user = userEvent.setup();
      const first = deferred<AiAnswer>();
      const ask = vi
        .fn<Ask>()
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ text: "It's only for **guests**.", project: false });
      const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>();
      Element.prototype.scrollIntoView = scrolled;
      newComment({ ask });
      await user.click(tab("Ask Claude"));
      expect(screen.getByRole("button", { name: "Ask" })).toHaveProperty("disabled", true);
      // Nothing asked yet: Enter does nothing.
      await user.keyboard("{Enter}");
      expect(ask).not.toHaveBeenCalled();

      await user.type(question(), "What does it do?{Shift>}{Enter}{/Shift}Briefly");
      expect(question().value).toBe("What does it do?\nBriefly");
      await user.keyboard("{Enter}");
      expect(ask).toHaveBeenCalledWith("What does it do?\nBriefly", [], expect.any(String));
      expect(question().value).toBe("");
      expect(screen.getByRole("status").textContent).toContain("Claude is reading the code…");
      expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
      // Still answering: Enter doesn't ask again.
      await user.type(question(), "And?");
      await user.keyboard("{Enter}");
      expect(ask).toHaveBeenCalledOnce();

      await act(async () => {
        first.resolve({ text: "Applies the code.", project: true, note: "Read the diff only" });
        await first.promise;
      });
      expect(screen.getByText("Applies the code.")).toBeTruthy();
      expect(screen.getByText("Read the diff only")).toBeTruthy();
      expect(document.activeElement).toBe(question());
      expect(question().placeholder).toBe("Ask a follow-up…");

      await user.keyboard("{Control>}{Enter}{/Control}");
      await waitFor(() => {
        expect(screen.getByText("guests")).toBeTruthy();
      });
      expect(ask).toHaveBeenLastCalledWith(
        "And?",
        [{ question: "What does it do?\nBriefly", answer: "Applies the code." }],
        expect.any(String),
      );
      const list = screen.getByRole("list", { name: "Conversation with Claude" });
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);

      await user.click(screen.getAllByRole("button", { name: "Turn into a comment" })[1]!);
      expect(tab("Comment").getAttribute("aria-selected")).toBe("true");
      expect(box("Your comment for the author").value).toBe("It's only for **guests**.");
      // Back to asking: the conversation is still there.
      await user.click(tab("Ask Claude"));
      expect(screen.getAllByRole("listitem")).toHaveLength(2);
    });

    it("says how long it's been, and stops when asked", async () => {
      const user = userEvent.setup();
      const sent = rust();
      let now = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      const ask = vi.fn<Ask>(() => new Promise(() => {}));
      // Reduce Motion on: the newest answer comes into view without a slide.
      const still = window.matchMedia("(prefers-reduced-motion: reduce)");
      Object.defineProperty(still, "matches", { value: true });
      vi.spyOn(window, "matchMedia").mockReturnValue(still);
      const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>();
      Element.prototype.scrollIntoView = scrolled;
      newComment({ ask });
      await user.click(tab("Ask Claude"));
      await user.type(question(), "Why?{Enter}");
      expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest", behavior: "auto" });
      expect(screen.getByRole("status").textContent).not.toContain("·");
      now += 4000;
      await act(async () => {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 1100);
        });
      });
      expect(screen.getByRole("status").textContent).toContain(" · 4s");
      await user.click(screen.getByRole("button", { name: "Stop" }));
      const cancelled = sent.find(([cmd]) => cmd === "ai_cancel");
      expect(cancelled?.[1]).toEqual({ run: ask.mock.calls[0]?.[2] });
    });

    it("puts the question back to try again when the AI fails", async () => {
      const user = userEvent.setup();
      const ask = vi
        .fn<Ask>()
        .mockRejectedValueOnce("Claude Code isn't signed in")
        .mockRejectedValueOnce(new Error("Timed out"));
      const { onCancel } = newComment({ ask });
      await user.click(tab("Ask Claude"));
      await user.type(question(), "Why?{Enter}");
      expect((await screen.findByRole("alert")).textContent).toBe("Claude Code isn't signed in");
      expect(question().value).toBe("Why?");
      expect(screen.queryByRole("list")).toBeNull();
      await user.click(screen.getByRole("button", { name: "Ask" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Timed out");
      // Switching tabs clears what was said.
      await user.click(tab("Comment"));
      expect(screen.queryByRole("alert")).toBeNull();
      await user.click(tab("Ask Claude"));
      // Escape closes, and isn't the window's.
      const outside = vi.fn<() => void>();
      window.addEventListener("keydown", outside);
      fireEvent.keyDown(question(), { key: "Escape" });
      window.removeEventListener("keydown", outside);
      expect(onCancel).toHaveBeenCalledOnce();
      expect(outside).not.toHaveBeenCalled();
      // A key that's neither: typed.
      fireEvent.keyDown(question(), { key: "a" });
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("doesn't ask while a word is being composed (an input method's Enter)", () => {
      const ask = vi.fn<Ask>();
      newComment({ ask });
      fireEvent.click(tab("Ask Claude"));
      fireEvent.change(question(), { target: { value: "日本" } });
      fireEvent.keyDown(question(), { key: "Enter", isComposing: true });
      expect(ask).not.toHaveBeenCalled();
    });
  });
});
