import { afterEach, describe, expect, it, vi } from "vitest";

import { backoff, createSender, type Outcome } from "./sender";

afterEach(() => {
  vi.useRealTimers();
});

describe("sending", () => {
  it("waits longer after each failure, up to 30 seconds", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => backoff(n))).toEqual([
      1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
    ]);
  });

  it("sends until nothing's left, waiting after failures unless woken", async () => {
    vi.useFakeTimers();
    const outcomes: Outcome[] = ["sent", "failed", "failed", "sent", "idle"];
    const step = vi.fn<() => Promise<Outcome>>(() => Promise.resolve(outcomes.shift() ?? "idle"));
    const sender = createSender(step);
    sender.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(step).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1000);
    expect(step).toHaveBeenCalledTimes(3);
    // Something new: no waiting the 2 seconds out.
    sender.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(step).toHaveBeenCalledTimes(5);
    sender.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(step).toHaveBeenCalledTimes(6);
  });

  it("takes a step that threw as a failure", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const step = vi.fn<() => Promise<Outcome>>(() =>
      ++calls === 1 ? Promise.reject(new Error("storage")) : Promise.resolve<Outcome>("idle"),
    );
    createSender(step).wake();
    await vi.advanceTimersByTimeAsync(1000);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it("goes on at once when woken while sending", async () => {
    vi.useFakeTimers();
    let release: (o: Outcome) => void = () => {};
    const outcomes: Array<Promise<Outcome>> = [
      new Promise((resolve) => {
        release = resolve;
      }),
      Promise.resolve("idle"),
    ];
    const step = vi.fn<() => Promise<Outcome>>(() => outcomes.shift()!);
    const sender = createSender(step);
    sender.wake();
    sender.wake();
    release("failed");
    await vi.advanceTimersByTimeAsync(0);
    expect(step).toHaveBeenCalledTimes(2);
  });
});
