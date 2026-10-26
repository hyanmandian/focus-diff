import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { CommentMenu, ReactionList, ReactionPicker, useReactions } from "@/components/said/said";
import { ConversationProvider, type ConversationApi } from "@/hooks/use-conversation/use-conversation";
import type { Reaction, ReactionContent } from "@/utils/comments/comments";

type React = ConversationApi["react"];

/** A review window's conversation API: what these parts use is spied on, the rest does nothing. */
function conversation(react: React = vi.fn<React>(() => Promise.resolve())): ConversationApi {
  return {
    repo: "acme/app",
    url: "https://github.com/acme/app/pull/7",
    me: "mona",
    people: [],
    canApplySuggestion: false,
    branch: "feature",
    thread: (): undefined => {},
    patchOf: (): undefined => {},
    draft: (): undefined => {},
    draftError: (): undefined => {},
    draftSending: () => false,
    retryDrafts: () => {},
    replyLater: () => {},
    editComment: () => Promise.resolve(),
    deleteComment: () => Promise.resolve(),
    editEntry: () => Promise.resolve(),
    deleteEntry: () => Promise.resolve(),
    editDescription: () => Promise.resolve(),
    react,
    copyLink: vi.fn<(url: string) => void>(),
    batch: [],
    toggleBatch: () => {},
    clearBatch: () => {},
    commit: () => Promise.resolve(),
  };
}

const withApi = (api: ConversationApi | null) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <ConversationProvider value={api}>{children}</ConversationProvider>;
  };

const thumbs: Reaction = { content: "THUMBS_UP", count: 3, mine: false, who: ["octocat"] };
const heart: Reaction = { content: "HEART", count: 1, mine: true, who: ["mona"] };

/** A comment's reactions, as a comment shows them. */
function Reactions({ given }: { given: Reaction[] }) {
  const [reactions, toggle] = useReactions("C_1", given);
  return (
    <>
      <ReactionList reactions={reactions} canReact onToggle={toggle} />
      <ReactionPicker reactions={reactions} onToggle={toggle} />
    </>
  );
}

/** A promise that settles when the test says. */
function later() {
  const settle: Array<() => void> = [];
  const promise = new Promise<void>((resolve) => {
    settle.push(resolve);
  });
  return {
    promise,
    settle: () => {
      settle[0]!();
    },
  };
}

const open = () => userEvent.click(screen.getByRole("button", { name: "More for this comment" }));

const capsule = (name: string | RegExp) => screen.getByRole("button", { name });

