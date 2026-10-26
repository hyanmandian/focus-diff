import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ConversationProvider, type ConversationApi } from "../../hooks/use-conversation/use-conversation";
import { emit, mockCommands } from "../../utils/fake-platform/fake-platform";
import { emoji, mentionable, preview, referable, savedReplies } from "../../utils/writer/writer";
import { MarkdownField } from "./writer";

// What the box asks GitHub for (utils/writer/writer.ts, tested on its own) is answered here.
vi.mock("../../utils/writer/writer", () => ({
  emoji: vi.fn<typeof emoji>(),
  mentionable: vi.fn<typeof mentionable>(),
  preview: vi.fn<typeof preview>(),
  referable: vi.fn<typeof referable>(),
  savedReplies: vi.fn<typeof savedReplies>(),
}));

// The Mac's ⌘ or everyone else's Ctrl, switched per test (the page itself reads it once).
const platform = vi.hoisted(() => ({ mac: false }));
vi.mock("../../utils/os/os", async (original) => ({
  ...(await original<object>()),
  get isMac() {
    return platform.mac;
  },
}));

const PEOPLE = [
  { login: "ana", name: "Ana Lima", avatarUrl: "https://avatars.githubusercontent.com/u/1" },
  { login: "andre", name: null },
];

function apiFor(url = "https://github.com/acme/app/pull/12"): ConversationApi {
  return {
    repo: "acme/app",
    url,
    me: "you",
    people: PEOPLE,
    canApplySuggestion: false,
    branch: "feature",
    thread: vi.fn<ConversationApi["thread"]>(),
    patchOf: vi.fn<ConversationApi["patchOf"]>(),
    draft: vi.fn<ConversationApi["draft"]>(),
    draftError: vi.fn<ConversationApi["draftError"]>(),
    draftSending: () => false,
    retryDrafts: vi.fn<ConversationApi["retryDrafts"]>(),
    replyLater: vi.fn<ConversationApi["replyLater"]>(),
    editComment: vi.fn<ConversationApi["editComment"]>(),
    deleteComment: vi.fn<ConversationApi["deleteComment"]>(),
    editEntry: vi.fn<ConversationApi["editEntry"]>(),
    deleteEntry: vi.fn<ConversationApi["deleteEntry"]>(),
    editDescription: vi.fn<ConversationApi["editDescription"]>(),
    react: vi.fn<ConversationApi["react"]>(),
    copyLink: vi.fn<ConversationApi["copyLink"]>(),
    batch: [],
    toggleBatch: vi.fn<ConversationApi["toggleBatch"]>(),
    clearBatch: vi.fn<ConversationApi["clearBatch"]>(),
    commit: vi.fn<ConversationApi["commit"]>(),
  };
}

type FieldProps = Partial<Parameters<typeof MarkdownField>[0]> & { api?: ConversationApi | null; initial?: string };

/** The field as a comment box holds it: its text in state, what's sent and cancelled recorded. */
function Field({ api = apiFor(), initial = "", ...props }: FieldProps) {
  const [value, setValue] = useState(initial);
  return (
    <ConversationProvider value={api}>
      <MarkdownField
        value={value}
        onChange={setValue}
        label="Comment"
        placeholder="Leave a comment"
        onSubmit={() => {}}
        onCancel={() => {}}
        {...props}
      />
      <pre data-testid="value">{value}</pre>
    </ConversationProvider>
  );
}

const field = () => screen.getByRole<HTMLTextAreaElement>("combobox", { name: "Comment" });
const valueNow = () => screen.getByTestId("value").textContent;
/** Lets a frame go by: what the field does after drawing (selections, inserted text). */
const nextFrame = () =>
  act(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );

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

/** Something dragged over the field: whether the field takes it. */
function dragOver(types: string[]) {
  const event = new Event("dragover", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types } });
  field().dispatchEvent(event);
  return event.defaultPrevented;
}

/** Files let go over the field. */
const drop = (files: File[]) => fireEvent.drop(field(), { dataTransfer: { files, types: ["Files"] } });

/** The hint under the field, as a screen reader is told it. */
const hint = () => document.querySelector(`#${CSS.escape(field().getAttribute("aria-describedby")!)}`)?.textContent;

