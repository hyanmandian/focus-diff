import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { findingKey, useAnalysis } from "@/hooks/use-analysis/use-analysis";
import type { useSaved } from "@/hooks/use-saved/use-saved";
import { aiProblem, ensureAi } from "@/utils/ai-ready/ai-ready";
import type { Saved } from "@/utils/bridge/bridge";
import { defaultConfig, type Config } from "@/utils/config/config";
import type { Details } from "@/utils/details/details";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { fakeDetails } from "@/utils/mock-pull/mock-pull";
import type { ReviewFile } from "@/utils/review/review";
import { analyze, deepen } from "@/utils/walkthrough/walkthrough";

const h = vi.hoisted(() => ({ saved: null as Saved[] | null }));

vi.mock("@/hooks/use-saved/use-saved", () => ({ useSaved: vi.fn<typeof useSaved>(() => h.saved) }));
vi.mock("@/utils/ai-ready/ai-ready", () => ({
  ensureAi: vi.fn<typeof ensureAi>(() => Promise.resolve(true)),
  aiProblem: vi.fn<typeof aiProblem>(() => Promise.resolve(null)),
}));
vi.mock("@/utils/walkthrough/walkthrough", async (original) => ({
  ...(await original<object>()),
  analyze: vi.fn<typeof analyze>(() => Promise.resolve()),
  deepen: vi.fn<typeof deepen>(() => Promise.resolve()),
}));

const AI: Config = { ...defaultConfig(), ai: { ...defaultConfig().ai, provider: "claude" } };
const DETAILS = fakeDetails({ headRefOid: "abc" });
const file = (path: string): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: "@@ -0,0 +1,2 @@\n+a\n+b",
});
const FILES = [file("src/cart.ts"), file("src/promo.ts"), file("src/cart.test.ts")];
const PLAN = { paths: ["src/cart.ts", "src/promo.ts", "src/cart.test.ts"], kept: 2 };
const ANSWER = {
  overview: "Cart work",
  sections: [{ title: "Cart", files: [{ id: 1 }] }],
  findings: [
    { id: 1, line: 2, severity: "issue", body: "Bug." },
    { id: 2, line: 1, severity: "question", body: "Why?" },
  ],
};

const record = (over: Partial<Saved> = {}): Saved => ({
  id: "r1",
  kind: "analysis",
  key: "",
  head: "abc",
  at: 10,
  status: "done",
  text: JSON.stringify(ANSWER),
  project: true,
  meta: JSON.stringify(PLAN),
  archived: false,
  dismissed: [],
  ...over,
});
const unanswered = (run: Saved): Saved => {
  const copy = { ...run };
  delete copy.text;
  return copy;
};
const part = (over: Partial<Saved> = {}): Saved =>
  record({
    id: "p1",
    kind: "part",
    key: "r1#0",
    at: 20,
    text: JSON.stringify({ summary: "In depth.", files: [] }),
    meta: JSON.stringify({ paths: ["src/cart.ts"], kept: 1 }),
    ...over,
  });

type Inputs = { ai: Config | null; details: Details | null; files: ReviewFile[] | null };

function hook(over: Partial<Inputs> = {}) {
  return renderHook((p: Inputs) => useAnalysis("PR_1", p.ai, p.details, p.files), {
    initialProps: { ai: AI, details: DETAILS, files: FILES, ...over },
  });
}

let asked: Array<[string, unknown]> = [];
beforeEach(() => {
  h.saved = null;
  asked = [];
  mockCommands((cmd, args) => {
    asked.push([cmd, args]);
    return cmd === "ai_saved" ? (h.saved ?? []) : null;
  });
});

