import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { ConversationProvider, type ConversationApi } from "../../hooks/use-conversation/use-conversation";
import type { Applied } from "../../utils/commit/commit";
import { fakeConversation } from "../../utils/mock-pull/mock-pull";
import { later } from "../../utils/mock-render/mock-render";
import type { Thread, ThreadComment } from "../../utils/review/review";
import { SuggestionActions, SuggestionBatch } from "./suggestion";

const SUGGESTION = "Try this:\n```suggestion\nconst total = 2;\n```";

const comment = (extra: Partial<ThreadComment> = {}): ThreadComment => ({
  id: "C_1",
  databaseId: 1,
  author: { login: "octocat", name: "Ana Lima" },
  authorId: 583231,
  html: "",
  at: "2026-10-20T10:00:00Z",
  url: "https://github.com/acme/shop/pull/42#discussion_r1",
  body: SUGGESTION,
  ...extra,
});

const thread = (extra: Partial<Thread> = {}): Thread => ({
  id: "T_1",
  path: "src/cart.ts",
  side: "additions",
  line: 12,
  resolved: false,
  outdated: false,
  comments: [],
  ...extra,
});

const applied: Applied = {
  thread: "T_1",
  comment: "C_1",
  path: "src/cart.ts",
  start: 12,
  end: 12,
  lines: ["const total = 2;"],
  author: { login: "octocat", name: "Ana Lima", databaseId: 583231 },
};

const withApi = (api: ConversationApi | null) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <ConversationProvider value={api}>{children}</ConversationProvider>;
  };

const pushing = (extra: Partial<ConversationApi> = {}) => fakeConversation({ canApplySuggestion: true, ...extra });

function actions(t: Thread, c: ThreadComment, api: ConversationApi | null = pushing()) {
  render(<SuggestionActions thread={t} comment={c} />, { wrapper: withApi(api) });
  return api;
}

const button = (name: string) => screen.getByRole("button", { name });

