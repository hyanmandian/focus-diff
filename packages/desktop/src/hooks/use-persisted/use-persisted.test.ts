import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { usePersisted } from "@/hooks/use-persisted/use-persisted";

const isNumber = (v: unknown): v is number => typeof v === "number";

describe("usePersisted", () => {
  it("starts from what's kept, when it's of the kind expected", () => {
    localStorage.setItem("count", "3");
    expect(renderHook(() => usePersisted("count", 0, isNumber)).result.current[0]).toBe(3);
    localStorage.setItem("count", '"three"');
    expect(renderHook(() => usePersisted("count", 0, isNumber)).result.current[0]).toBe(0);
    localStorage.setItem("count", "{");
    expect(renderHook(() => usePersisted("count", 0, isNumber)).result.current[0]).toBe(0);
  });

  it("keeps each change, set or worked out from the last", () => {
    const { result } = renderHook(() => usePersisted("count", 0, isNumber));
    act(() => {
      result.current[1](2);
    });
    act(() => {
      result.current[1]((n) => n + 1);
    });
    expect(result.current[0]).toBe(3);
    expect(localStorage.getItem("count")).toBe("3");
  });

  it("still changes for this window when nothing can be kept", () => {
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => usePersisted("count", 0, isNumber));
    act(() => {
      result.current[1](5);
    });
    expect(result.current[0]).toBe(5);
    blocked.mockRestore();
  });
});
