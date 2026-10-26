import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createEstimator,
  creditFor,
  estimateHint,
  kindOf,
  learnFile,
  normalizeLearned,
  paceFactors,
  pullMinutes,
  reviewMinutes,
  share,
} from "@/utils/estimate/estimate";
import { i18n } from "@/utils/i18n/i18n";

/** The module afresh, with nothing read yet. */
function fresh() {
  vi.resetModules();
  return import("@/utils/estimate/estimate");
}

/** What Rust gets asked to read and write of pace.json, answering reads with `kept`. */
function disk(kept: () => string | null) {
  const writes: unknown[] = [];
  let reads = 0;
  mockIPC(
    (cmd, args) => {
      if (cmd === "read_file") {
        reads++;
        return kept();
      }
      if (cmd === "write_file") writes.push(args);
      return null;
    },
    { shouldMockEvents: true },
  );
  return { writes, reads: () => reads };
}

/** Rust with no pace.json, and no room to write one. */
const fullDisk = (cmd: string) => (cmd === "read_file" ? null : Promise.reject(new Error("disk full")));

const slow = { all: { actual: 40, expected: 20, files: 4 }, kinds: { code: { actual: 40, expected: 20, files: 4 } } };

describe("review time", () => {
  it("takes about an hour for 1,000 added lines", () => {
    expect(reviewMinutes("src/app.ts", { additions: 1000, deletions: 0 })).toBeCloseTo(60.25);
    // Removed lines count a fifth.
    expect(reviewMinutes("src/app.ts", { additions: 0, deletions: 1000 })).toBeCloseTo(12.25);
    // Generated and lock files only cost opening them.
    expect(reviewMinutes("yarn.lock", { additions: 9000, deletions: 0 })).toBe(0.25);
  });

  it("estimates a pull request from its totals", () => {
    expect(pullMinutes({ additions: 1000, deletions: 0, changedFiles: 4 }, null)).toBeCloseTo(61);
    // A reader who takes 1.5 times as long.
    expect(pullMinutes({ additions: 1000, deletions: 0, changedFiles: 4 }, slow)).toBeCloseTo(61 * 1.5);
  });

  it("estimates at a pace of its own with nothing learned", () => {
    expect(createEstimator(null, 500)("src/a.ts", { additions: 500, deletions: 0 })).toBeCloseTo(60.25);
    expect(createEstimator(null)("src/a.ts", null)).toBe(0.25);
  });

  it("says what it assumes", () => {
    expect(estimateHint(i18n())).toContain("1,000");
  });

  it("tells kinds of file apart", () => {
    expect(kindOf("src/app.test.ts")).toBe("tests");
    expect(kindOf("docs/setup.md")).toBe("docs");
    expect(kindOf("package-lock.json")).toBe("generated");
    expect(kindOf("src/app.ts")).toBe("code");
  });
});

describe("learning the reader's pace", () => {
  it("starts at the starting pace", () => {
    const { all, kinds } = paceFactors(normalizeLearned(null));
    expect(all).toBe(1);
    expect(kinds.code).toBe(1);
  });

  it("slows the estimates for a slow reader, most for the kind they're slow at", () => {
    let learned = normalizeLearned(null);
    for (let i = 0; i < 20; i++) learned = learnFile(learned, `src/f${i}.ts`, 5, 10);
    const { all, kinds } = paceFactors(learned);
    expect(all).toBeGreaterThan(1.5);
    expect(kinds.code).toBeGreaterThan(kinds.docs);
    const estimate = createEstimator(learned);
    expect(estimate("src/x.ts", { additions: 100, deletions: 0 })).toBeGreaterThan(
      reviewMinutes("src/x.ts", { additions: 100, deletions: 0 }) * 1.5,
    );
  });

  it("can't be skewed by one file left open", () => {
    const learned = learnFile(normalizeLearned(null), "src/a.ts", 1, 600);
    expect(learned.all.actual).toBe(6);
    expect(learnFile(learned, "src/a.ts", 0, 5)).toBe(learned);
  });

  it("reads what's kept, dropping what's broken", () => {
    expect(
      normalizeLearned({ all: { actual: 3, expected: -1, files: "x" }, kinds: { code: { actual: 1 }, nope: {} } }),
    ).toEqual({
      all: { actual: 3, expected: 0, files: 0 },
      kinds: { code: { actual: 1, expected: 0, files: 0 } },
    });
    expect(normalizeLearned({ all: 5, kinds: "x" })).toEqual(normalizeLearned(null));
  });
});

describe("time spent on files", () => {
  it("counts a still moment only up to a limit", () => {
    expect(creditFor(30_000)).toBe(30_000);
    expect(creditFor(10 * 60_000)).toBe(90_000);
    expect(creditFor(-5)).toBe(0);
  });

  it("shares it by how much of the screen each file takes", () => {
    expect(
      share(900, [
        ["a", 200],
        ["b", 100],
      ]),
    ).toEqual([
      ["a", 600],
      ["b", 300],
    ]);
    expect(share(900, [])).toEqual([]);
  });
});

describe("what's learned, kept in pace.json", () => {
  it("is null until read, then what's kept, following other windows' changes", async () => {
    let kept = JSON.stringify(slow);
    const rust = disk(() => kept);
    const { useLearned } = await fresh();
    const { result } = renderHook(() => useLearned());
    expect(result.current).toBeNull();
    await waitFor(() => {
      expect(result.current).toEqual(slow);
    });
    kept = JSON.stringify(normalizeLearned(null));
    await act(() => emit("file-changed", "config"));
    expect(rust.reads()).toBe(1);
    await act(() => emit("file-changed", "pace"));
    await waitFor(() => {
      expect(result.current).toEqual(normalizeLearned(null));
    });
  });

  it("starts from nothing when there's no file, or it can't be read", async () => {
    disk(() => null);
    const first = await fresh();
    const { result } = renderHook(() => first.useLearned());
    await waitFor(() => {
      expect(result.current).toEqual(normalizeLearned(null));
    });
    disk(() => "{broken");
    const second = await fresh();
    const again = renderHook(() => second.useLearned());
    await waitFor(() => {
      expect(again.result.current).toEqual(normalizeLearned(null));
    });
  });

  it("learns files on top of what's on disk, and keeps it", async () => {
    const rust = disk(() => JSON.stringify(slow));
    const { learnFiles, useLearned } = await fresh();
    const { result } = renderHook(() => useLearned());
    await act(() => learnFiles([{ path: "src/a.ts", expected: 2, actual: 4 }]));
    const expected = learnFile(slow, "src/a.ts", 2, 4);
    expect(result.current).toEqual(expected);
    expect(rust.writes).toEqual([{ name: "pace", contents: JSON.stringify(expected) }]);
  });

  it("learns from nothing when the file's unreadable, and shrugs off a failed write", async () => {
    mockIPC(fullDisk);
    const { learnFiles } = await fresh();
    await expect(learnFiles([{ path: "a.md", expected: 1, actual: 1 }])).resolves.toBeUndefined();
  });

  it("does nothing with no files", async () => {
    const rust = disk(() => null);
    const { learnFiles } = await fresh();
    await learnFiles([]);
    expect(rust.reads()).toBe(0);
  });
});