describe("ReactionList", () => {
  it("shows each reaction with its count and who gave it", () => {
    render(<ReactionList reactions={[thumbs, heart]} canReact onToggle={() => {}} />);
    expect(screen.getByRole("list", { name: "Reactions" })).toBeTruthy();
    const first = capsule("octocat and 2 others reacted with Thumbs up");
    expect(first.textContent).toBe("👍 3");
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(capsule("mona reacted with Heart").getAttribute("aria-pressed")).toBe("true");
  });

  it("shows nothing when nobody reacted", () => {
    const { container } = render(<ReactionList reactions={[]} canReact onToggle={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("can't be clicked where you can't react", () => {
    render(<ReactionList reactions={[heart]} canReact={false} onToggle={() => {}} />);
    expect(capsule(/Heart/u).hasAttribute("disabled")).toBe(true);
  });

  it("toggles a reaction when clicked", async () => {
    const onToggle = vi.fn<(content: ReactionContent) => void>();
    render(<ReactionList reactions={[thumbs]} canReact onToggle={onToggle} />);
    await userEvent.click(capsule(/Thumbs up/u));
    expect(onToggle).toHaveBeenCalledWith("THUMBS_UP");
  });
});

describe("ReactionPicker", () => {
  it("offers GitHub's eight reactions, yours pressed, and closes after one", async () => {
    const onToggle = vi.fn<(content: ReactionContent) => void>();
    render(<ReactionPicker reactions={[heart, thumbs]} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    expect(screen.getByRole("button", { name: "Heart" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Thumbs up" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "Eyes" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Rocket" }));
    expect(onToggle).toHaveBeenCalledWith("ROCKET");
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Eyes" })).toBeNull();
    });
  });
});

describe("useReactions", () => {
  it("shows yours at once and tells GitHub", async () => {
    const api = conversation();
    render(<Reactions given={[thumbs]} />, { wrapper: withApi(api) });
    await userEvent.click(capsule(/Thumbs up/u));
    expect(api.react).toHaveBeenCalledWith("C_1", "THUMBS_UP", true, [
      { ...thumbs, count: 4, mine: true, who: ["mona", "octocat"] },
    ]);
  });

  it("takes yours back, then follows GitHub's copy again", async () => {
    const held = later();
    const api = conversation(vi.fn<React>(() => held.promise));
    render(<Reactions given={[heart]} />, { wrapper: withApi(api) });
    await userEvent.click(capsule(/Heart/u));
    expect(api.react).toHaveBeenCalledWith("C_1", "HEART", false, []);
    expect(screen.queryByRole("list")).toBeNull();
    held.settle();
    expect(await screen.findByRole("button", { name: /Heart/u })).toBeTruthy();
  });

  it("puts it back when GitHub refuses", async () => {
    const api = conversation(vi.fn<React>(() => Promise.reject(new Error("nope"))));
    render(<Reactions given={[thumbs]} />, { wrapper: withApi(api) });
    await userEvent.click(capsule(/Thumbs up/u));
    await waitFor(() => {
      expect(capsule(/Thumbs up/u).textContent).toBe("👍 3");
    });
  });

  it("does nothing outside a review window", async () => {
    render(<Reactions given={[thumbs]} />);
    await userEvent.click(capsule(/Thumbs up/u));
    expect(capsule(/Thumbs up/u).textContent).toBe("👍 3");
  });
});

describe("CommentMenu", () => {
  it("copies a link to the comment", async () => {
    const api = conversation();
    render(<CommentMenu url="https://github.com/acme/app/pull/7#c1" />, { wrapper: withApi(api) });
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    expect(api.copyLink).toHaveBeenCalledWith("https://github.com/acme/app/pull/7#c1");
    expect(screen.queryByRole("menuitem", { name: "Quote Reply" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("offers to quote, edit and delete when it may", async () => {
    const onQuote = vi.fn<() => void>();
    const onEdit = vi.fn<() => void>();
    const onDelete = vi.fn<() => void>();
    render(<CommentMenu url="u" onQuote={onQuote} onEdit={onEdit} onDelete={onDelete} />);
    await open();
    expect(screen.getByRole("separator")).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Quote Reply" }));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect([onQuote, onEdit, onDelete].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it("offers delete alone for a comment you may only delete, and copying does nothing outside a review window", async () => {
    render(<CommentMenu url="u" onDelete={() => {}} />);
    await open();
    expect(screen.getByRole("separator")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("re-rendered", () => {
  it("keeps the reactions as they are, and follows what changes", async () => {
    const api = conversation();
    const given = [thumbs];
    const { rerender } = render(<Reactions given={given} />, { wrapper: withApi(api) });
    rerender(<Reactions given={given} />);
    expect(capsule(/Thumbs up/u).textContent).toBe("👍 3");
    rerender(<Reactions given={[heart]} />);
    expect(capsule(/Heart/u)).toBeTruthy();

    const first = vi.fn<(content: ReactionContent) => void>();
    const last = vi.fn<(content: ReactionContent) => void>();
    const list = render(<ReactionList reactions={given} canReact onToggle={first} />);
    list.rerender(<ReactionList reactions={given} canReact onToggle={first} />);
    list.rerender(<ReactionList reactions={given} canReact={false} onToggle={first} />);
    list.rerender(<ReactionList reactions={given} canReact onToggle={last} />);
    list.rerender(<ReactionList reactions={[{ ...thumbs, count: 5 }]} canReact onToggle={last} />);
    await userEvent.click(within(list.container).getByRole("button", { name: /Thumbs up/u }));
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledWith("THUMBS_UP");
    expect(within(list.container).getByRole("button", { name: /Thumbs up/u }).textContent).toBe("👍 5");
  });

  it("keeps the picker and the menu as they are, and answers whoever holds them last", async () => {
    const first = vi.fn<() => void>();
    const last = vi.fn<() => void>();
    const given = [thumbs];
    const picker = render(<ReactionPicker reactions={given} onToggle={first} />);
    picker.rerender(<ReactionPicker reactions={given} onToggle={first} />);
    picker.rerender(<ReactionPicker reactions={[heart]} onToggle={first} />);
    picker.rerender(<ReactionPicker reactions={[heart]} onToggle={last} />);
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    picker.rerender(<ReactionPicker reactions={[heart]} onToggle={last} />);
    expect(screen.getByRole("button", { name: "Heart" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Eyes" }));
    expect(last).toHaveBeenCalledWith("EYES");
    picker.unmount();
    last.mockClear();

    const api = conversation();
    const menu = render(<CommentMenu url="a" onQuote={first} onEdit={first} onDelete={first} />, {
      wrapper: withApi(api),
    });
    menu.rerender(<CommentMenu url="a" onQuote={first} onEdit={first} onDelete={first} />);
    menu.rerender(<CommentMenu url="b" onQuote={first} onEdit={first} onDelete={first} />);
    menu.rerender(<CommentMenu url="b" onQuote={last} onEdit={first} onDelete={first} />);
    menu.rerender(<CommentMenu url="b" onQuote={last} onEdit={last} onDelete={first} />);
    menu.rerender(<CommentMenu url="b" onQuote={last} onEdit={last} onDelete={last} />);
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy Link" }));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Quote Reply" }));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    await open();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(api.copyLink).toHaveBeenCalledWith("b");
    expect(first).not.toHaveBeenCalled();
    expect(last).toHaveBeenCalledTimes(3);
  });
});
