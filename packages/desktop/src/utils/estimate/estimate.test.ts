import { learnFile, normalizeLearned } from "@focus-diff/core/estimate";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { estimateHint, pullMinutes } from "@/utils/estimate/estimate";
import { emit, mockCommands } from "@/utils/fake-platform/fake-platform";
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
  mockCommands((cmd, args) => {
    if (cmd === "read_file") {
      reads++;
      return kept();
    }
    if (cmd === "write_file") writes.push(args);
    return null;
  });
  return { writes, reads: () => reads };
}

/** Rust with no pace.json, and no room to write one. */
const fullDisk = (cmd: string) => (cmd === "read_file" ? null : Promise.reject(new Error("disk full")));

const slow = { all: { actual: 40, expected: 20, files: 4 }, kinds: { code: { actual: 40, expected: 20, files: 4 } } };

describe("review time", () => {
  it("estimates a pull request from its totals", () => {
    expect(pullMinutes({ additions: 1000, deletions: 0, changedFiles: 4 }, null)).toBeCloseTo(61);
    // A reader who takes 1.5 times as long.
    expect(pullMinutes({ additions: 1000, deletions: 0, changedFiles: 4 }, slow)).toBeCloseTo(61 * 1.5);
  });

  it("says what it assumes", () => {
    expect(estimateHint(i18n())).toContain("1,000");
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
    mockCommands(fullDisk);
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