/** Rust: who's signed in on github.com, and each upload answered in order. */
function rust({
  session = "you",
  uploads = [],
}: { session?: string | null; uploads?: Array<() => Promise<unknown>> } = {}) {
  const sent: string[] = [];
  mockCommands((cmd) => {
    sent.push(cmd);
    if (cmd === "github_web_session") return session;
    if (cmd === "upload_attachment") return uploads.shift()?.();
    return null;
  });
  return sent;
}

/** execCommand as WebKit has it (happy-dom hasn't): says whether it typed. */
function execCommand(typed: boolean) {
  const run = vi.fn<(command: string, ui?: boolean, value?: string) => boolean>(() => typed);
  Object.defineProperty(document, "execCommand", { configurable: true, value: run });
  return run;
}

const picture = (name = "shot.png", type = "image/png") => new File(["png"], name, { type });

beforeEach(() => {
  vi.resetAllMocks();
  platform.mac = false;
  execCommand(false);
  rust();
});

afterEach(() => {
  // Unmounted before the stand-ins below go.
  cleanup();
  Reflect.deleteProperty(document, "execCommand");
  Reflect.deleteProperty(document, "caretPositionFromPoint");
});

describe("MarkdownField", () => {
  it("takes the focus when it opens, unless told not to", () => {
    const { unmount } = render(<Field />);
    expect(document.activeElement).toBe(field());
    unmount();
    render(<Field autoFocus={false} />);
    expect(document.activeElement).not.toBe(field());
  });

  it("only writes outside a review window: no preview, completions, attachments or saved replies", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(value: string) => void>();
    render(<Field api={null} onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Attach pictures or videos" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Saved Replies" })).toBeNull();
    await user.type(field(), "@an");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(mentionable).not.toHaveBeenCalled();
    // Pasted pictures go nowhere either.
    fireEvent.paste(field(), { clipboardData: { files: [picture()], getData: () => "" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names its shortcuts for screen readers, as the platform writes them", () => {
    const { unmount } = render(<Field />);
    expect(field().getAttribute("aria-describedby")).toBeTruthy();
    expect(hint()).toContain("Ctrl+B");
    unmount();
    platform.mac = true;
    render(<Field />);
    expect(hint()).toContain("⌘B");
  });

  describe("preview", () => {
    it("says there's nothing to preview while it's empty", async () => {
      const user = userEvent.setup();
      render(<Field initial="   " />);
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      expect(screen.getByText("Nothing to preview.")).toBeTruthy();
      expect(preview).not.toHaveBeenCalled();
    });

    it("shows the text as GitHub renders it, loading first", async () => {
      const user = userEvent.setup();
      const rendered = deferred<string>();
      vi.mocked(preview).mockReturnValue(rendered.promise);
      render(<Field initial="**Looks good**" base={["a"]} />);
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      expect(preview).toHaveBeenCalledWith("**Looks good**", "acme/app");
      expect(screen.getByText("Loading preview…")).toBeTruthy();
      expect(screen.getByRole("tabpanel").firstElementChild?.getAttribute("aria-busy")).toBe("true");
      await act(async () => {
        rendered.resolve("<p><strong>Looks good</strong></p>");
        await rendered.promise;
      });
      expect(screen.getByText("Looks good").tagName).toBe("STRONG");
      // Back to writing, where the text is as it was.
      await user.click(screen.getByRole("tab", { name: "Write" }));
      expect(field().value).toBe("**Looks good**");
    });

    it("says why GitHub couldn't render it", async () => {
      const user = userEvent.setup();
      vi.mocked(preview).mockRejectedValueOnce(new Error("Bad credentials")).mockRejectedValueOnce("offline");
      const { unmount } = render(<Field initial="Hi" />);
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Bad credentials");
      unmount();
      render(<Field initial="Hello" />);
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      expect((await screen.findByRole("alert")).textContent).toBe("offline");
    });

    it("drops an answer that comes after the preview was left", async () => {
      const user = userEvent.setup();
      const late = deferred<string>();
      const failed = deferred<string>();
      vi.mocked(preview)
        .mockReturnValue(new Promise(() => {}))
        .mockReturnValueOnce(late.promise)
        .mockReturnValueOnce(failed.promise);
      render(<Field initial="Hi" />);
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      await user.click(screen.getByRole("tab", { name: "Write" }));
      await act(async () => {
        late.resolve("<p>Hi</p>");
        await late.promise;
      });
      await user.type(field(), "!");
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      await user.click(screen.getByRole("tab", { name: "Write" }));
      await act(async () => {
        failed.reject(new Error("too late"));
        await failed.promise.catch(() => {});
      });
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      expect(screen.getByText("Loading preview…")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("completions", () => {
    it("offers the pull request's people at once, then the repository's, and picks with Enter", async () => {
      const user = userEvent.setup();
      const more = deferred<Array<{ login: string; name?: string | null }>>();
      vi.mocked(mentionable).mockReturnValue(more.promise);
      render(<Field initial="Thanks " />);
      await user.click(field());
      await user.keyboard("{End}@an");
      const list = screen.getByRole("listbox", { name: "People to mention" });
      expect(list.textContent).toContain("Ana Lima");
      expect(field().getAttribute("aria-expanded")).toBe("true");
      await act(async () => {
        more.resolve([{ login: "anabel", name: "Anabel" }]);
        await more.promise;
      });
      expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
        "ANanaAna Lima",
        "ANandre",
        "ANanabelAnabel",
      ]);
      // Round the list both ways.
      await user.keyboard("{ArrowUp}");
      expect(screen.getAllByRole("option")[2]?.getAttribute("aria-selected")).toBe("true");
      await user.keyboard("{ArrowDown}{ArrowDown}");
      expect(field().getAttribute("aria-activedescendant")).toBe(screen.getAllByRole("option")[1]?.id);
      await user.keyboard("{Enter}");
      await nextFrame();
      expect(valueNow()).toBe("Thanks @andre ");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("picks with Tab or a click, and the pointer moves the choice", async () => {
      const user = userEvent.setup();
      vi.mocked(mentionable).mockResolvedValue([]);
      render(<Field />);
      await user.type(field(), "@an");
      await user.keyboard("{Tab}");
      await nextFrame();
      expect(valueNow()).toBe("@ana ");
      await user.type(field(), "@and");
      const andre = await screen.findByRole("option", { name: /andre/u });
      await user.hover(andre);
      expect(andre.getAttribute("aria-selected")).toBe("true");
      await user.click(andre);
      await nextFrame();
      expect(valueNow()).toBe("@ana @andre ");
    });

    it("types the completion the way ⌘Z can undo, when the web view can", async () => {
      const user = userEvent.setup();
      const run = execCommand(true);
      vi.mocked(mentionable).mockResolvedValue([]);
      render(<Field />);
      await user.type(field(), "@an");
      await user.keyboard("{Enter}");
      expect(run).toHaveBeenCalledWith("insertText", false, "@ana ");
      // The browser typed it: nothing else changes the text.
      expect(valueNow()).toBe("@an");
    });

    it("still offers the pull request's people when the repository's can't be had", async () => {
      const user = userEvent.setup();
      vi.mocked(mentionable).mockRejectedValue(new Error("offline"));
      render(<Field />);
      await user.type(field(), "@");
      await waitFor(() => {
        expect(screen.getAllByRole("option")).toHaveLength(2);
      });
    });

    it("keeps only the answer to what was typed last", async () => {
      const user = userEvent.setup();
      const first = deferred<Array<{ login: string }>>();
      vi.mocked(mentionable).mockReturnValueOnce(first.promise).mockResolvedValueOnce([]);
      render(<Field />);
      await user.type(field(), "@a");
      await user.type(field(), "n");
      await act(async () => {
        first.resolve([{ login: "albert" }]);
        await first.promise;
      });
      expect(screen.queryByRole("option", { name: /albert/u })).toBeNull();
    });

    it("does nothing with Enter when the choice is gone from a shorter list", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn<() => void>();
      vi.mocked(mentionable)
        .mockResolvedValueOnce([])
        .mockReturnValue(new Promise(() => {}));
      render(<Field onSubmit={onSubmit} />);
      await user.type(field(), "@");
      await screen.findAllByRole("option");
      await user.keyboard("{ArrowDown}");
      await user.type(field(), "ana");
      await user.keyboard("{Enter}");
      expect(valueNow()).toBe("@ana");
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it("offers emoji by name, and none when GitHub's list can't be had", async () => {
      const user = userEvent.setup();
      vi.mocked(emoji)
        .mockResolvedValueOnce([
          { name: "smile", char: "😄" },
          { name: "smirk", char: "😏" },
        ])
        .mockRejectedValueOnce(new Error("offline"));
      render(<Field />);
      await user.type(field(), ":sm");
      const list = await screen.findByRole("listbox", { name: "Emoji" });
      expect(list.textContent).toContain(":smile:");
      await user.keyboard("{Enter}");
      await nextFrame();
      expect(valueNow()).toBe(":smile: ");
      await user.type(field(), ":sm");
      await act(async () => {});
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("offers issues and pull requests for a #, and none when they can't be had", async () => {
      const user = userEvent.setup();
      vi.mocked(referable)
        .mockResolvedValueOnce([
          { number: 12, title: "Fix the cart", kind: "pull", state: "OPEN" },
          { number: 7, title: "Cart forgets the code", kind: "issue", state: "OPEN" },
        ])
        .mockRejectedValueOnce(new Error("offline"));
      render(<Field />);
      await user.type(field(), "#");
      const list = await screen.findByRole("listbox", { name: "Issues and pull requests" });
      expect(list.textContent).toContain("#12Fix the cart");
      expect(list.textContent).toContain("#7Cart forgets the code");
      await user.keyboard("{ArrowDown}{Enter}");
      await nextFrame();
      expect(valueNow()).toBe("#7 ");
      await user.type(field(), "#");
      await act(async () => {});
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("closes with Escape without cancelling the comment, and when the caret leaves", async () => {
      const user = userEvent.setup();
      const onCancel = vi.fn<() => void>();
      vi.mocked(mentionable).mockResolvedValue([]);
      render(<Field onCancel={onCancel} initial="x " />);
      await user.click(field());
      await user.keyboard("{End}@an");
      expect(screen.getByRole("listbox")).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onCancel).not.toHaveBeenCalled();

      // Moving within what's being completed keeps it; moving off it closes it.
      await user.keyboard("{Backspace}");
      expect(screen.getByRole("listbox")).toBeTruthy();
      fireEvent.select(field());
      expect(screen.getByRole("listbox")).toBeTruthy();
      field().setSelectionRange(0, 0);
      fireEvent.select(field());
      expect(screen.queryByRole("listbox")).toBeNull();
      fireEvent.select(field());

      // Leaving the field closes it too.
      await user.keyboard("{End}{Backspace}");
      expect(screen.getByRole("listbox")).toBeTruthy();
      fireEvent.blur(field());
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("lets other keys through while the list is open", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn<() => void>();
      vi.mocked(mentionable).mockResolvedValue([]);
      render(<Field onSubmit={onSubmit} />);
      await user.type(field(), "@an");
      await user.keyboard("{Control>}{Enter}{/Control}");
      expect(onSubmit).toHaveBeenCalledOnce();
    });

    it("keeps the list inside a narrow field", async () => {
      const user = userEvent.setup();
      vi.mocked(mentionable).mockResolvedValue([]);
      render(<Field />);
      Object.defineProperty(field(), "clientWidth", { configurable: true, value: 300 });
      await user.type(field(), "@a");
      expect(screen.getByRole("listbox").style.left).toBe("0px");
    });
  });

  describe("keys", () => {
    it("sends with Ctrl+Enter (⌘↩ on the Mac) and cancels with Escape", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn<() => void>();
      const onCancel = vi.fn<() => void>();
      const { unmount } = render(<Field onSubmit={onSubmit} onCancel={onCancel} />);
      await user.keyboard("{Control>}{Enter}{/Control}");
      await user.keyboard("{Meta>}{Enter}{/Meta}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
      await user.keyboard("{Escape}");
      expect(onCancel).toHaveBeenCalledOnce();
      await user.keyboard("{Enter}");
      expect(onSubmit).toHaveBeenCalledTimes(2);
      unmount();

      platform.mac = true;
      render(<Field initial="bold" />);
      field().setSelectionRange(0, 4);
      await user.keyboard("{Control>}b{/Control}");
      expect(valueNow()).toBe("bold");
      await user.keyboard("{Meta>}b{/Meta}");
      expect(valueNow()).toBe("**bold**");
    });

    it("wraps the selection in bold, italic or code, and makes it a link", async () => {
      const user = userEvent.setup();
      render(<Field initial="word" />);
      const wrapWith = async (key: string) => {
        field().setSelectionRange(0, field().value.length);
        await user.keyboard(`{Control>}${key}{/Control}`);
        await nextFrame();
      };
      await wrapWith("b");
      expect(valueNow()).toBe("**word**");
      await wrapWith("b");
      expect(valueNow()).toBe("word");
      await wrapWith("i");
      expect(valueNow()).toBe("_word_");
      await wrapWith("i");
      await wrapWith("E");
      expect(valueNow()).toBe("`word`");
      await wrapWith("e");
      await wrapWith("k");
      expect(valueNow()).toBe("[word]()");
      expect(field().selectionStart).toBe(7);
      // Not with Shift or Option: those are other shortcuts.
      await user.keyboard(
        "{Control>}{Shift>}b{/Shift}{/Control}{Control>}{Alt>}b{/Alt}{/Control}{Control>}x{/Control}",
      );
      expect(valueNow()).toBe("[word]()");
    });

    it("takes out an empty pair of markers the way ⌘Z can undo", async () => {
      const user = userEvent.setup();
      const run = execCommand(true);
      render(<Field initial="****" />);
      field().setSelectionRange(0, 4);
      await user.keyboard("{Control>}b{/Control}");
      expect(run).toHaveBeenCalledWith("delete");
    });
  });

  describe("pasting", () => {
    it("makes words a link when an address is pasted over them", async () => {
      render(<Field initial="the docs here" />);
      field().setSelectionRange(4, 8);
      fireEvent.paste(field(), { clipboardData: { files: [], getData: () => " https://example.com/docs " } });
      await nextFrame();
      expect(valueNow()).toBe("the [docs](https://example.com/docs) here");
    });

    it("pastes as it is with nothing selected, over an address, or when it isn't one", async () => {
      render(<Field initial="see https://a.example" />);
      const paste = (text: string) => {
        fireEvent.paste(field(), { clipboardData: { files: [], getData: () => text } });
      };
      field().setSelectionRange(3, 3);
      paste("https://example.com");
      field().setSelectionRange(4, 21);
      paste("https://example.com");
      field().setSelectionRange(0, 3);
      paste("not a link");
      await nextFrame();
      expect(valueNow()).toBe("see https://a.example");
    });
  });

  describe("attachments", () => {
    it("uploads a picture as github.com does, a placeholder in its place until it's there", async () => {
      const user = userEvent.setup();
      const upload = deferred<unknown>();
      rust({ uploads: [() => upload.promise] });
      render(<Field initial="Before" />);
      await act(async () => {});
      field().setSelectionRange(6, 6);
      fireEvent.paste(field(), { clipboardData: { files: [picture()], getData: () => "" } });
      await nextFrame();
      expect(valueNow()).toBe("Before\n![Uploading shot.png…]()\n");
      // The caret where it was: the whole text selected, its end moves with the swap.
      field().focus();
      field().setSelectionRange(0, field().value.length);
      await act(async () => {
        upload.resolve({ href: "https://github.com/user-attachments/assets/1", kind: "image" });
        await upload.promise;
      });
      await nextFrame();
      expect(valueNow()).toBe("Before\n![shot](https://github.com/user-attachments/assets/1)\n");
      expect([field().selectionStart, field().selectionEnd]).toEqual([0, field().value.length]);
      expect(screen.queryByRole("alert")).toBeNull();
      await user.click(field());
    });

    it("picks files from the attach button, and drops them where they're let go", async () => {
      const user = userEvent.setup();
      const uploads = [2, 3, 4].map(() => deferred<unknown>());
      const sent = rust({ uploads: uploads.map((u) => () => u.promise) });
      /** The next upload done, once its placeholder is in. */
      const uploaded = async (n: number) => {
        await nextFrame();
        await act(async () => {
          uploads[n - 2]!.resolve({ href: `https://github.com/user-attachments/assets/${n}`, kind: "video" });
          await uploads[n - 2]!.promise;
        });
      };
      const { container } = render(<Field initial="ab" />);
      await act(async () => {});
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      const clicked = vi.spyOn(input, "click");
      await user.click(screen.getByRole("button", { name: "Attach pictures or videos" }));
      expect(clicked).toHaveBeenCalledOnce();
      await user.upload(input, new File(["mp4"], "demo.mp4", { type: "video/mp4" }));
      await uploaded(2);
      expect(valueNow()).toBe("ab\nhttps://github.com/user-attachments/assets/2\n");
      expect(input.value).toBe("");

      // Dragged over: only files are taken.
      expect(dragOver(["Files"])).toBe(true);
      expect(dragOver(["text/plain"])).toBe(false);

      // Dropped: at the point under the pointer, when the web view says where that is.
      drop([]);
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true,
        value: () => ({ offsetNode: field(), offset: 0 }),
      });
      drop([new File(["mp4"], "first.mp4", { type: "video/mp4" })]);
      await uploaded(3);
      expect(valueNow()?.startsWith("https://github.com/user-attachments/assets/3\n")).toBe(true);
      Object.defineProperty(document, "caretPositionFromPoint", {
        configurable: true,
        value: () => ({ offsetNode: document.body, offset: 0 }),
      });
      drop([new File(["mp4"], "other.mp4", { type: "video/mp4" })]);
      await uploaded(4);
      expect(valueNow()).toContain("https://github.com/user-attachments/assets/4");
      expect(sent.filter((c) => c === "upload_attachment")).toHaveLength(3);
    });

    it("says what GitHub doesn't take, and still uploads the rest", async () => {
      const upload = deferred<unknown>();
      rust({ uploads: [() => upload.promise] });
      render(<Field />);
      await act(async () => {});
      fireEvent.paste(field(), {
        clipboardData: { files: [new File(["x"], "notes.txt", { type: "text/plain" })], getData: () => "" },
      });
      expect(screen.getByRole("alert").textContent).toContain("GitHub takes PNG");
      fireEvent.paste(field(), {
        clipboardData: { files: [new File(["x"], "notes.txt", { type: "text/plain" }), picture()], getData: () => "" },
      });
      await nextFrame();
      expect(valueNow()).toContain("Uploading shot.png");
      expect(screen.getByRole("alert").textContent).toContain("GitHub takes PNG");
    });

    it("asks to sign in to github.com first, and lets go of that once signed in", async () => {
      const user = userEvent.setup();
      const sent = rust({ session: null });
      render(<Field />);
      await act(async () => {});
      fireEvent.paste(field(), { clipboardData: { files: [picture()], getData: () => "" } });
      const status = screen.getByRole("status");
      expect(status.textContent).toContain("sign in to github.com once");
      await user.click(screen.getByRole("button", { name: "Sign in to github.com" }));
      expect(sent).toContain("sign_in_web");
      await act(async () => {
        await emit("web-session", "you");
      });
      expect(screen.queryByRole("status")).toBeNull();
      expect(valueNow()).toBe("");
    });

    it("keeps saying why an upload failed after signing in", async () => {
      rust({ session: null });
      render(<Field />);
      await act(async () => {});
      fireEvent.paste(field(), {
        clipboardData: { files: [new File(["x"], "notes.txt", { type: "text/plain" })], getData: () => "" },
      });
      await act(async () => {
        await emit("web-session", "you");
      });
      expect(screen.getByRole("alert").textContent).toContain("GitHub takes PNG");
      await act(async () => {
        await emit("web-session", null);
      });
      expect(screen.getByRole("alert")).toBeTruthy();
    });

    it("takes the placeholder out and says why when an upload fails", async () => {
      const failures: unknown[] = [
        "The connection was lost",
        { kind: "failed", message: "Size must be less than 10 MB" },
        { kind: "session_expired" },
        { kind: "not_signed_in" },
      ];
      const uploads = failures.map(() => deferred<unknown>());
      rust({ uploads: uploads.map((u) => () => u.promise) });
      render(<Field />);
      await act(async () => {});
      const attempt = async () => {
        fireEvent.paste(field(), { clipboardData: { files: [picture()], getData: () => "" } });
        await nextFrame();
        // Elsewhere meanwhile: the caret is the field's own business.
        field().blur();
        await act(async () => {
          const upload = uploads.shift()!;
          upload.reject(failures.shift());
          await upload.promise.catch(() => {});
        });
      };
      await attempt();
      expect(screen.getByRole("alert").textContent).toBe("The connection was lost");
      expect(valueNow()).toBe("");
      await attempt();
      expect(screen.getByRole("alert").textContent).toBe("Size must be less than 10 MB");
      await attempt();
      expect(screen.getByRole("status").textContent).toContain("session ended");
      await attempt();
      expect(screen.getByRole("status").textContent).toContain("sign in to github.com once");
    });

    it("leaves the text alone when the placeholder was already taken out", async () => {
      const upload = deferred<unknown>();
      rust({ uploads: [() => upload.promise] });
      render(<Field />);
      await act(async () => {});
      fireEvent.paste(field(), { clipboardData: { files: [picture()], getData: () => "" } });
      await nextFrame();
      fireEvent.change(field(), { target: { value: "Rewritten", selectionStart: 9 } });
      await act(async () => {
        upload.resolve({ href: "https://github.com/user-attachments/assets/5", kind: "image" });
        await upload.promise;
      });
      expect(valueNow()).toBe("Rewritten");
    });

    it("isn't offered without the pull request's number", async () => {
      render(<Field api={apiFor("https://github.com/acme/app")} />);
      await act(async () => {});
      expect(screen.queryByRole("button", { name: "Attach pictures or videos" })).toBeNull();
    });
  });

  describe("suggested change and saved replies", () => {
    it("puts the lines in a suggestion block on lines of its own", async () => {
      const user = userEvent.setup();
      render(<Field initial="Try this" suggestion={["const a = 1;"]} />);
      field().setSelectionRange(8, 8);
      await user.click(screen.getByRole("button", { name: /Suggest/u }));
      await nextFrame();
      await nextFrame();
      expect(valueNow()).toBe("Try this\n```suggestion\nconst a = 1;\n```\n");
    });

    it("adds no blank line where there's one already", async () => {
      const user = userEvent.setup();
      render(<Field initial={"\n"} suggestion={[]} />);
      field().setSelectionRange(0, 0);
      await user.click(screen.getByRole("button", { name: /Suggest/u }));
      await nextFrame();
      await nextFrame();
      expect(valueNow()).toBe("```suggestion\n```\n");
    });

    it("loads your saved replies once and puts the one picked in", async () => {
      const user = userEvent.setup();
      const replies = deferred<Array<{ id: string; title: string; body: string }> | null>();
      vi.mocked(savedReplies).mockReturnValue(replies.promise);
      render(<Field initial="Hi " />);
      await user.click(screen.getByRole("button", { name: "Saved Replies" }));
      expect(await screen.findByText("Loading")).toBeTruthy();
      await act(async () => {
        replies.resolve([{ id: "1", title: "Thanks", body: "Thanks for this!" }]);
        await replies.promise;
      });
      await user.click(screen.getByRole("menuitem", { name: "Thanks" }));
      await nextFrame();
      await nextFrame();
      expect(valueNow()).toContain("Thanks for this!");
      await user.click(screen.getByRole("button", { name: "Saved Replies" }));
      expect(await screen.findByRole("menuitem", { name: "Thanks" })).toBeTruthy();
      await user.keyboard("{Escape}");
      expect(savedReplies).toHaveBeenCalledOnce();
    });

    it("says when there are none, or they can't be read with this sign-in", async () => {
      const user = userEvent.setup();
      vi.mocked(savedReplies).mockResolvedValueOnce([]).mockResolvedValueOnce(null);
      const { unmount } = render(<Field />);
      await user.click(screen.getByRole("button", { name: "Saved Replies" }));
      expect(await screen.findByText(/No saved replies yet/u)).toBeTruthy();
      unmount();
      render(<Field />);
      await user.click(screen.getByRole("button", { name: "Saved Replies" }));
      expect(await screen.findByText(/read:user|permission/iu)).toBeTruthy();
    });

    it("puts a reply in at the end when picked from the preview, and back in the field", async () => {
      const user = userEvent.setup();
      vi.mocked(savedReplies).mockResolvedValue([{ id: "1", title: "LGTM", body: "LGTM" }]);
      vi.mocked(preview).mockResolvedValue("<p>Hi</p>");
      render(<Field initial="Hi" />);
      await user.click(screen.getByRole("tab", { name: "Preview" }));
      await user.click(screen.getByRole("button", { name: "Saved Replies" }));
      await user.click(await screen.findByRole("menuitem", { name: "LGTM" }));
      await nextFrame();
      await nextFrame();
      expect(valueNow()).toBe("HiLGTM");
      expect(screen.getByRole("tab", { name: "Write" }).getAttribute("aria-selected")).toBe("true");
    });

    it("does nothing once the field is gone", async () => {
      const user = userEvent.setup();
      vi.mocked(savedReplies).mockResolvedValue([{ id: "1", title: "LGTM", body: "LGTM" }]);
      const run = execCommand(true);
      const { unmount } = render(<Field />);
      await user.click(screen.getByRole("button", { name: "Saved Replies" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "LGTM" }));
      unmount();
      await nextFrame();
      await nextFrame();
      expect(run).not.toHaveBeenCalled();
    });
  });
});
