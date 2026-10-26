import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { storage } from "#imports";

import { BUDGET, indexItem, keptRead, keptWrite, LARGEST, SWEEP_AFTER } from "./kept";

beforeEach(async () => {
  await fakeBrowser.storage.local.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a review's last copy", () => {
  it("is kept and read back", async () => {
    await expect(keptRead("PR_kw1")).resolves.toBeNull();
    await keptWrite("PR_kw1", '{"title":"Fix login"}');
    await expect(keptRead("PR_kw1")).resolves.toBe('{"title":"Fix login"}');
  });

  it("is only for a pull request's id", async () => {
    for (const bad of ["", "../x", "a/b", "x".repeat(65)]) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await expect(keptRead(bad)).rejects.toThrow("Bad pull request");
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await expect(keptWrite(bad, "{}")).rejects.toThrow("Bad pull request");
    }
  });

  it("goes when it's too large to keep", async () => {
    await keptWrite("PR_1", "{}");
    await keptWrite("PR_1", "x".repeat(LARGEST + 1));
    await expect(keptRead("PR_1")).resolves.toBeNull();
    await expect(indexItem.getValue()).resolves.toEqual({});
  });

  it("goes after two weeks unused, and reading it counts as using it", async () => {
    vi.useFakeTimers();
    await keptWrite("PR_old", "a");
    await keptWrite("PR_read", "b");
    vi.advanceTimersByTime(SWEEP_AFTER - 1000);
    await keptRead("PR_read");
    vi.advanceTimersByTime(2000);
    await keptWrite("PR_new", "c");
    await expect(keptRead("PR_old")).resolves.toBeNull();
    await expect(keptRead("PR_read")).resolves.toBe("b");
  });

  it("makes room by letting the least recently used go", async () => {
    vi.useFakeTimers();
    const big = "x".repeat(LARGEST);
    const ids = Array.from({ length: BUDGET / LARGEST }, (_, i) => `PR_${i}`);
    for (const id of ids) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await keptWrite(id, big);
      vi.advanceTimersByTime(1);
    }
    await keptRead("PR_0");
    await keptWrite("PR_last", "small");
    await expect(storage.getItem("local:kept.PR_1")).resolves.toBeNull();
    await expect(keptRead("PR_0")).resolves.toBe(big);
    await expect(keptRead("PR_2")).resolves.toBe(big);
  });

  it("is read even when the index lost it", async () => {
    await storage.setItem("local:kept.PR_x", "kept");
    await expect(keptRead("PR_x")).resolves.toBe("kept");
    await expect(indexItem.getValue()).resolves.toMatchObject({ PR_x: { size: 4 } });
  });
});
