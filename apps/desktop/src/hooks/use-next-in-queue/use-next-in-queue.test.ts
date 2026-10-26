import { mockIPC } from "@tauri-apps/api/mocks";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { DIRECTION, useNextInQueue, type Visit } from "@/hooks/use-next-in-queue/use-next-in-queue";
import type { ReviewPull } from "@/utils/bridge/bridge";

const pull = (id: string, number: number): ReviewPull => ({
  id,
  number,
  title: `Change ${number}`,
  repository: { nameWithOwner: "acme/api" },
  author: { login: "mona", name: "Mona Lisa" },
});

/** A queue item as Rust's snapshot has it: enough for the panel's order. */
const item = (id: string, number: number, updatedAt: string, viaTeams?: string[]) => ({
  queueId: "review",
  pr: { ...pull(id, number), updatedAt, isDraft: false },
  events: [],
  ci: null,
  viaTeams,
});

const HERE: Visit = { pr: pull("PR_A", 1), teams: [], queue: "review" };

/** Rust's side: the queues as `items` says (or a failure), and what was asked of it. */
function rust(items: () => Record<string, unknown[]> | Error) {
  const calls: Array<[string, unknown]> = [];
  mockIPC((cmd, args) => {
    calls.push([cmd, args]);
    if (cmd !== "snapshot") return null;
    const queues = items();
    if (queues instanceof Error) throw queues;
    return { items: queues, seen: {} };
  });
  return calls;
}
/** What the window keeps to come back to. */
const kept = (): unknown => JSON.parse(sessionStorage.getItem("review-back") ?? "null");

/** Session storage that won't take what's kept to come back to. */
function refuseToKeepVisits() {
  const setItem = Storage.prototype.setItem.bind(sessionStorage);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string, value: string) => {
    if (key === "review-back") throw new Error("QuotaExceededError");
    setItem(key, value);
  });
}

const asked = (calls: Array<[string, unknown]>, command: string) =>
  calls.filter(([cmd]) => cmd === command).map(([, args]) => args);

