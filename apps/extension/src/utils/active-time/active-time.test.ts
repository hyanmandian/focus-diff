import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment happy-dom
import { ContentScriptContext } from "#imports";

import { createActiveTime, creditFor, share, type OnScreen } from "./active-time";

describe("creditFor", () => {
  it("counts a still moment as reading, up to a minute and a half", () => {
    expect(creditFor(800)).toBe(800);
    expect(creditFor(40_000)).toBe(40_000);
    expect(creditFor(30 * 60_000)).toBe(90_000);
    expect(creditFor(-5)).toBe(0);
  });
});

describe("share", () => {
  it("splits the time among the files on screen by how much of it each takes", () => {
    expect(
      share(9000, [
        ["a.ts", 600],
        ["b.ts", 300],
      ]),
    ).toEqual([
      ["a.ts", 6000],
      ["b.ts", 3000],
    ]);
    expect(share(9000, [])).toEqual([]);
  });
});

describe("createActiveTime", () => {
  let hidden = false;
  let onScreen: OnScreen = [];

  const start = () => {
    const ctx = new ContentScriptContext("active-time");
    return createActiveTime(ctx, () => onScreen);
  };
  const at = (ms: number, target: EventTarget = window, type = "scroll") => {
    vi.setSystemTime(ms);
    target.dispatchEvent(new Event(type));
  };
  const setHidden = (value: boolean, ms: number) => {
    hidden = value;
    at(ms, document, "visibilitychange");
  };

  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    onScreen = [["a.ts", 100]];
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    history.replaceState(null, "", `/octo/web/pull/${Math.random().toString(36).slice(2)}/changes`);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the time between moments of activity for the files on screen, once", () => {
    const time = start();
    at(10_000);
    at(10_500);
    onScreen = [
      ["a.ts", 100],
      ["b.ts", 300],
    ];
    at(14_000, document, "selectionchange");
    at(18_000, window, "keydown");
    expect(time.take("a.ts")).toBe(5);
    expect(time.take("b.ts")).toBe(3);
    expect(time.take("a.ts")).toBe(0);
  });

  it("settles the time up to now when a file is taken, and counts nothing before any activity", () => {
    const time = start();
    vi.setSystemTime(5000);
    expect(time.take("a.ts")).toBe(0);
    at(10_000);
    vi.setSystemTime(12_000);
    expect(time.take("a.ts")).toBe(2);
  });

  it("doesn't count time spent away from the page, or a long still moment past its limit", () => {
    const time = start();
    at(10_000);
    setHidden(true, 13_000);
    at(20_000);
    vi.setSystemTime(30_000);
    expect(time.take("a.ts")).toBe(3);
    setHidden(false, 40_000);
    at(40_000 + 10 * 60_000);
    expect(time.take("a.ts")).toBe(90);
  });

  it("starts afresh on another page", () => {
    const time = start();
    at(10_000);
    at(15_000);
    history.replaceState(null, "", "/octo/web/pull/other/changes");
    at(20_000);
    at(22_000);
    expect(time.take("a.ts")).toBe(2);
  });
});
