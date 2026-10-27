import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vite-plus/test";

import { Overview } from "@/components/overview/overview";
import { openViewer } from "@/components/viewer/viewer";
import { ConversationProvider, copyText, type ConversationApi } from "@/hooks/use-conversation/use-conversation";
import type { Pull } from "@/hooks/use-pull/use-pull";
import type { AiReview, Finding } from "@/utils/ai/ai";
import { defaultConfig, type Config } from "@/utils/config/config";
import type { Conversation, ConversationEntry, Said } from "@/utils/conversation/conversation";
import type { Details, Entry } from "@/utils/details/details";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Thread } from "@/utils/review/review";
import type { TimelineEvent } from "@/utils/timeline/timeline";

// What's beside the conversation has tests of its own: here they only show they're there, and the
// boxes to write in hand back what was "written".
vi.mock("@/components/merge-box/merge-box", () => ({ MergeBox: () => <p>Merge box</p> }));
vi.mock("@/components/checks/checks", () => ({ Checks: () => <p>Checks</p> }));
vi.mock("@/components/commits/commits", () => ({ CommitsSection: () => <p>Commits</p> }));
vi.mock("@/components/sidebar/sidebar", () => ({ Sidebar: () => <p>Sidebar</p> }));
vi.mock("@/components/ask-ai/ask-ai", () => ({ AskAi: () => <p>Ask AI</p> }));
vi.mock("@/components/ai-answer/ai-answer", () => ({ AiAnswer: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock("@/components/timeline/timeline", () => ({
  TimelineRow: ({ event }: { event: TimelineEvent }) => <p>Event {event.id}</p>,
}));
vi.mock("@/components/viewer/viewer", () => ({ openViewer: vi.fn<(picture: { src: string; alt: string }) => void>() }));
vi.mock("@/utils/diagrams/diagrams", () => ({ useDiagrams: () => {} }));
vi.mock("@/hooks/use-conversation/use-conversation", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  copyText: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
}));
vi.mock("@/components/said/said", () => ({
  ACTIONS: "",
  useReactions: (_subject: string, given: unknown[]) => [given, () => {}],
  ReactionPicker: () => <button type="button">React</button>,
  ReactionList: ({ reactions, canReact }: { reactions: unknown[]; canReact: boolean }) => (
    <p>{`${reactions.length} reactions${canReact ? ", can react" : ""}`}</p>
  ),
  CommentMenu: ({
    onQuote,
    onEdit,
    onDelete,
  }: {
    onQuote?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
  }) => (
    <>
      {onQuote ? (
        <button type="button" onClick={onQuote}>
          Quote reply
        </button>
      ) : null}
      {onEdit ? (
        <button type="button" onClick={onEdit}>
          Edit
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" onClick={onDelete}>
          Delete
        </button>
      ) : null}
    </>
  ),
}));
vi.mock("@/components/thread/thread", () => ({
  Composer: ({
    placeholder,
    initial,
    onSubmit,
    onCancel,
  }: {
    placeholder: string;
    initial?: string;
    onSubmit: (body: string) => Promise<void>;
    onCancel: () => void;
  }) => (
    <fieldset aria-label={placeholder}>
      <pre>{initial}</pre>
      <button type="button" onClick={() => void onSubmit("Written")}>
        Send
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </fieldset>
  ),
  ThreadView: ({
    thread,
    onReply,
    onResolve,
  }: {
    thread: Thread;
    onReply: (body: string) => Promise<void>;
    onResolve: (resolved: boolean) => Promise<void>;
  }) => (
    <div>
      <button type="button" onClick={() => void onReply("Thanks")}>
        Reply to {thread.id}
      </button>
      <button type="button" onClick={() => void onResolve(true)}>
        Resolve {thread.id}
      </button>
    </div>
  ),
}));

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ana = { login: "ana", name: "Ana Lima", avatarUrl: "https://avatars.githubusercontent.com/u/1" };

const details: Details = {
  id: "PR_1",
  number: 1807,
  title: "Keep the promo code when the cart changes",
  url: "https://github.com/acme/shop/pull/1807",
  html: "<p>Fixes the cart.</p>",
  owner: "acme",
  repo: "shop",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "promo-keep",
  headRefOid: "abc123",
  updatedAt: ago(5),
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  createdAt: ago(120),
  author: ana,
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
};

const comment = (id: string, minutes: number, extra: Partial<Said> = {}): ConversationEntry => ({
  kind: "comment",
  id,
  author: ana,
  html: `<p>Said ${id}</p>`,
  at: ago(minutes),
  url: `https://github.com/acme/shop/pull/1807#${id}`,
  body: `Said ${id}`,
  canEdit: false,
  canDelete: false,
  canReact: false,
  edited: false,
  reactions: [],
  ...extra,
});

const conversation = (entries: ConversationEntry[], extra: Partial<Conversation> = {}): Conversation => ({
  body: "Fixes the cart.",
  html: "<p>Fixes the cart, as edited.</p>",
  canEdit: false,
  canReact: false,
  reactions: [],
  canApplySuggestion: false,
  headRepo: "acme/shop",
  headRef: "promo-keep",
  headOid: "abc123",
  entries,
  ...extra,
});

const thread = (id: string, commentIds: string[], line = 12): Thread => ({
  id,
  path: "src/cart.ts",
  side: "additions",
  line,
  resolved: false,
  outdated: false,
  comments: commentIds.map((c, i) => ({
    id: c,
    databaseId: i,
    author: ana,
    html: `<p>${c}</p>`,
    at: ago(30),
    url: `https://github.com/acme/shop/pull/1807#${c}`,
  })),
});

function pullWith(extra: { events?: TimelineEvent[]; older?: string | null; loadOlder?: () => Promise<void> } = {}) {
  const pull: Pick<Pull, "events" | "older" | "loadOlder"> = {
    events: extra.events ?? [],
    older: extra.older ?? null,
    loadOlder: extra.loadOlder ?? (() => Promise.resolve()),
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the Overview reads only these; the rest goes to the parts mocked above
  return pull as Pull;
}

const done = () => Promise.resolve();

function api(extra: Partial<ConversationApi> = {}): ConversationApi {
  return {
    repo: "acme/shop",
    url: details.url,
    me: "you",
    people: [],
    canApplySuggestion: false,
    branch: "promo-keep",
    thread: vi.fn<ConversationApi["thread"]>(),
    patchOf: vi.fn<ConversationApi["patchOf"]>(),
    draft: vi.fn<ConversationApi["draft"]>(),
    draftError: vi.fn<ConversationApi["draftError"]>(),
    draftSending: vi.fn<ConversationApi["draftSending"]>(() => false),
    retryDrafts: vi.fn<ConversationApi["retryDrafts"]>(),
    replyLater: vi.fn<ConversationApi["replyLater"]>(),
    editComment: vi.fn<ConversationApi["editComment"]>(done),
    deleteComment: vi.fn<ConversationApi["deleteComment"]>(done),
    editEntry: vi.fn<ConversationApi["editEntry"]>(done),
    deleteEntry: vi.fn<ConversationApi["deleteEntry"]>(done),
    editDescription: vi.fn<ConversationApi["editDescription"]>(done),
    react: vi.fn<ConversationApi["react"]>(done),
    copyLink: vi.fn<ConversationApi["copyLink"]>(),
    batch: [],
    toggleBatch: vi.fn<ConversationApi["toggleBatch"]>(),
    clearBatch: vi.fn<ConversationApi["clearBatch"]>(),
    commit: vi.fn<ConversationApi["commit"]>(done),
    ...extra,
  };
}

type Props = ComponentProps<typeof Overview>;

function props(extra: Partial<Props> = {}): Props {
  return {
    config: null,
    details,
    review: null,
    reviewing: false,
    reviewError: null,
    onJump: vi.fn<Props["onJump"]>(),
    threads: [],
    onReply: vi.fn<Props["onReply"]>(done),
    onResolve: vi.fn<Props["onResolve"]>(done),
    // Posted, but GitHub didn't say its id.
    onComment: vi.fn<Props["onComment"]>().mockResolvedValue(void 0),
    pull: pullWith(),
    me: "you",
    onOpenRange: vi.fn<Props["onOpenRange"]>(),
    hasFile: () => true,
    say: vi.fn<Props["say"]>(),
    ...extra,
  };
}

function show(extra: Partial<Props> = {}, withApi: ConversationApi | null = null) {
  const all = props(extra);
  const view = render(
    <ConversationProvider value={withApi}>
      <Overview {...all} />
    </ConversationProvider>,
  );
  const again = (more: Partial<Props>) => {
    view.rerender(
      <ConversationProvider value={withApi}>
        <Overview {...all} {...more} />
      </ConversationProvider>,
    );
  };
  return { ...all, again };
}

const openUrls = () => {
  const opened: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "open_url" && args && "url" in args) opened.push(args.url);
  });
  return opened;
};

