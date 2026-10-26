// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeUpList, DIGEST, HIDDEN_ROWS } from "./github-virtual-list";

interface Options {
  count: number;
  gap: number;
  estimateSize: (index: number) => number;
  getItemKey: (index: number) => unknown;
}

const digest = (index: number) => `d${index}`.padEnd(64, "0");
const short = (index: number) => digest(index).slice(0, DIGEST);
const optionsFor = (count: number): Options => ({
  count,
  gap: 16,
  estimateSize: () => 560,
  getItemKey: (index) => `key-${index}`,
});

/** A list like GitHub's: TanStack Virtual's instance, found through React's records on the list's element. */
const fakeList = (count: number, drawn: number[], sizes: Record<number, number> = {}) => {
  const cache = new Map<unknown, number>(Object.entries(sizes).map(([index, size]) => [`key-${index}`, size]));
  const resized: [number, number][] = [];
  const virtualizer = {
    options: optionsFor(count),
    itemSizeCache: cache,
    getVirtualItems: () => [],
    resizeItem: (index: number, size: number) => {
      resized.push([index, size]);
      cache.set(`key-${index}`, size);
    },
    setOptions: (options: Options) => {
      virtualizer.options = options;
    },
  };
  const list = document.createElement("div");
  for (const index of drawn) list.append(row(index));
  attachFiber(list, virtualizer);
  document.body.append(list);
  return { list, virtualizer, resized, cache };
};

const attachFiber = (list: Element, virtualizer: unknown) => {
  Reflect.set(list, "__reactFiber$test", {
    memoizedState: { memoizedState: "not it", next: null },
    return: { memoizedState: { memoizedState: { current: virtualizer }, next: null }, return: null },
  });
};

const row = (index: number, own = digest(index)) => {
  const element = document.createElement("div");
  element.dataset.index = String(index);
  element.dataset.pathDigest = own;
  return element;
};

const hide = (count: number, ...indexes: number[]) => {
  document.documentElement.setAttribute(
    HIDDEN_ROWS,
    [count, ...indexes.map((index) => `${index}:${short(index)}`)].join(" "),
  );
};

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const padding = (list: HTMLElement) =>
  [...list.querySelectorAll<HTMLElement>(":scope > *")].map((each) => each.style.paddingBottom);

let stop = () => {};
beforeEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(HIDDEN_ROWS);
});
afterEach(() => {
  stop();
});

