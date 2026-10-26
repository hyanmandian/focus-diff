import type { OnScreen } from "@focus-diff/core/active-time";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useActiveTime } from "@/hooks/use-active-time/use-active-time";

const T0 = new Date("2026-10-26T12:00:00Z").getTime();

/** Something happens `ms` after the start: a scroll unless said. */
function at(ms: number, event: "scroll" | "keydown" | "selectionchange" = "scroll") {
  vi.setSystemTime(T0 + ms);
  act(() => {
    (event === "selectionchange" ? document : window).dispatchEvent(new Event(event));
  });
}

function hide(hidden: boolean, ms: number) {
  vi.setSystemTime(T0 + ms);
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

let screenNow: OnScreen = [];
const onScreen = () => screenNow;

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  screenNow = [
    ["a.ts", 100],
    ["b.ts", 300],
  ];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useActiveTime", () => {
  it("shares the time between moments of activity among the files on screen, by their size", () => {
    const { result } = renderHook(() => useActiveTime(onScreen, true));
    at(0);
    // Taken in at most once a second.
    at(500, "keydown");
    at(2000, "selectionchange");
    vi.setSystemTime(T0 + 2000);
    expect(result.current("a.ts")).toBe(0.5);
    expect(result.current("b.ts")).toBe(1.5);
    // Let go of once taken.
    expect(result.current("a.ts")).toBe(0);
  });

  it("counts the time up to now when it's taken, for what's on screen since the last activity", () => {
    const { result } = renderHook(() => useActiveTime(onScreen, true));
    at(0);
    screenNow = [["c.ts", 50]];
    at(1000);
    vi.setSystemTime(T0 + 4000);
    expect(result.current("c.ts")).toBe(3);
  });

  it("counts a still moment only up to a limit", () => {
    const { result } = renderHook(() => useActiveTime(onScreen, true));
    screenNow = [["a.ts", 1]];
    at(0);
    at(10 * 60_000);
    expect(result.current("a.ts")).toBe(90);
  });

  it("doesn't count while the window is hidden", () => {
    const { result } = renderHook(() => useActiveTime(onScreen, true));
    screenNow = [["a.ts", 1]];
    at(0);
    hide(true, 2000);
    at(5000);
    vi.setSystemTime(T0 + 9000);
    expect(result.current("a.ts")).toBe(2);
    hide(false, 20_000);
    at(23_000);
    expect(result.current("a.ts")).toBe(3);
  });

  it("counts nothing before any activity, or while off, and keeps what was spent when turned off", () => {
    const { result, rerender } = renderHook(({ on }) => useActiveTime(onScreen, on), { initialProps: { on: false } });
    screenNow = [["a.ts", 1]];
    at(0);
    at(3000);
    expect(result.current("a.ts")).toBe(0);
    rerender({ on: true });
    vi.setSystemTime(T0 + 5000);
    expect(result.current("a.ts")).toBe(0);
    at(5000);
    vi.setSystemTime(T0 + 7000);
    rerender({ on: false });
    // Off: activity isn't taken in.
    at(9000);
    expect(result.current("a.ts")).toBe(2);
  });
});