let scrolled: MockInstance<Element["scrollIntoView"]>;
let lit: MockInstance<Element["animate"]>;
beforeEach(() => {
  scrolled = vi.spyOn(Element.prototype, "scrollIntoView");
  lit = vi.spyOn(Element.prototype, "animate");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the heading", () => {
  it("shows the title, number, who opened it and which branch goes into which", () => {
    show();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain(
      "Keep the promo code when the cart changes #1807",
    );
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByTitle("main")).toBeTruthy();
    expect(screen.getByTitle("promo-keep")).toBeTruthy();
    expect(screen.getByLabelText("from")).toBeTruthy();
  });

  it("shows the stack it's in under the heading, and goes to another of it", async () => {
    const onPickStack = vi.fn<NonNullable<Props["onPickStack"]>>();
    const pulls = [1807, 1812].map((number) => ({
      id: `PR_${number}`,
      number,
      title: `Pull request ${number}`,
      author: null,
      decision: null,
      isDraft: false,
    }));
    show({ stack: { pulls, at: 0 }, onPickStack });
    expect(screen.getByRole("heading", { name: /Stack/u })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Pull request 1812/u }));
    expect(onPickStack).toHaveBeenCalledWith(pulls[1]);
  });

  it("names someone when the author is gone", () => {
    show({ details: { ...details, author: null } });
    expect(screen.getByText("Someone")).toBeTruthy();
  });

  it("copies a branch's name, says so a moment, then offers it again", async () => {
    vi.useFakeTimers();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Copy promo-keep" }));
    await act(() => Promise.resolve());
    expect(copyText).toHaveBeenCalledWith("promo-keep");
    expect(screen.getByRole("button", { name: "Branch name copied" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("button", { name: "Copy promo-keep" })).toBeTruthy();
  });
});

