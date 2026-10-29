import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useNewChanges, type NewChanges } from "@/hooks/use-new-changes/use-new-changes";
import { mockCommands } from "@/utils/fake-platform/fake-platform";

const T0 = new Date("2026-10-26T12:00:00Z").getTime();
const UPDATED = "2026-10-26T11:00:00Z";

type Pull = { head: string; updated?: string };

const response = (pr: Pull) => ({
  status: 200,
  body: JSON.stringify({ head: { sha: pr.head }, updated_at: pr.updated ?? UPDATED, user: null }),
});

function github(answer: () => Pull | Error | Promise<Pull>) {
  const looks: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd !== "github") return null;
    looks.push(args);
    const pr = answer();
    if (pr instanceof Error) throw pr;
    return pr instanceof Promise ? pr.then(response) : response(pr);
  });
  return looks;
}

function inTurn(...answers: Array<Pull | Error>) {
  return () => (answers.length > 1 ? answers.shift()! : answers[0]!);
}

const LOOK = { method: "GET", path: "/repos/acme/api/pulls/42", body: null, accept: null };

const NOTHING = () => {};

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

type Props = { head: string | undefined; updatedAt: string | undefined; onActivity: () => void };
const watch = (props: Partial<Props> = {}) =>
  renderHook<NewChanges | null, Props>((p) => useNewChanges("acme/api", 42, p.head, p.updatedAt, p.onActivity), {
    initialProps: { head: "abc", updatedAt: UPDATED, onActivity: () => {}, ...props },
  });

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useNewChanges", () => {
  it("looks every half minute and says when there are new commits", async () => {
    const paths = github(() => ({ head: "def" }));
    const { result } = watch();
    expect(result.current).toBeNull();
    await wait(29_000);
    expect(paths).toEqual([]);
    await wait(1000);
    expect(paths).toEqual([LOOK]);
    expect(result.current).toEqual({ head: "def", at: T0 + 30_000 });
  });

  it("looks when the window comes forward", async () => {
    const paths = github(() => ({ head: "abc" }));
    watch();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await wait(0);
    expect(paths).toHaveLength(1);
  });

  it("lets other activity come in on its own", async () => {
    let updated = UPDATED;
    github(() => ({ head: "abc", updated }));
    const first = vi.fn<() => void>();
    const latest = vi.fn<() => void>();
    const { result, rerender } = watch({ onActivity: first });
    await wait(30_000);
    expect(first).not.toHaveBeenCalled();
    updated = "2026-10-26T11:30:00Z";
    rerender({ head: "abc", updatedAt: UPDATED, onActivity: latest });
    await wait(30_000);
    expect(latest).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
    rerender({ head: "abc", updatedAt: undefined, onActivity: latest });
    await wait(30_000);
    expect(latest).toHaveBeenCalledOnce();
  });

  it("doesn't look while the window is hidden, or without a head, or twice at once", async () => {
    const paths = github(() => new Promise<never>(NOTHING));
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { rerender } = watch();
    await wait(30_000);
    expect(paths).toHaveLength(0);
    visibility.mockReturnValue("visible");
    await wait(30_000);
    await wait(30_000);
    expect(paths).toHaveLength(1);
    rerender({ head: undefined, updatedAt: undefined, onActivity: () => {} });
    await wait(60_000);
    expect(paths).toHaveLength(1);
  });

  it("tries again after a failed look", async () => {
    github(inTurn(new Error("offline"), { head: "def" }));
    const { result } = watch();
    await wait(30_000);
    expect(result.current).toBeNull();
    await wait(30_000);
    expect(result.current?.head).toBe("def");
  });

  it("forgets the new commits once they're shown, but not for another head", async () => {
    github(() => ({ head: "def" }));
    const { result, rerender } = watch();
    await wait(30_000);
    expect(result.current?.head).toBe("def");
    rerender({ head: "xyz", updatedAt: UPDATED, onActivity: () => {} });
    expect(result.current?.head).toBe("def");
    rerender({ head: "def", updatedAt: UPDATED, onActivity: () => {} });
    expect(result.current).toBeNull();
  });

  it("drops an answer that comes after it's gone", async () => {
    let answer: (pr: Pull) => void = NOTHING;
    github(
      () =>
        new Promise<Pull>((resolve) => {
          answer = resolve;
        }),
    );
    const { result, rerender } = watch();
    await wait(30_000);
    rerender({ head: "abd", updatedAt: UPDATED, onActivity: () => {} });
    answer({ head: "def" });
    await wait(0);
    expect(result.current).toBeNull();
  });
});