describe("closeUpList", () => {
  it("closes the list up around hidden files and opens it again", async () => {
    const { list, virtualizer, resized } = fakeList(8, [0, 1, 2], { 3: 300, 4: 200, 6: 100 });
    stop = closeUpList();
    hide(8, 1, 3, 5);
    await settle();

    expect(virtualizer.options.gap).toBe(0);
    expect(virtualizer.options.estimateSize(1)).toBe(0);
    expect(virtualizer.options.estimateSize(0)).toBe(576);
    expect(padding(list)).toEqual(["16px", "", "16px"]);
    expect(resized).toEqual([
      [3, 0],
      [4, 216],
      [5, 0],
      [6, 116],
    ]);

    // GitHub sets its options again on every render; they're closed up again.
    virtualizer.setOptions(optionsFor(8));
    expect(virtualizer.options.gap).toBe(0);

    // Hiding one more while closed up keeps its size without the padding.
    resized.length = 0;
    hide(8, 1, 3, 4, 5);
    await settle();
    expect(resized).toEqual([[4, 0]]);

    resized.length = 0;
    document.documentElement.removeAttribute(HIDDEN_ROWS);
    await settle();
    expect(virtualizer.options.gap).toBe(16);
    expect(padding(list)).toEqual(["", "", ""]);
    expect(resized).toEqual([
      [3, 300],
      [4, 200],
      [5, 560],
      [6, 100],
    ]);
  });

  it("closes up a list already hidden from when it was found, and pads rows drawn later", async () => {
    hide(4, 1);
    const { list } = fakeList(4, [0, 1]);
    stop = closeUpList();
    expect(padding(list)).toEqual(["16px", ""]);
    list.append(row(2));
    await settle();
    expect(padding(list)).toEqual(["16px", "", "16px"]);
  });

  it("leaves the list as it is when the rows on the page aren't the files meant", async () => {
    const { list, virtualizer } = fakeList(4, [0, 1, 2]);
    stop = closeUpList();
    hide(5, 1);
    await settle();
    expect(virtualizer.options.gap).toBe(16);

    document.documentElement.setAttribute(HIDDEN_ROWS, `4 1:${short(2)}`);
    await settle();
    expect(virtualizer.options.gap).toBe(16);

    document.documentElement.setAttribute(HIDDEN_ROWS, `4 3:${short(0)}`);
    await settle();
    expect(virtualizer.options.gap).toBe(16);
    expect(padding(list)).toEqual(["", "", ""]);

    document.documentElement.setAttribute(HIDDEN_ROWS, "4 odd 1: :x");
    await settle();
    expect(virtualizer.options.gap).toBe(16);
  });

  it("opens the list again when a row drawn later isn't the file meant", async () => {
    const { list, virtualizer } = fakeList(4, [0, 1]);
    stop = closeUpList();
    hide(4, 1);
    await settle();
    expect(virtualizer.options.gap).toBe(0);
    list.append(row(3, digest(1)));
    await settle();
    expect(virtualizer.options.gap).toBe(16);
    expect(padding(list)).toEqual(["", "", ""]);
  });

  it("follows GitHub to a new list and gives the old one its own options back", async () => {
    const first = fakeList(4, [0, 1]);
    stop = closeUpList();
    hide(4, 1);
    await settle();
    first.list.remove();
    await settle();
    expect(first.virtualizer.options.gap).toBe(16);
    const second = fakeList(4, [0, 1]);
    await settle();
    expect(first.virtualizer.options.gap).toBe(16);
    expect(second.virtualizer.options.gap).toBe(0);
    expect(padding(second.list)).toEqual(["16px", ""]);

    // The same list drawn in a new element keeps its options.
    second.list.remove();
    const again = document.createElement("div");
    again.append(row(0), row(1));
    attachFiber(again, second.virtualizer);
    document.body.append(again);
    await settle();
    expect(second.virtualizer.options.gap).toBe(0);
    expect(padding(again)).toEqual(["16px", ""]);

    // A list it can't reach gets nothing, and the one before gets its options back.
    again.remove();
    const unreachable = document.createElement("div");
    unreachable.append(row(0), row(1));
    document.body.append(unreachable);
    await settle();
    expect(second.virtualizer.options.gap).toBe(16);
    expect(padding(unreachable)).toEqual(["", ""]);
  });

  it("does nothing without a list, or with a list whose records hold no virtualizer", async () => {
    stop();
    stop = closeUpList();
    hide(2, 1);
    await settle();
    stop();

    const list = document.createElement("div");
    list.append(row(0), row(1));
    const near = (change: Record<string, unknown>) => ({
      options: { gap: 16, estimateSize: () => 1, getItemKey: () => 1 },
      getVirtualItems: () => [],
      resizeItem: () => {},
      setOptions: () => {},
      ...change,
    });
    const lookalikes = [
      { options: "none" },
      near({ getVirtualItems: null }),
      near({ resizeItem: null }),
      near({ setOptions: null }),
      near({ options: { gap: "16", estimateSize: () => 1, getItemKey: () => 1 } }),
      near({ options: { gap: 16, getItemKey: () => 1 } }),
      near({ options: { gap: 16, estimateSize: () => 1 } }),
    ];
    let hook: Record<string, unknown> | null = null;
    for (const value of lookalikes) hook = { memoizedState: value, next: hook };
    Reflect.set(list, "__reactFiber$test", { memoizedState: hook, return: null });
    document.body.append(list);
    stop = closeUpList();
    await settle();
    expect(padding(list)).toEqual(["", ""]);
  });

  it("sizes files without measurements from the list's estimate", async () => {
    const { virtualizer, resized } = fakeList(4, [0]);
    Reflect.deleteProperty(virtualizer, "itemSizeCache");
    stop = closeUpList();
    hide(4, 2);
    await settle();
    expect(resized).toEqual([[2, 0]]);
    resized.length = 0;
    document.documentElement.removeAttribute(HIDDEN_ROWS);
    await settle();
    expect(resized).toEqual([[2, 560]]);
  });
});
