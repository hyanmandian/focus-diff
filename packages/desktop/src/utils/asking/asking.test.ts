import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  adopt,
  askInto,
  chatKey,
  clearTurns,
  forget,
  resetAsking,
  setOpen,
  updateChat,
  usePullAsking,
  type Open,
} from "@/utils/asking/asking";
import type { Saved } from "@/utils/bridge/bridge";
import { mockCommands } from "@/utils/fake-platform/fake-platform";

const PULL = "acme/octo#7";
const LINES: Open = { path: "src/a.ts", range: { start: 14, end: 12, side: "additions" } };
const KEY = chatKey(LINES);

const stored = (pull = PULL): unknown => JSON.parse(localStorage.getItem(`asking:${pull}`) ?? "null");

describe("chatKey", () => {
  it("names the lines, in order, with their side", () => {
    expect(KEY).toBe("src/a.ts:12-14:additions");
    expect(chatKey({ path: "b.ts", range: { start: 3, end: 3, side: "deletions", endSide: "additions" } })).toBe(
      "b.ts:3-3:additions",
    );
    expect(chatKey({ path: "b.ts", range: { start: 3, end: 3 } })).toBe("b.ts:3-3:additions");
    expect(chatKey({ path: "b.ts", range: { start: 0, end: 0 }, file: true })).toBe("b.ts:file");
  });
});

