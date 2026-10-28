import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import type { AuthStatus } from "@/utils/bridge/bridge";
import { defaultConfig } from "@/utils/config/config";
import type { Item } from "@/utils/engine/engine";
import { emit, mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Args } from "@/utils/platform/platform";

const item = (queueId: string, id: string, keys: string[] = []): Item => ({
  queueId,
  pr: {
    id,
    number: 1,
    title: "Fix",
    url: "https://github.com/acme/app/pull/1",
    isDraft: false,
    state: "OPEN",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    mergedAt: null,
    headRefOid: "abc",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    repository: { nameWithOwner: "acme/app" },
    author: { login: "ana" },
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    comments: 0,
  },
  events: keys.map((key) => ({ key, kind: "comment", at: 0, who: { login: "ana" } })),
  ci: null,
});

const live = (extra: Record<string, unknown> = {}) => ({
  ready: true,
  signedIn: true,
  me: "me",
  items: { review: [item("review", "PR_1", ["e1", "e2"]), item("review", "PR_2", ["e3"])] },
  status: { phase: "idle", updatedAt: 1 },
  arrivals: ["PR_1"],
  seen: { e1: true },
  dismissed: {},
  review: null,
  ...extra,
});

const config = defaultConfig();
const signedOut: AuthStatus = { signed_in: false, source: null, login: null, device_flow: true, gh_available: false };

function rust(snapshot: Record<string, unknown> = live(), auth: AuthStatus = signedOut) {
  const calls: Array<[string, Args | undefined]> = [];
  mockCommands((cmd, args) => {
    calls.push([cmd, args]);
    if (cmd === "snapshot") return snapshot;
    if (cmd === "auth_status") return auth;
    if (cmd === "read_file") return JSON.stringify(config);
    return null;
  });
  return { sent: (cmd: string) => calls.filter(([c]) => c === cmd).map(([, args]) => args) };
}

function load() {
  vi.resetModules();
  return import("@/utils/store/store");
}

describe("the panel's store", () => {
  it("starts empty", async () => {
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    expect(result.current).toMatchObject({ ready: false, items: {}, config: null, auth: null });
  });

  it("starts from Rust's snapshot and the config, and notes when it's ready", async () => {
    rust();
    const mark = vi.spyOn(performance, "mark");
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    expect(result.current.items.review).toHaveLength(2);
    expect(result.current.arrivals).toEqual(new Set(["PR_1"]));
    expect(result.current.config).toEqual(config);
    expect(result.current.auth).toBeNull();
    expect(mark).toHaveBeenCalledWith("ready");
  });

  it("keeps a newer snapshot that comes while the first is on its way", async () => {
    let release = () => {};
    const configRead = new Promise<string>((resolve) => {
      release = () => {
        resolve(JSON.stringify(config));
      };
    });
    mockCommands((cmd) => {
      if (cmd === "snapshot") return live();
      if (cmd === "read_file") return configRead;
      return null;
    });
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    const started = store.start();
    await act(() => emit("snapshot", live({ items: { review: [item("review", "PR_3")] } })));
    await act(async () => {
      release();
      await started;
    });
    expect(result.current.items.review?.map((i) => i.pr.id)).toEqual(["PR_3"]);
  });

  it("asks what's possible for connecting GitHub when no one is signed in, and forgets it once someone is", async () => {
    const { sent } = rust(live({ signedIn: false }));
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    expect(result.current.auth).toEqual(signedOut);
    await act(() => emit("snapshot", live({ signedIn: false })));
    expect(sent("auth_status")).toHaveLength(1);
    await act(() => emit("snapshot", live()));
    await waitFor(() => {
      expect(result.current.auth).toBeNull();
    });
  });

  it("keeps the connection state while signed in", async () => {
    rust(live({ signedIn: false }), { ...signedOut, signed_in: true });
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    await act(() => emit("snapshot", live()));
    expect(result.current.auth).toMatchObject({ signed_in: true });
  });

  it("doesn't ask about connecting before Rust is ready", async () => {
    const { sent } = rust(live({ ready: false, signedIn: false }));
    const store = await load();
    await store.start();
    expect(sent("auth_status")).toHaveLength(0);
  });

  it("follows Rust's snapshots, the config's changes, and the panel opening", async () => {
    const { sent } = rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());

    await act(() => emit("snapshot", live({ items: {} })));
    await waitFor(() => {
      expect(result.current.items).toEqual({});
    });

    await act(() => emit("file-changed", "pace"));
    expect(sent("read_file")).toHaveLength(1);
    await act(() => emit("file-changed", "config"));
    await waitFor(() => {
      expect(sent("read_file")).toHaveLength(2);
    });

    await act(() => emit("panel-shown"));
    await waitFor(() => {
      expect(sent("refresh")).toEqual([{ force: false }]);
    });
  });

  it("refreshes when asked, by force or not", async () => {
    const { sent } = rust();
    const store = await load();
    await store.refresh(true);
    await store.refresh();
    expect(sent("refresh")).toEqual([{ force: true }, { force: false }]);
  });
});

