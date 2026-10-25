// The panel's view of the app's live state. The queues are refreshed, compared and notified about
// on the Rust side (src-tauri/src/watch.rs), which keeps going with the panel closed; this follows
// its snapshots and passes clicks back. React reads it through useStore (useSyncExternalStore).

import { useSyncExternalStore } from "react";
import { bridge, type AuthStatus } from "./bridge";
import { loadConfig, type Config } from "./config";
import type { Item } from "./engine";

export type Status = { phase: "idle" | "loading" | "error"; error?: string; updatedAt: number };

/** What Rust sends: see `State::snapshot` in watch.rs. */
type Live = {
  ready: boolean;
  signedIn: boolean;
  me: string | null;
  items: Record<string, Item[]>;
  status: Status;
  arrivals: string[];
  seen: Record<string, true>;
  dismissed: Record<string, true>;
};

export type Snapshot = Omit<Live, "arrivals"> & {
  /** For connecting GitHub, when no one is signed in. */
  auth: AuthStatus | null;
  config: Config | null;
  /** PR ids with something new to call out, until the panel shows them. */
  arrivals: Set<string>;
};

let snapshot: Snapshot = {
  ready: false,
  signedIn: false,
  auth: null,
  config: null,
  me: null,
  items: {},
  status: { phase: "idle", updatedAt: 0 },
  arrivals: new Set(),
  seen: {},
  dismissed: {},
};
const listeners = new Set<() => void>();

function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useStore = () => useSyncExternalStore(subscribe, () => snapshot);

async function follow(live: Live) {
  set({ ...live, arrivals: new Set(live.arrivals) });
  // Connecting GitHub needs to know what's possible on this computer.
  if (live.ready && !live.signedIn && !snapshot.auth) set({ auth: await bridge.authStatus() });
  if (live.signedIn && snapshot.auth && !snapshot.auth.signed_in) set({ auth: null });
}

export const isUnread = (item: Item, seen = snapshot.seen) => item.events.some((e) => !seen[e.key]);

export const refresh = (force = false) => bridge.refresh(force);

/** Clicking a card counts as having looked at it. Shown at once, saved by Rust. */
export function markSeen(item: Item) {
  const seen = { ...snapshot.seen };
  for (const e of item.events) seen[e.key] = true;
  const arrivals = new Set(snapshot.arrivals);
  arrivals.delete(item.pr.id);
  set({ seen, arrivals });
  void bridge.markSeen(item.queueId, item.pr.id);
}

export function markQueueSeen(queueId: string) {
  const seen = { ...snapshot.seen };
  for (const item of snapshot.items[queueId] ?? []) for (const e of item.events) seen[e.key] = true;
  set({ seen });
  void bridge.markQueueSeen(queueId);
}

/** Takes a PR off a queue by hand (merged: seen; others: ignored), until it leaves the search. */
export function dismiss(item: Item) {
  set({ items: { ...snapshot.items, [item.queueId]: (snapshot.items[item.queueId] ?? []).filter((i) => i.pr.id !== item.pr.id) } });
  void bridge.dismiss(item.queueId, item.pr.id);
}

export function clearArrival(prId: string) {
  if (!snapshot.arrivals.has(prId)) return;
  const arrivals = new Set(snapshot.arrivals);
  arrivals.delete(prId);
  set({ arrivals });
  void bridge.clearArrival(prId);
}

export async function start() {
  void bridge.on<Live>("snapshot", (live) => void follow(live));
  void bridge.on<string>("file-changed", (name) => {
    if (name === "config") void loadConfig().then((config) => set({ config }));
  });
  void bridge.on("panel-shown", () => void refresh());
  const [config, live] = await Promise.all([loadConfig(), bridge.snapshot<Live>()]);
  set({ config });
  await follow(live);
  // When the panel had its queues to show, for measuring how fast it opens.
  performance.mark("ready");
}
