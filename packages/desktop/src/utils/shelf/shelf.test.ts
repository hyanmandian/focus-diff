import { describe, expect, it, vi } from "vite-plus/test";

import { cachedList, shelve, shelved } from "./shelf";

/** The shelf's index: when each key was kept. */
const index = () => localStorage.getItem("shelf-index");

describe("the shelf", () => {
  it("gives back what was kept, with its age", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    shelve("labels", ["bug"]);
    vi.spyOn(Date, "now").mockReturnValue(4000);
    expect(shelved<string[]>("labels")).toEqual({ value: ["bug"], age: 3000 });
  });

  it("has nothing for a key never kept, or kept unreadable", () => {
    expect(shelved("nothing")).toBeNull();
    localStorage.setItem("shelf:broken", "{");
    expect(shelved("broken")).toBeNull();
  });

  it("lets the least recently kept go past 120 things", () => {
    let now = 0;
    vi.spyOn(Date, "now").mockImplementation(() => ++now);
    for (let i = 0; i < 121; i++) shelve(`k${i}`, i);
    expect(shelved("k0")).toBeNull();
    expect(shelved("k1")).toMatchObject({ value: 1 });
    expect(shelved("k120")).toMatchObject({ value: 120 });
  });

  it("starts its index again when it can't be read", () => {
    localStorage.setItem("shelf-index", "not json");
    shelve("a", 1);
    expect(index()).toMatch(/^\{"a":\d+\}$/u);
  });

  it("ignores what doesn't belong in its index", () => {
    localStorage.setItem("shelf-index", JSON.stringify({ old: "yesterday" }));
    shelve("a", 1);
    expect(index()).toMatch(/^\{"a":\d+\}$/u);
    localStorage.setItem("shelf-index", "null");
    shelve("b", 2);
    expect(index()).toMatch(/^\{"b":\d+\}$/u);
  });

  it("keeps working when the page's storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => {
      shelve("a", 1);
    }).not.toThrow();
  });
});

describe("lists that rarely change", () => {
  it("shows what's kept and doesn't ask again while it's fresh", async () => {
    shelve("people", ["ana"]);
    const load = vi.fn<() => Promise<string[]>>();
    const onValue = vi.fn<(list: string[]) => void>();
    await cachedList("people", 60_000, load, onValue);
    expect(onValue).toHaveBeenCalledExactlyOnceWith(["ana"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("shows what's kept, then GitHub's answer when it's stale", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    shelve("people", ["ana"]);
    vi.spyOn(Date, "now").mockReturnValue(120_000);
    const onValue = vi.fn<(list: string[]) => void>();
    await cachedList("people", 60_000, () => Promise.resolve(["ana", "bruno"]), onValue);
    expect(onValue.mock.calls).toEqual([[["ana"]], [["ana", "bruno"]]]);
    expect(shelved("people")).toMatchObject({ value: ["ana", "bruno"] });
  });

  it("asks GitHub when nothing is kept", async () => {
    const onValue = vi.fn<(list: string[]) => void>();
    await cachedList("people", 60_000, () => Promise.resolve(["bruno"]), onValue);
    expect(onValue).toHaveBeenCalledExactlyOnceWith(["bruno"]);
  });
});