describe("the description", () => {
  it("shows the details' description until the conversation's arrives", () => {
    const { again } = show();
    expect(screen.getByText("Fixes the cart.")).toBeTruthy();
    again({ conversation: conversation([]) });
    expect(screen.getByText("Fixes the cart, as edited.")).toBeTruthy();
  });

  it("says when there's none", () => {
    show({ details: { ...details, html: "  " } });
    expect(screen.getByText("No description.")).toBeTruthy();
  });

  it("opens links in the browser and pictures in the viewer", async () => {
    const opened = openUrls();
    show({
      details: {
        ...details,
        html: [
          '<p><a href="https://example.com/docs">the docs</a></p>',
          '<p><img src="https://github.com/user-attachments/assets/shot.png" alt="Screenshot"></p>',
          '<p><a href="https://example.com/page"><img src="https://github.com/user-attachments/assets/badge.png" alt="Badge"></a></p>',
          "<p>Plain words</p>",
        ].join(""),
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByText("the docs"));
    await user.click(screen.getByAltText("Screenshot"));
    await user.click(screen.getByAltText("Badge"));
    await user.click(screen.getByText("Plain words"));
    expect(openViewer).toHaveBeenCalledTimes(1);
    expect(openViewer).toHaveBeenCalledWith(expect.objectContaining({ alt: "Screenshot" }));
    expect(opened).toEqual(["https://example.com/docs", "https://example.com/page"]);
  });

  it("only shows when there's no conversation API", () => {
    show({ conversation: conversation([], { canEdit: true, canReact: true }) });
    expect(screen.queryByRole("button", { name: "Edit description" })).toBeNull();
    expect(screen.queryByRole("button", { name: "React" })).toBeNull();
    expect(screen.getByText("0 reactions")).toBeTruthy();
  });

  it("is edited in place when you may, and reacted to", async () => {
    const talk = api();
    show({ conversation: conversation([], { canEdit: true, canReact: true, html: "" }) }, talk);
    const user = userEvent.setup();
    expect(screen.getByText("0 reactions, can react")).toBeTruthy();
    expect(screen.getByRole("button", { name: "React" })).toBeTruthy();
    expect(screen.getByText("No description.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    const box = screen.getByRole("group", { name: "Comment" });
    expect(box?.textContent).toContain("Fixes the cart.");
    expect(screen.queryByRole("button", { name: "Edit description" })).toBeNull();
    await user.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("group", { name: "Comment" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Edit description" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(talk.editDescription).toHaveBeenCalledWith("Written");
    expect(screen.queryByRole("group", { name: "Comment" })).toBeNull();
  });
});

describe("the conversation", () => {
  it("says when nothing's been said yet", () => {
    show();
    expect(screen.getByText("No conversation yet.")).toBeTruthy();
  });

  it("puts what happened among what was said, and who said what", () => {
    const entries: Entry[] = [
      { kind: "comment", id: "C1", author: null, html: "<p>First!</p>", at: ago(10), url: "u" },
      {
        kind: "review",
        id: "R1",
        author: ana,
        state: "APPROVED",
        html: "<p>Looks good</p>",
        at: ago(30),
        url: "u",
        comments: [],
      },
      {
        kind: "review",
        id: "R2",
        author: ana,
        state: "WEIRD",
        html: "<p>Odd</p>",
        at: ago(40),
        url: "u",
        comments: [],
      },
    ];
    const event = { id: "E1", at: ago(20), actor: null, kind: "renamed", from: "a", to: "b" } as TimelineEvent;
    show({ details: { ...details, entries }, pull: pullWith({ events: [event] }) });
    const heading = screen.getByRole("heading", { name: /Conversation/u });
    expect(heading?.textContent).toContain("Conversation 3");
    const said = screen.getAllByRole("article");
    expect(said).toHaveLength(3);
    expect(said[0]?.textContent).toContain("Someone");
    expect(within(said[1]!).getByText("approved")).toBeTruthy();
    expect(said[2]?.textContent).not.toContain("weird");
    expect(screen.getByText("Event E1")).toBeTruthy();
    // Without the conversation API, nothing to quote or edit.
    expect(screen.queryByRole("button", { name: "Quote reply" })).toBeNull();
  });

  it("shows a review's comments on lines, each conversation once, under the review that started it", async () => {
    const started = thread("T1", ["RC1", "RC2"]);
    const onFile = thread("T2", ["RC4"], 0);
    const entries: Entry[] = [
      {
        kind: "review",
        id: "R1",
        author: ana,
        state: "COMMENTED",
        html: "",
        at: ago(10),
        url: "u",
        comments: [
          { id: "RC1", path: "src/cart.ts", line: 12, html: "<p>RC1</p>", author: ana, url: "u" },
          { id: "RC3", path: "src/old.ts", line: null, html: "<p>Outdated words</p>", author: ana, url: "u" },
          { id: "RC4", path: "src/cart.ts", line: 0, html: "<p>RC4</p>", author: ana, url: "u" },
          { id: "RC5", path: "src/promo.ts", line: 3, html: "<p>On promo</p>", author: ana, url: "u" },
        ],
      },
      // Only a reply to a conversation shown above: nothing of its own.
      {
        kind: "review",
        id: "R2",
        author: ana,
        state: "COMMENTED",
        html: " ",
        at: ago(20),
        url: "u",
        comments: [{ id: "RC2", path: "src/cart.ts", line: 12, html: "<p>RC2</p>", author: ana, url: "u" }],
      },
    ];
    const p = show({ details: { ...details, entries }, threads: [started, onFile] });
    const user = userEvent.setup();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Outdated words")).toBeTruthy();
    expect(screen.queryByText(/reactions/u, { selector: "article p" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show src/cart.ts line 12 in the diff" }));
    expect(p.onJump).toHaveBeenCalledWith("src/cart.ts", 12);
    expect(screen.getAllByRole("button", { name: "Show src/cart.ts in the diff" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Show src/old.ts in the diff" }));
    expect(p.onJump).toHaveBeenCalledWith("src/old.ts", null);
    expect(screen.getByRole("button", { name: "Show src/promo.ts line 3 in the diff" }).textContent).toContain(
      "Go to Line",
    );

    await user.click(screen.getByRole("button", { name: "Reply to T1" }));
    expect(p.onReply).toHaveBeenCalledWith(started, "Thanks");
    await user.click(screen.getByRole("button", { name: "Resolve T2" }));
    expect(p.onResolve).toHaveBeenCalledWith(onFile, true);
  });

  it("lets you quote, edit and delete what you may", async () => {
    const talk = api();
    const mine = comment("C1", 5, { canEdit: true, canDelete: true, canReact: true, edited: true });
    const review: ConversationEntry = {
      kind: "review",
      id: "R1",
      author: ana,
      state: "COMMENTED",
      html: "",
      at: ago(10),
      url: "u",
      comments: [{ id: "RC1", path: "src/cart.ts", line: 3, html: "<p>x</p>", author: ana, url: "u" }],
      body: "",
      canEdit: true,
      canDelete: true,
      canReact: true,
      edited: false,
      reactions: [],
    };
    const theirs = comment("C2", 20, { body: "" });
    const p = show({ conversation: conversation([mine, review, theirs]) }, talk);
    const user = userEvent.setup();
    const [first, second, third] = screen.getAllByRole("article");
    expect(within(third!).queryAllByRole("button")).toHaveLength(0);
    expect(first?.textContent).toContain("· edited");
    expect(within(first!).getByText("0 reactions, can react")).toBeTruthy();
    // A review's words can be edited, not deleted; with none, nothing to quote or react to.
    expect(within(second!).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(second!).queryByRole("button", { name: "Quote reply" })).toBeNull();
    expect(within(second!).queryByRole("button", { name: "React" })).toBeNull();

    await user.click(within(first!).getByRole("button", { name: "Delete" }));
    expect(talk.deleteEntry).toHaveBeenCalledWith("C1");

    await user.click(within(first!).getByRole("button", { name: "Edit" }));
    await user.click(within(first!).getByRole("button", { name: "Cancel" }));
    await user.click(within(first!).getByRole("button", { name: "Edit" }));
    expect(within(first!).getByRole("group").textContent).toContain("Said C1");
    await user.click(within(first!).getByRole("button", { name: "Send" }));
    expect(talk.editEntry).toHaveBeenCalledWith("comment", "C1", "Written");
    expect(within(first!).queryByRole("group")).toBeNull();

    // Editing a review that said nothing of its own still shows its box.
    await user.click(within(second!).getByRole("button", { name: "Edit" }));
    expect(within(second!).getByRole("group")).toBeTruthy();

    await user.click(within(first!).getByRole("button", { name: "Quote reply" }));
    const box = screen.getByRole("group", { name: "Comment on this pull request" });
    expect(box.querySelector("pre")?.textContent).toBe("> Said C1\n\n");
    await user.click(within(box).getByRole("button", { name: "Send" }));
    expect(p.onComment).toHaveBeenCalledWith("Written");
    expect(screen.getByRole("button", { name: "Add Comment" })).toBeTruthy();
  });

  it("shows the newest first and older ones a page at a time", async () => {
    const entries = Array.from({ length: 31 }, (_, i) => comment(`C${i}`, i));
    show({ conversation: conversation(entries) });
    const user = userEvent.setup();
    expect(screen.getAllByRole("article")).toHaveLength(30);
    await user.click(screen.getByRole("button", { name: "Show 1 older" }));
    expect(screen.getAllByRole("article")).toHaveLength(31);
  });

  it("asks for older activity, and says why it couldn't come", async () => {
    const loadOlder = vi
      .fn<() => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new Error("Offline"))
      .mockRejectedValueOnce("Gone");
    const p = show({ pull: pullWith({ older: "cursor", loadOlder }) });
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Show Older Activity" });
    await user.click(button);
    await user.click(button);
    await user.click(button);
    expect(loadOlder).toHaveBeenCalledTimes(3);
    expect(p.say).toHaveBeenCalledWith("Offline");
    expect(p.say).toHaveBeenCalledWith("Gone");
  });
});

describe("adding a comment", () => {
  it("opens the box when asked and closes it on cancel", async () => {
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Comment" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Add Comment" })).toBeTruthy();
  });

  it("shows the conversation's top when GitHub doesn't say where the comment is", async () => {
    const p = show();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Comment" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(p.onComment).toHaveBeenCalledWith("Written");
    expect(scrolled.mock.contexts).toEqual([screen.getByRole("heading", { name: /Conversation/u })]);
    expect(lit).not.toHaveBeenCalled();
  });

  it("waits a few seconds for the new comment to arrive, then gives up", async () => {
    vi.useFakeTimers();
    const onComment = vi.fn<Props["onComment"]>(() => Promise.resolve("C_later"));
    const p = show({ onComment });
    fireEvent.click(screen.getByRole("button", { name: "Add Comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await act(() => Promise.resolve());
    expect(scrolled.mock.contexts).toEqual([screen.getByRole("heading", { name: /Conversation/u })]);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    p.again({ onComment, conversation: conversation([comment("C_later", 0)]) });
    expect(lit).not.toHaveBeenCalled();
  });

  it("lights up the new comment once it's there, only once", async () => {
    const onComment = vi.fn<Props["onComment"]>(() => Promise.resolve("C_new"));
    const p = show({ conversation: conversation([comment("C1", 10)]), onComment });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Comment" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(lit).not.toHaveBeenCalled();

    const arrived = conversation([comment("C_new", 0), comment("C1", 10)]);
    p.again({ conversation: arrived, onComment });
    const article = screen.getAllByRole("article")[0];
    expect(scrolled).toHaveBeenLastCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(lit.mock.contexts).toEqual([article]);
    expect(lit.mock.calls[0]?.[1]).toMatchObject({ delay: 300 });

    p.again({ conversation: { ...arrived, entries: [...arrived.entries] }, onComment });
    expect(lit).toHaveBeenCalledTimes(1);
  });

  it("doesn't move with reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query }));
    const onComment = vi.fn<Props["onComment"]>(() => Promise.resolve("C1"));
    show({ conversation: conversation([comment("C1", 10)]), onComment });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add Comment" }));
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(scrolled).toHaveBeenLastCalledWith({ behavior: "auto", block: "center" });
    expect(lit.mock.calls[0]?.[1]).toMatchObject({ delay: 0 });
  });
});

const finding = (path: string, line: number, inDiff: boolean): Finding => ({
  path,
  line,
  severity: "issue",
  body: `About ${path}:${line}`,
  inDiff,
});
const review = (extra: Partial<AiReview> = {}): AiReview => ({
  summary: "",
  findings: [],
  project: false,
  at: 0,
  ...extra,
});

describe("at a glance", () => {
  const claude: Config = { ...defaultConfig(), ai: { ...defaultConfig().ai, provider: "claude", project: false } };

  it("has no AI parts without a configuration", () => {
    show();
    expect(screen.queryByText("Ask AI")).toBeNull();
    expect(screen.getByText("Sidebar")).toBeTruthy();
  });

  it("has no AI review without a provider, nor before one's asked for", () => {
    const { again } = show({ config: defaultConfig() });
    expect(screen.getByText("Ask AI")).toBeTruthy();
    again({ config: claude });
    expect(screen.queryByRole("heading", { name: /AI review/u })).toBeNull();
  });

  it("says what it's reading while it reviews", () => {
    const { again } = show({ config: claude, reviewing: true });
    expect(screen.getByRole("heading", { name: /AI review/u }).textContent).toContain("by Claude Code");
    expect(screen.getByLabelText("Reviewing")).toBeTruthy();
    expect(screen.getByText("Reading the diff…")).toBeTruthy();
    again({ config: { ...claude, ai: { ...claude.ai, project: true } } });
    expect(screen.getByText(/Reading the project and the diff/u)).toBeTruthy();
  });

  it("says why it couldn't review", () => {
    show({ config: claude, reviewError: "Not signed in" });
    expect(screen.getByRole("alert").textContent).toContain("Not signed in");
  });

  it("sums up the review, with the comments that aren't on the diff's lines", async () => {
    const p = show({
      config: claude,
      review: review({
        summary: "Looks fine.",
        findings: [finding("src/cart.ts", 3, true), finding("src/promo.ts", 40, false)],
        note: "Only the diff",
      }),
    });
    expect(screen.getByText("Looks fine.")).toBeTruthy();
    expect(screen.getByText("1 comment on the diff, 1 elsewhere. Only the diff.")).toBeTruthy();
    expect(screen.getByText("About src/promo.ts:40")).toBeTruthy();
    expect(screen.queryByText("About src/cart.ts:3")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Show src/promo.ts in the diff" }));
    expect(p.onJump).toHaveBeenCalledWith("src/promo.ts", null);
  });

  it("counts the comments on the diff, or says there was nothing", () => {
    const { again } = show({
      config: claude,
      review: review({ findings: [finding("a", 1, true), finding("b", 2, true)] }),
    });
    expect(screen.getByText("2 comments on the diff.")).toBeTruthy();
    again({ config: claude, review: review({ project: true }) });
    expect(screen.getByText("Nothing worth raising. Read the whole project.")).toBeTruthy();
  });
});