describe("what's been seen", () => {
  it("knows an item is unread while one of its events isn't seen", async () => {
    const store = await load();
    const unread = item("review", "PR_1", ["e1", "e2"]);
    expect(store.isUnread(unread, { e1: true })).toBe(true);
    expect(store.isUnread(unread, { e1: true, e2: true })).toBe(false);
    expect(store.isUnread(unread)).toBe(true);
  });

  it("marks an item seen at once and tells Rust", async () => {
    const { sent } = rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    act(() => {
      store.markSeen(result.current.items.review![0]!);
    });
    expect(result.current.seen).toEqual({ e1: true, e2: true });
    expect(result.current.arrivals.size).toBe(0);
    expect(store.isUnread(result.current.items.review![0]!)).toBe(false);
    expect(sent("mark_seen")).toEqual([{ queueId: "review", prId: "PR_1" }]);
  });

  it("marks a whole queue seen", async () => {
    const { sent } = rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    act(() => {
      store.markQueueSeen("review");
      store.markQueueSeen("other");
    });
    expect(result.current.seen).toEqual({ e1: true, e2: true, e3: true });
    expect(sent("mark_queue_seen")).toEqual([{ queueId: "review" }, { queueId: "other" }]);
  });

  it("clears an arrival once shown, and only once", async () => {
    const { sent } = rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    act(() => {
      store.clearArrival("PR_1");
      store.clearArrival("PR_1");
    });
    expect(result.current.arrivals.size).toBe(0);
    expect(sent("clear_arrival")).toEqual([{ prId: "PR_1" }]);
  });
});

describe("dismissing", () => {
  it("takes an item off its queue at once, and puts it back on undo", async () => {
    const { sent } = rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    const first = result.current.items.review![0]!;
    act(() => {
      store.dismiss(first);
    });
    expect(result.current.items.review!.map((i) => i.pr.id)).toEqual(["PR_2"]);
    act(() => {
      store.restore(first);
    });
    expect(result.current.items.review!.map((i) => i.pr.id)).toEqual(["PR_2", "PR_1"]);
    expect(sent("dismiss")).toEqual([{ queueId: "review", prId: "PR_1" }]);
    expect(sent("restore")).toEqual([{ queueId: "review", prId: "PR_1" }]);
  });

  it("doesn't put back twice what's still there", async () => {
    rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    await act(() => store.start());
    act(() => {
      store.restore(result.current.items.review![0]!);
    });
    expect(result.current.items.review).toHaveLength(2);
  });

  it("handles a queue it has no items for", async () => {
    rust();
    const store = await load();
    const { result } = renderHook(() => store.useStore());
    const stray = item("gone", "PR_9");
    act(() => {
      store.restore(stray);
    });
    expect(result.current.items.gone).toEqual([stray]);
    act(() => {
      store.dismiss(item("other", "PR_8"));
    });
    expect(result.current.items.other).toEqual([]);
  });
});