describe("useNextInQueue", () => {
  it("finds the one after this in its queue, and again when the window comes forward", async () => {
    let queue = [item("PR_A", 1, "2026-01-03"), item("PR_B", 2, "2026-01-02")];
    rust(() => ({ review: queue }));
    const { result } = renderHook(() => useNextInQueue("review", "PR_A", HERE));
    await waitFor(() => {
      expect(result.current.next?.pr.id).toBe("PR_B");
    });
    queue = [item("PR_A", 1, "2026-01-03"), item("PR_C", 3, "2026-01-02")];
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => {
      expect(result.current.next?.pr.id).toBe("PR_C");
    });
  });

  it("has none without a queue, or when the queue isn't there", async () => {
    const calls = rust(() => ({}));
    const { result, rerender } = renderHook(({ queue }) => useNextInQueue(queue, "PR_A", HERE), {
      initialProps: { queue: null as string | null },
    });
    expect(asked(calls, "snapshot")).toHaveLength(0);
    await expect(result.current.go()).resolves.toBe(false);
    rerender({ queue: "review" });
    await waitFor(() => {
      expect(asked(calls, "snapshot")).toHaveLength(1);
    });
    expect(result.current.next).toBeNull();
  });

  it("keeps what it had when the app can't be asked, or after it's gone", async () => {
    let answer: Record<string, unknown[]> | Error = {
      review: [item("PR_A", 1, "2026-01-03"), item("PR_B", 2, "2026-01-02")],
    };
    rust(() => answer);
    const { result, unmount } = renderHook(() => useNextInQueue("review", "PR_A", HERE));
    await waitFor(() => {
      expect(result.current.next?.pr.id).toBe("PR_B");
    });
    answer = new Error("gone");
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    await act(async () => {});
    expect(result.current.next?.pr.id).toBe("PR_B");
    unmount();
  });

  it("drops an answer that comes after it's gone", async () => {
    const calls = rust(() => ({ review: [item("PR_A", 1, "2026-01-03"), item("PR_B", 2, "2026-01-02")] }));
    const { result, unmount } = renderHook(() => useNextInQueue("review", "PR_A", HERE));
    unmount();
    await waitFor(() => {
      expect(asked(calls, "snapshot")).toHaveLength(1);
    });
    expect(result.current.next).toBeNull();
  });

  it("goes on to the next, counting it as looked at, remembering this one to come back to", async () => {
    const calls = rust(() => ({
      review: [item("PR_A", 1, "2026-01-03"), item("PR_B", 2, "2026-01-02", ["acme/platform"])],
    }));
    const { result } = renderHook(() => useNextInQueue("review", "PR_A", HERE));
    await expect(result.current.go()).resolves.toBe(true);
    expect(asked(calls, "mark_seen")).toEqual([{ queueId: "review", prId: "PR_B" }]);
    expect(asked(calls, "switch_review")).toEqual([
      {
        id: "PR_B",
        repo: "acme/api",
        number: 2,
        teams: ["acme/platform"],
        queue: "review",
        title: "#2 · Change 2 · Mona",
      },
    ]);
    expect(sessionStorage.getItem(DIRECTION)).toBe("forward");
    expect(kept()).toEqual([HERE]);
  });

  it("goes on to the one it found before when the queue can't be asked again", async () => {
    let answer: Record<string, unknown[]> | Error = {
      review: [item("PR_A", 1, "2026-01-03"), item("PR_B", 2, "2026-01-02")],
    };
    const calls = rust(() => answer);
    const { result } = renderHook(() => useNextInQueue("review", "PR_A", null));
    await waitFor(() => {
      expect(result.current.next?.pr.id).toBe("PR_B");
    });
    answer = new Error("gone");
    await expect(result.current.go()).resolves.toBe(true);
    expect(asked(calls, "switch_review")).toEqual([expect.objectContaining({ id: "PR_B", teams: [] })]);
    // Nothing to come back to without where it is.
    expect(sessionStorage.getItem("review-back")).toBeNull();
  });

  it("says the queue's done when there's nothing after this", async () => {
    const calls = rust(() => ({ review: [item("PR_A", 1, "2026-01-03")] }));
    const { result } = renderHook(() => useNextInQueue("review", "PR_A", HERE));
    await waitFor(() => {
      expect(asked(calls, "snapshot")).toHaveLength(1);
    });
    let went = true;
    await act(async () => {
      went = await result.current.go();
    });
    expect(went).toBe(false);
    expect(result.current.next).toBeNull();
    expect(asked(calls, "switch_review")).toEqual([]);
  });

  it("goes back to the one shown before, as a browser's history does", async () => {
    const before: Visit = { pr: pull("PR_Z", 26), teams: ["acme/web"], queue: null };
    sessionStorage.setItem("review-back", JSON.stringify([HERE, before]));
    const calls = rust(() => ({}));
    const { result } = renderHook(() => useNextInQueue(null, "PR_A", HERE));
    expect(result.current.previous).toEqual(before);
    await result.current.back();
    expect(asked(calls, "switch_review")).toEqual([
      expect.objectContaining({ id: "PR_Z", teams: ["acme/web"], queue: null }),
    ]);
    expect(sessionStorage.getItem(DIRECTION)).toBe("back");
    expect(kept()).toEqual([HERE]);
  });

  it("has nothing to go back to at first, or after what was kept is spoiled", async () => {
    const calls = rust(() => ({}));
    const { result } = renderHook(() => useNextInQueue(null, "PR_A", HERE));
    expect(result.current.previous).toBeNull();
    await result.current.back();
    sessionStorage.setItem("review-back", "{not json");
    await result.current.back();
    sessionStorage.setItem("review-back", JSON.stringify({ pr: "PR_Z" }));
    await result.current.back();
    expect(asked(calls, "switch_review")).toEqual([]);
  });

  it("keeps the last 50 it showed, and goes on when they can't be kept", async () => {
    sessionStorage.setItem(
      "review-back",
      JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ ...HERE, pr: pull(`PR_${i}`, i) }))),
    );
    rust(() => ({ review: [item("PR_A", 1, "2026-01-03"), item("PR_B", 2, "2026-01-02")] }));
    const { result } = renderHook(() => useNextInQueue("review", "PR_A", HERE));
    await result.current.go();
    const visits = kept();
    expect(visits).toHaveLength(50);
    expect(visits).toMatchObject({ 0: { pr: { id: "PR_1" } }, 49: HERE });

    refuseToKeepVisits();
    await expect(result.current.go()).resolves.toBe(true);
    await expect(result.current.back()).resolves.toBeUndefined();
  });
});
