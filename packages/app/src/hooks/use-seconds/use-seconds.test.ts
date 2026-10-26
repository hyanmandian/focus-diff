import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useSeconds } from "./use-seconds";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useSeconds", () => {
  it("is 0 without a moment", () => {
    const { result } = renderHook(() => useSeconds(null));
    expect(result.current).toBe(0);
  });

  it("counts whole seconds since a moment, once a second", () => {
    const since = Date.now() - 2500;
    const { result } = renderHook(() => useSeconds(since));
    expect(result.current).toBe(2);
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(3);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(8);
  });

  it("never counts below 0, and stops when the moment goes", () => {
    const start = Date.now() + 5000;
    const { result, rerender } = renderHook<number, { since: number | null }>(({ since }) => useSeconds(since), {
      initialProps: { since: start },
    });
    expect(result.current).toBe(0);
    rerender({ since: null });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