describe("asking", () => {
  it("keeps the open lines and what was said after leaving and coming back", async () => {
    const { result, unmount } = renderHook(() => usePullAsking(PULL));
    expect(result.current).toEqual({ open: null, chats: {} });
    act(() => {
      setOpen(PULL, LINES);
    });
    let settle: (answer: { text: string; note?: string }) => void = () => {};
    let asked: Promise<boolean> = Promise.resolve(false);
    act(() => {
      asked = askInto(PULL, KEY, "Why?", "run-1", (earlier) => {
        expect(earlier).toEqual([]);
        return new Promise((resolve) => {
          settle = resolve;
        });
      });
    });
    expect(result.current.chats[KEY]?.run?.id).toBe("run-1");
    unmount();
    settle({ text: "Because.", note: "From the diff" });
    await expect(asked).resolves.toBe(true);

    resetAsking();
    const back = renderHook(() => usePullAsking(PULL));
    expect(back.result.current.open).toEqual(LINES);
    expect(back.result.current.chats[KEY]?.turns).toEqual([
      { id: expect.any(Number) as unknown, question: "Why?", answer: "Because.", note: "From the diff" },
    ]);
    await act(() =>
      askInto(PULL, KEY, "And?", "run-2", (earlier) => {
        expect(earlier).toEqual([{ question: "Why?", answer: "Because." }]);
        return Promise.resolve({ text: "That's all." });
      }),
    );
    const [first, second] = back.result.current.chats[KEY]!.turns.map((turn) => turn.id);
    expect(second).toBeGreaterThan(first!);
  });

  it("asks one thing at a time", async () => {
    const pending = askInto(PULL, KEY, "One", "a", () => new Promise(() => {}));
    await expect(askInto(PULL, KEY, "Two", "b", () => Promise.resolve({ text: "" }))).resolves.toBe(false);
    expect(pending).toBeInstanceOf(Promise);
  });

  it("puts the question back and says what went wrong", async () => {
    await expect(askInto(PULL, KEY, "Why?", "r", () => Promise.reject(new Error("No answer")))).resolves.toBe(false);
    const { result } = renderHook(() => usePullAsking(PULL));
    expect(result.current.chats[KEY]).toMatchObject({ question: "Why?", turns: [], run: null, error: "No answer" });
    let fail: (error: Error) => void = () => {};
    const again = askInto(
      PULL,
      KEY,
      "Again",
      "s",
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    act(() => {
      updateChat(PULL, KEY, { question: "Typed meanwhile" });
    });
    fail(new Error("Still no"));
    await act(() => again);
    expect(result.current.chats[KEY]?.question).toBe("Typed meanwhile");
  });

  it("forgets a conversation once it's closed, and leaves nothing behind", () => {
    setOpen(PULL, LINES);
    updateChat(PULL, KEY, { body: "Draft", mode: "comment" });
    expect(stored()).toMatchObject({ open: LINES, chats: { [KEY]: { body: "Draft", mode: "comment" } } });
    forget(PULL, KEY);
    expect(stored()).toBeNull();
  });

  it("doesn't keep a question still waiting for its answer", () => {
    updateChat(PULL, KEY, { turns: [{ id: 1, question: "Waiting" }], run: { id: "r", at: 1 } });
    expect(stored()).toMatchObject({ chats: { [KEY]: { turns: [] } } });
    expect(JSON.stringify(stored())).not.toContain("run");
  });

  it("ignores what it can't read", () => {
    localStorage.setItem(`asking:${PULL}`, "{");
    expect(renderHook(() => usePullAsking(PULL)).result.current).toEqual({ open: null, chats: {} });
    resetAsking();
    localStorage.setItem(`asking:${PULL}`, JSON.stringify({ open: "x", chats: [] }));
    expect(renderHook(() => usePullAsking(PULL)).result.current).toEqual({ open: null, chats: {} });
    resetAsking();
    localStorage.setItem(
      `asking:${PULL}`,
      JSON.stringify({
        open: { path: "a.ts" },
        chats: {
          bad: "x",
          worse: { turns: "x" },
          [KEY]: {
            mode: "other",
            body: 3,
            question: null,
            turns: [{ id: 1, question: "Q", answer: "A" }, { id: 2, question: "Q" }, "x"],
          },
          other: { mode: "ask", body: "B", question: "Q", turns: [] },
        },
      }),
    );
    const { result } = renderHook(() => usePullAsking(PULL));
    expect(result.current.open).toBeNull();
    expect(Object.keys(result.current.chats)).toEqual([KEY, "other"]);
    expect(result.current.chats[KEY]).toMatchObject({ mode: null, body: "", question: "", turns: [{ id: 1 }] });
    expect(result.current.chats.other).toMatchObject({ mode: "ask", body: "B", question: "Q" });
  });

  it("keeps only the most recent pull requests", () => {
    localStorage.setItem("asking:broken", "{");
    localStorage.setItem("asking:undated", JSON.stringify({ chats: {} }));
    for (let i = 0; i < 30; i++) localStorage.setItem(`asking:old/${i}#1`, JSON.stringify({ chats: {}, at: i + 1 }));
    setOpen(PULL, LINES);
    const kept = Object.keys(localStorage).filter((key) => key.startsWith("asking:"));
    expect(kept).toHaveLength(30);
    expect(kept).toContain(`asking:${PULL}`);
    expect(kept).not.toContain("asking:broken");
    expect(kept).not.toContain("asking:undated");
    expect(kept).not.toContain("asking:old/0#1");
  });

  it("still works when storage doesn't", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Full");
    });
    setOpen(PULL, LINES);
    expect(renderHook(() => usePullAsking(PULL)).result.current.open).toEqual(LINES);
  });

  describe("answers kept on disk", () => {
    const answer = (over: Partial<Saved> = {}): Saved => ({
      id: "q1",
      kind: "ask",
      key: KEY,
      head: "",
      at: 1,
      status: "done",
      text: "Because.",
      note: "From the diff",
      project: false,
      meta: JSON.stringify({ question: "Why?", turn: 5 }),
      archived: false,
      dismissed: [],
      ...over,
    });
    const blank = (saved: Saved): Saved => {
      const copy = { ...saved };
      delete copy.text;
      return copy;
    };
    const marked = () => {
      const calls: unknown[] = [];
      mockCommands((cmd, args) => {
        calls.push([cmd, args]);
        return null;
      });
      return calls;
    };

    it("brings back answers that came while nobody was looking, in order and once", () => {
      updateChat(PULL, KEY, { turns: [{ id: 9, question: "Later?", answer: "Yes." }], run: { id: "q2", at: 1 } });
      adopt(PULL, [
        answer(),
        answer({ id: "q2", meta: JSON.stringify({ question: "Pending?", turn: 7 }) }),
        answer({ id: "q3", status: "running", meta: JSON.stringify({ question: "Still?", turn: 8 }) }),
        answer({ id: "q4", archived: true }),
        answer({ id: "q5", kind: "analysis" }),
        answer({ id: "q6", meta: "{" }),
        answer({ id: "q7", meta: "{}" }),
        blank(answer({ id: "q8", meta: JSON.stringify({ question: "Blank?", turn: 6 }) })),
      ]);
      const { result } = renderHook(() => usePullAsking(PULL));
      expect(result.current.chats[KEY]).toMatchObject({
        run: null,
        turns: [
          { id: 5, question: "Why?", answer: "Because.", note: "From the diff" },
          { id: 6, question: "Blank?", answer: "" },
          { id: 7, question: "Pending?", answer: "Because." },
          { id: 9, question: "Later?", answer: "Yes." },
        ],
      });
      const before = stored();
      adopt(PULL, [answer()]);
      expect(stored()).toEqual(before);
      adopt("other", [answer({ key: "x" })]);
      expect(renderHook(() => usePullAsking("other")).result.current.chats.x?.turns).toHaveLength(1);
    });

    it("archives what it kept when a conversation is cleared or closed, so it doesn't come back", () => {
      const calls = marked();
      adopt(PULL, [answer(), answer({ id: "q2", key: "other" })]);
      clearTurns(PULL, KEY);
      expect(renderHook(() => usePullAsking(PULL)).result.current.chats[KEY]?.turns).toEqual([]);
      forget(PULL, "other");
      forget(PULL, "never");
      forget("nowhere", KEY);
      expect(calls).toEqual([
        ["ai_saved_mark", { pull: PULL, id: "q1", archived: true, dismiss: null }],
        ["ai_saved_mark", { pull: PULL, id: "q2", archived: true, dismiss: null }],
      ]);
    });

    it("doesn't mind when an archive can't be kept", async () => {
      mockCommands(() => Promise.reject(new Error("disk full")));
      adopt(PULL, [answer()]);
      forget(PULL, KEY);
      await Promise.resolve();
      expect(stored()).toBeNull();
    });

    it("asks with where to keep the answer", async () => {
      const keep = vi.fn<(earlier: unknown, keep: unknown) => Promise<{ text: string }>>(() =>
        Promise.resolve({ text: "ok" }),
      );
      await askInto(PULL, KEY, "Why?", "r", keep);
      expect(keep).toHaveBeenCalledWith([], {
        pull: PULL,
        kind: "ask",
        key: KEY,
        head: "",
        meta: expect.stringMatching(/^\{"question":"Why\?","turn":\d+\}$/u) as unknown,
      });
    });
  });
});
