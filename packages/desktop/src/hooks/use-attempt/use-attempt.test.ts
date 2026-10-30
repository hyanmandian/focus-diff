import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import { useAttempt } from "@/hooks/use-attempt/use-attempt";

describe("useAttempt", () => {
  it("is busy while the work runs and clears an earlier error", async () => {
    const { result } = renderHook(() => useAttempt());
    act(() => {
      result.current.setError("Earlier");
    });
    let finish = () => {};
    let running: Promise<void> = Promise.resolve();
    act(() => {
      running = result.current.attempt(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    });
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBeNull();
    await act(async () => {
      finish();
      await running;
    });
    expect(result.current.busy).toBe(false);
  });

  it("keeps what went wrong", async () => {
    const { result } = renderHook(() => useAttempt());
    await act(() => result.current.attempt(() => Promise.reject(new Error("Network down"))));
    expect(result.current.error).toBe("Network down");
    expect(result.current.busy).toBe(false);
  });
});
