import { useSyncExternalStore } from "react";

import { bridge, type AuthStatus } from "@/utils/bridge/bridge";
import { loadConfig, type Config } from "@/utils/config/config";
import type { Item } from "@/utils/engine/engine";

export type Status = { phase: "idle" | "loading" | "error"; error?: string; updatedAt: number };

export type RunPull = {
  id: string;
  title: string;
  repo: string;
  number: number;
  url: string;
  minutes: number;
  again: boolean;
};

export type ReviewRun = {
  run: {
    session: string;
    name: string;
    minutes: number;
    startedAt: number;
    pulls: RunPull[];
    left: number;
    overBy: number;
  };
  endsAt: number;
};

type Live = {
  ready: boolean;
  signedIn: boolean;
  me: string | null;
  items: Record<string, Item[]>;
  status: Status;
  arrivals: string[];
  seen: Record<string, true>;
  dismissed: Record<string, true>;
  review: ReviewRun | null;
};

export type Snapshot = Omit<Live, "arrivals"> & {
  auth: AuthStatus | null;
  config: Config | null;
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
  review: null,
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
  if (live.ready && !live.signedIn && !snapshot.auth) set({ auth: await bridge.authStatus() });
  if (live.signedIn && snapshot.auth && !snapshot.auth.signed_in) set({ auth: null });
}

export const isUnread = (item: Item, seen = snapshot.seen) => item.events.some((e) => !seen[e.key]);

export const refresh = (force = false) => bridge.refresh(force);

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

export function dismiss(item: Item) {
  set({
    items: {
      ...snapshot.items,
      [item.queueId]: (snapshot.items[item.queueId] ?? []).filter((i) => i.pr.id !== item.pr.id),
    },
  });
  void bridge.dismiss(item.queueId, item.pr.id);
}

export function restore(item: Item) {
  const list = snapshot.items[item.queueId] ?? [];
  if (!list.some((i) => i.pr.id === item.pr.id)) set({ items: { ...snapshot.items, [item.queueId]: [...list, item] } });
  void bridge.restore(item.queueId, item.pr.id);
}

export function clearArrival(prId: string) {
  if (!snapshot.arrivals.has(prId)) return;
  const arrivals = new Set(snapshot.arrivals);
  arrivals.delete(prId);
  set({ arrivals });
  void bridge.clearArrival(prId);
}

async function reloadConfig() {
  set({ config: await loadConfig() });
}

export async function start() {
  let followed = false;
  bridge.on<Live>("snapshot", (live) => {
    followed = true;
    void follow(live);
  });
  bridge.on<string>("file-changed", (name) => {
    if (name === "config") void reloadConfig();
  });
  void bridge.on("panel-shown", () => void refresh());
  const [config, live] = await Promise.all([loadConfig(), bridge.snapshot<Live>()]);
  set({ config });
  if (!followed) await follow(live);
  performance.mark("ready");
}
