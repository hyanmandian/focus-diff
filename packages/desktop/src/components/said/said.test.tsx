import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { CommentMenu, ReactionList, ReactionPicker, useReactions } from "@/components/said/said";
import { ConversationProvider, type ConversationApi } from "@/hooks/use-conversation/use-conversation";
import type { Reaction, ReactionContent } from "@/utils/comments/comments";
import { fakeConversation } from "@/utils/mock-pull/mock-pull";
import { later } from "@/utils/mock-render/mock-render";

type React = ConversationApi["react"];

const conversation = (react?: React) => fakeConversation(react ? { react } : {});

const withApi = (api: ConversationApi | null) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <ConversationProvider value={api}>{children}</ConversationProvider>;
  };

const thumbs: Reaction = { content: "THUMBS_UP", count: 3, mine: false, who: ["octocat"] };
const heart: Reaction = { content: "HEART", count: 1, mine: true, who: ["mona"] };

function Reactions({ given }: { given: Reaction[] }) {
  const [reactions, toggle] = useReactions("C_1", given);
  return (
    <>
      <ReactionList reactions={reactions} canReact onToggle={toggle} />
      <ReactionPicker reactions={reactions} onToggle={toggle} />
    </>
  );
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