describe("SuggestionActions", () => {
  it("offers nothing where suggestions can't be committed, or there's none", () => {
    const t = thread();
    const { container } = render(<SuggestionActions thread={t} comment={comment()} />);
    actions(t, comment(), fakeConversation());
    actions(t, comment({ body: undefined }));
    actions(t, comment({ body: "Looks good" }));
    expect(container.textContent).toBe("");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it.each([
    ["pending", thread(), comment({ pending: true }), "Suggestions can be committed once the review is sent."],
    ["resolved", thread({ resolved: true }), comment(), "This suggestion is resolved."],
    ["outdated", thread({ outdated: true }), comment(), "Outdated suggestions can't be committed."],
    ["on the file", thread({ line: 0 }), comment(), "Outdated suggestions can't be committed."],
    ["deleted", thread({ side: "deletions" }), comment(), "A suggestion on removed lines can't be committed."],
    [
      "several",
      thread(),
      comment({ body: `${SUGGESTION}\n${SUGGESTION}` }),
      "A comment with several suggestions can't be committed from here.",
    ],
  ])("says why a suggestion %s can't be committed", (_, t, c, why) => {
    actions(t, c);
    expect(screen.getByText(why)).toBeTruthy();
  });

  it("commits a suggestion with the message written", async () => {
    const api = actions(thread(), comment());
    await userEvent.click(button("Commit Suggestion"));
    expect(screen.getByRole("textbox", { name: "Commit message" }).getAttribute("placeholder")).toBe("Update cart.ts");
    expect(screen.getByText("Commits to promo-keep, crediting the suggestions' authors.")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: "Commit message" }), "Fix the total");
    await userEvent.type(screen.getByRole("textbox", { name: "Extended description (optional)" }), "Because");
    await userEvent.click(button("Commit Changes"));
    expect(api?.commit).toHaveBeenCalledWith([applied], "Fix the total", "Because");
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: "Commit message" })).toBeNull();
    });
    await userEvent.click(button("Commit Suggestion"));
    expect(screen.getByRole("textbox", { name: "Commit message" })).toHaveProperty("value", "");
  });

  it("commits with Return, across several lines, crediting whoever wrote it", async () => {
    const api = actions(thread({ startLine: 10 }), comment({ author: null, authorId: undefined }));
    await userEvent.click(button("Commit Suggestion"));
    await userEvent.type(screen.getByRole("textbox", { name: "Commit message" }), "Fix{Enter}");
    expect(api?.commit).toHaveBeenCalledWith(
      [{ ...applied, start: 10, author: { login: "", name: undefined, databaseId: undefined } }],
      "Fix",
      "",
    );
  });

  it("says why GitHub refused, and lets it be tried again", async () => {
    const held = later();
    const commit = vi
      .fn<ConversationApi["commit"]>()
      .mockRejectedValueOnce(new Error("Branch moved"))
      .mockRejectedValueOnce("Conflict")
      .mockReturnValueOnce(held.promise);
    actions(thread(), comment(), pushing({ commit }));
    await userEvent.click(button("Commit Suggestion"));
    await userEvent.click(button("Commit Changes"));
    expect((await screen.findByRole("alert")).textContent).toBe("Branch moved");
    await userEvent.click(button("Commit Changes"));
    expect((await screen.findByRole("alert")).textContent).toBe("Conflict");
    await userEvent.click(button("Commit Changes"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(button("Commit Changes").hasAttribute("disabled")).toBe(true);
    held.settle();
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Commit Changes" })).toBeNull();
    });
  });

  it("gathers it in the batch", async () => {
    const api = actions(thread(), comment());
    await userEvent.click(button("Add to Batch"));
    expect(api?.toggleBatch).toHaveBeenCalledWith(applied);
  });

  it("once in the batch, offers to take it out or commit the batch", async () => {
    const other = { ...applied, comment: "C_2" };
    const api = actions(thread(), comment(), pushing({ batch: [other, applied] }));
    expect(screen.queryByRole("button", { name: "Commit Suggestion" })).toBeNull();
    await userEvent.click(button("Remove from Batch"));
    expect(api?.toggleBatch).toHaveBeenCalledWith(applied);
    await userEvent.click(button("Commit 2 Suggestions"));
    expect(screen.getByRole("textbox", { name: "Commit message" }).getAttribute("placeholder")).toBe(
      "Apply suggestions from code review",
    );
    await userEvent.click(button("Commit Changes"));
    expect(api?.commit).toHaveBeenCalledWith([other, applied], "", "");
  });

  it("follows the batch as it changes", () => {
    const t = thread();
    const c = comment();
    const view = (api: ConversationApi) => (
      <ConversationProvider value={api}>
        <SuggestionActions thread={t} comment={c} />
      </ConversationProvider>
    );
    const { rerender } = render(view(pushing()));
    expect(button("Add to Batch")).toBeTruthy();
    rerender(view(pushing({ batch: [applied] })));
    expect(button("Remove from Batch")).toBeTruthy();
  });
});

describe("SuggestionBatch", () => {
  it("shows nothing while the batch is empty, or outside a review window", () => {
    const { container } = render(<SuggestionBatch />);
    render(<SuggestionBatch />, { wrapper: withApi(pushing()), container });
    expect(container.textContent).toBe("");
  });

  it("commits the batch, or empties it", async () => {
    const api = pushing({ batch: [applied] });
    render(<SuggestionBatch />, { wrapper: withApi(api) });
    const batch = screen.getByRole("region", { name: "Suggestions to commit" });
    expect(batch.textContent).toContain("1 suggestion in batch");
    await userEvent.click(button("Empty the batch"));
    expect(api.clearBatch).toHaveBeenCalled();
    await userEvent.click(button("Commit 1 Suggestion"));
    expect(screen.getByRole("dialog", { name: "Commit Suggestion" })).toBeTruthy();
  });
});