describe("useAnalysis", () => {
  it("has nothing to show before it knows what ran, and splits the files", () => {
    const { result } = hook();
    expect(result.current).toMatchObject({ saved: null, analysis: null, building: false, error: null, stale: false });
    expect(result.current.split?.kept.map((f) => f.path)).toEqual(["src/cart.ts", "src/promo.ts"]);
    expect(hook({ files: null }).result.current.split).toBeNull();
    expect(result.current.deepening(0)).toBe(false);
    h.saved = [part({ status: "running" })];
    expect(hook().result.current.deepening(0)).toBe(false);
  });

  it("reads the latest run into a walkthrough and a review, without the comments dismissed", () => {
    h.saved = [
      record({ id: "r0", at: 1 }),
      record({
        dismissed: [findingKey({ path: "src/promo.ts", line: 1, severity: "question", body: "Why?", inDiff: true })],
      }),
    ];
    const { result, rerender } = hook();
    expect(result.current.record?.id).toBe("r1");
    expect(result.current.current).toBe(true);
    expect(result.current.analysis?.walkthrough).toMatchObject({ overview: "Cart work", project: true, at: 10 });
    expect(result.current.analysis?.walkthrough.sections.map((s) => s.kind)).toEqual(["change", "rest"]);
    expect(result.current.analysis?.review.findings.map((f) => f.body)).toEqual(["Bug."]);
    rerender({ ai: AI, details: fakeDetails({ headRefOid: "def" }), files: FILES });
    expect(result.current).toMatchObject({ stale: true, current: false });
  });

  it.each([
    ["a plan it can't read", record({ meta: "{" })],
    ["a plan of the wrong shape", record({ meta: "{}" })],
    ["no answer", unanswered(record())],
    ["an answer it can't read", record({ text: "nope" })],
  ])("shows nothing for a run with %s", (_, run) => {
    h.saved = [run];
    expect(hook().result.current.analysis).toBeNull();
  });

  it("waits for the files to read a run", () => {
    h.saved = [record()];
    expect(hook({ files: null }).result.current.analysis).toBeNull();
  });

  it("puts each part explained in depth back in its place, skipping what it can't read", () => {
    h.saved = [record(), part({ id: "p0", at: 15, text: "nope" }), part(), part({ id: "p2", key: "r1#5" })];
    expect(hook().result.current.analysis?.walkthrough.sections[0]).toMatchObject({ summary: "In depth.", deep: true });
    h.saved = [record(), part({ text: "nope" })];
    expect(hook().result.current.analysis?.walkthrough.sections[0]).toMatchObject({ deep: false });
    h.saved = [record(), part({ meta: "{" })];
    expect(hook().result.current.analysis?.walkthrough.sections[0]).toMatchObject({ deep: false });
  });

  it("shows it's building, stops it, and says why the latest run failed", () => {
    h.saved = [record(), record({ id: "r2", status: "running", at: 30 })];
    const { result, rerender } = hook();
    expect(result.current.building).toBe(true);
    act(() => {
      result.current.stop();
    });
    expect(asked).toEqual([["ai_cancel", { run: "r2" }]]);
    h.saved = [record(), record({ id: "r2", status: "failed", error: "No quota", at: 30 })];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    expect(result.current).toMatchObject({ building: false, error: "No quota" });
    h.saved = [record({ id: "r0", status: "failed", at: 1 }), record()];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    expect(result.current.error).toBeNull();
    h.saved = [record({ id: "r2", status: "failed", at: 30 })];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    expect(result.current.error).toBe("");
    act(() => {
      result.current.stop();
    });
    expect(asked).toHaveLength(1);
  });

  it("shows an earlier run on demand, archived or not, and archives runs", () => {
    h.saved = [record({ id: "r0", at: 1, archived: true }), record({ archived: true })];
    const { result } = hook();
    expect(result.current.record).toBeNull();
    act(() => {
      result.current.show("r0");
    });
    expect(result.current.record?.id).toBe("r0");
    act(() => {
      result.current.archive("r0", false);
    });
    expect(result.current.record).toBeNull();
    act(() => {
      result.current.archive("r1");
    });
    expect(asked).toEqual([
      ["ai_saved_mark", { pull: "PR_1", id: "r0", archived: false, dismiss: null }],
      ["ai_saved_mark", { pull: "PR_1", id: "r1", archived: true, dismiss: null }],
    ]);
  });

  it("doesn't mind when the mark can't be kept", async () => {
    mockCommands(() => Promise.reject(new Error("disk full")));
    const { result } = hook();
    act(() => {
      result.current.archive("r1");
    });
    await act(() => Promise.resolve());
    expect(result.current.record).toBeNull();
  });

  it("dismisses a comment on the run shown, and nowhere without one", () => {
    h.saved = [];
    const { result, rerender } = hook();
    const bug = { path: "src/cart.ts", line: 2, severity: "issue" as const, body: "Bug.", inDiff: true };
    act(() => {
      result.current.dismiss(bug);
    });
    expect(asked).toEqual([]);
    h.saved = [record({ dismissed: ["x"] })];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    act(() => {
      result.current.dismiss(bug);
    });
    expect(asked).toEqual([["ai_saved_mark", { pull: "PR_1", id: "r1", archived: null, dismiss: findingKey(bug) }]]);
  });

  it("builds for the head, with the files it keeps, and says why it couldn't", async () => {
    h.saved = [];
    const { result } = hook();
    await act(() => result.current.build());
    expect(analyze).toHaveBeenCalledWith(AI, DETAILS, result.current.split, {
      pull: "PR_1",
      head: "abc",
      run: expect.any(String) as unknown,
    });
    vi.mocked(analyze).mockRejectedValueOnce(new Error("Turn on AI in Settings first."));
    await act(() => result.current.build());
    expect(result.current.error).toBe("Turn on AI in Settings first.");
    await act(() => result.current.build(false));
    expect(aiProblem).toHaveBeenCalledWith(AI);
    expect(result.current.error).toBeNull();
  });

  it("keeps quiet when a run it started ends stopped, since the run says so itself", async () => {
    const { result } = hook();
    vi.mocked(analyze).mockImplementationOnce((_, __, ___, start) => {
      h.saved = [record({ id: start.run, status: "stopped" })];
      return Promise.reject(new Error("Stopped"));
    });
    await act(() => result.current.build());
    expect(result.current.error).toBeNull();
    mockCommands((cmd) => {
      if (cmd === "ai_saved") throw new Error("No data folder");
      return null;
    });
    vi.mocked(analyze).mockRejectedValueOnce(new Error("No quota"));
    await act(() => result.current.build());
    expect(result.current.error).toBe("No quota");
  });

  it("starts one run at a time, and builds on its own once per head", async () => {
    let finish = () => {};
    vi.mocked(analyze).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = hook();
    const first = act(() => result.current.build());
    await act(() => result.current.build());
    finish();
    await first;
    expect(analyze).toHaveBeenCalledTimes(1);
    await act(() => result.current.build(false));
    await act(() => result.current.build(false));
    expect(analyze).toHaveBeenCalledTimes(2);
    await act(() => result.current.build());
    expect(analyze).toHaveBeenCalledTimes(3);
  });

  it("says the newest answer couldn't be read, and shows the last one it can read", () => {
    h.saved = [record({ id: "r0", at: 1 }), record({ text: "nope" })];
    const { result } = hook();
    expect(result.current.record?.id).toBe("r0");
    expect(result.current.error).toBe("The AI's answer wasn't in the expected form. Try again.");
    expect(hook({ files: null }).result.current.error).toBeNull();
  });

  it.each<[string, Partial<Inputs>, Saved[]]>([
    ["without an AI", { ai: null }, []],
    ["before the details", { details: null }, []],
    ["before the files", { files: null }, []],
    ["with nothing to walk through", { files: [file("a.test.ts")] }, []],
    ["while one runs", {}, [record({ status: "running" })]],
  ])("doesn't build %s", async (_, over, saved) => {
    h.saved = saved;
    const { result } = hook(over);
    await act(() => result.current.build());
    expect(analyze).not.toHaveBeenCalled();
  });

  it("doesn't build when the AI isn't ready", async () => {
    vi.mocked(ensureAi).mockResolvedValueOnce(false);
    vi.mocked(aiProblem).mockResolvedValueOnce({ title: "No", message: "" });
    const { result } = hook();
    await act(() => result.current.build());
    await act(() => result.current.build(false));
    expect(analyze).not.toHaveBeenCalled();
  });

  it("explains a part from its own files, kept under the run, and follows it", async () => {
    h.saved = [record()];
    const { result, rerender } = hook();
    await act(() => result.current.deepen(0));
    expect(deepen).toHaveBeenCalledWith(AI, DETAILS, result.current.analysis?.walkthrough.sections[0], [FILES[0]], {
      pull: "PR_1",
      head: "abc",
      run: expect.any(String) as unknown,
      key: "r1#0",
    });
    vi.mocked(deepen).mockRejectedValueOnce(new Error("off"));
    await act(() => result.current.deepen(0));
    h.saved = [record(), part({ status: "running" }), part({ id: "p0", status: "failed", error: "No quota", at: 5 })];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    expect([result.current.deepening(0), result.current.deepening(1)]).toEqual([true, false]);
    expect(result.current.partError(0)).toBe("No quota");
    act(() => {
      result.current.stopPart(0);
    });
    expect(asked).toEqual([["ai_cancel", { run: "p1" }]]);
    h.saved = [record(), part({ status: "failed" })];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    expect(result.current.partError(0)).toBe("");
    h.saved = [record(), part()];
    rerender({ ai: AI, details: DETAILS, files: FILES });
    expect(result.current.partError(0)).toBeNull();
  });

  it("explains a part once at a time", async () => {
    h.saved = [record()];
    let finish = () => {};
    vi.mocked(deepen).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = hook();
    const first = act(() => result.current.deepen(0));
    await act(() => result.current.deepen(0));
    finish();
    await first;
    expect(deepen).toHaveBeenCalledTimes(1);
  });

  it.each<[string, Partial<Inputs>, number]>([
    ["a part it doesn't have", {}, 5],
    ["without an AI", { ai: null }, 0],
    ["before the files", { files: null }, 0],
    ["before the details", { details: null }, 0],
  ])("doesn't explain %s", async (_, over, index) => {
    h.saved = [record()];
    const { result } = hook(over);
    await act(() => result.current.deepen(index));
    expect(deepen).not.toHaveBeenCalled();
  });

  it("doesn't explain before there's a run, or when the AI isn't ready", async () => {
    const { result } = hook();
    await act(() => result.current.deepen(0));
    h.saved = [record()];
    vi.mocked(ensureAi).mockResolvedValueOnce(false);
    const second = hook();
    await act(() => second.result.current.deepen(0));
    expect(deepen).not.toHaveBeenCalled();
  });
});
