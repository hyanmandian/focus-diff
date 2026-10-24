// The panel's live state: refreshes the queues on the configured rhythm, remembers what's been seen,
// notifies, and keeps the tray icon current. React reads it through useStore (useSyncExternalStore).

import { useSyncExternalStore } from "react";
import { bridge, GitHubError, type AuthStatus } from "./bridge";
import { loadConfig, type Config } from "./config";
import { EVENTS, firstName } from "./copy";
import { fetchMerged, fetchQueues, freshEvents, itemsFor, type CiState, type Item, type PullRequest } from "./engine";

/** What's remembered between launches (state.json). */
type Persisted = {
  /** Event keys of cards you clicked. */
  seen: Record<string, true>;
  /** Every event key last time, to tell what's new. Null before the first refresh. */
  keys: string[] | null;
  /** Each PR's CI state last time, to tell when it passes again. */
  ci: Record<string, { oid: string; state: CiState | null }>;
  /** "queueId:prId" taken off a queue by hand: merged ones marked as seen, others ignored. */
  dismissed: Record<string, true>;
};

export type Status = { phase: "idle" | "loading" | "error"; error?: string; updatedAt: number };

export type Snapshot = {
  ready: boolean;
  auth: AuthStatus | null;
  config: Config | null;
  me: string | null;
  items: Record<string, Item[]>;
  status: Status;
  /** PR ids with something new to call out, until the panel is open to show it. */
  arrivals: Set<string>;
  seen: Record<string, true>;
  dismissed: Record<string, true>;
};

const MERGED_EVERY = 5 * 60_000;
const MAX_NOTIFICATIONS = 4;

let snapshot: Snapshot = {
  ready: false,
  auth: null,
  config: null,
  me: null,
  items: {},
  status: { phase: "idle", updatedAt: 0 },
  arrivals: new Set(),
  seen: {},
  dismissed: {},
};
let persisted: Persisted = { seen: {}, keys: null, ci: {}, dismissed: {} };
const merged = new Map<string, { at: number; prs: PullRequest[] }>();
const listeners = new Set<() => void>();
let polling: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function set(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useStore = () => useSyncExternalStore(subscribe, () => snapshot);

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void bridge.writeFile("state", JSON.stringify(persisted)), 400);
}

async function loadPersisted() {
  try {
    const text = await bridge.readFile("state");
    const raw = text ? (JSON.parse(text) as Partial<Persisted>) : {};
    persisted = {
      seen: raw.seen && typeof raw.seen === "object" ? raw.seen : {},
      keys: Array.isArray(raw.keys) ? raw.keys.filter((k) => typeof k === "string") : null,
      ci: raw.ci && typeof raw.ci === "object" ? raw.ci : {},
      dismissed: raw.dismissed && typeof raw.dismissed === "object" ? raw.dismissed : {},
    };
  } catch {
    // A broken state file only costs what's been seen.
  }
}

// MARK: Refreshing

export function refresh(force = false): Promise<void> {
  if (polling) return polling;
  const { config, me } = snapshot;
  if (!config || !me) return Promise.resolve();
  if (!force && Date.now() - snapshot.status.updatedAt < config.pollSeconds * 1000 - 5_000) return Promise.resolve();
  polling = (async () => {
    set({ status: { ...snapshot.status, phase: "loading" } });
    try {
      const found = await fetchQueues(config.queues, me);
      for (const queue of config.queues.filter((q) => q.enabled && q.kind === "merged")) {
        const cached = merged.get(queue.id);
        if (force || !cached || Date.now() - cached.at > MERGED_EVERY) merged.set(queue.id, { at: Date.now(), prs: await fetchMerged(queue, me) });
        found.set(queue.id, merged.get(queue.id)?.prs ?? []);
      }
      apply(config, me, found);
      set({ status: { phase: "idle", updatedAt: Date.now() } });
    } catch (error) {
      const message = error instanceof GitHubError && error.status === 401 ? "GitHub signed you out" : error instanceof Error ? error.message : String(error);
      set({ status: { ...snapshot.status, phase: "error", error: message } });
    } finally {
      polling = null;
    }
  })();
  return polling;
}

function apply(config: Config, me: string, found: Map<string, PullRequest[]>) {
  const items: Record<string, Item[]> = {};
  for (const queue of config.queues) {
    if (!queue.enabled) continue;
    items[queue.id] = itemsFor(queue, found.get(queue.id) ?? [], me, persisted.ci).filter((item) => !persisted.dismissed[`${queue.id}:${item.pr.id}`]);
  }
  const all = Object.values(items).flat();
  const keys = new Set(all.flatMap((item) => item.events.map((e) => e.key)));
  const arrivals = new Set(snapshot.arrivals);
  let animate = false;
  if (persisted.keys) {
    const fresh = freshEvents(all, config.queues, new Set(persisted.keys), persisted.seen);
    notify(fresh);
    for (const { item } of fresh) arrivals.add(item.pr.id);
    animate = fresh.length > 0;
  }
  // The first refresh notifies about nothing: it's all old news. Cards still show as unclicked.
  persisted.keys = [...keys];
  // Forget what's gone, so the state stays small.
  for (const key of Object.keys(persisted.seen)) if (!keys.has(key)) delete persisted.seen[key];
  // A PR taken off a queue by hand stays off while it still turns up in that queue's search.
  for (const key of Object.keys(persisted.dismissed)) {
    const [queueId = "", prId] = key.split(":");
    const prs = found.get(queueId);
    if (prs && !prs.some((pr) => pr.id === prId)) delete persisted.dismissed[key];
  }
  persisted.ci = Object.fromEntries(all.map((item) => [item.pr.id, { oid: item.pr.headRefOid, state: item.ci }]));
  save();
  set({ items, arrivals, seen: { ...persisted.seen }, dismissed: { ...persisted.dismissed } });
  updateTray(animate);
}

function notify(fresh: ReturnType<typeof freshEvents>) {
  // One sound for the batch, not one per notification.
  let sound = snapshot.config?.sound ?? false;
  for (const { item, event } of fresh.slice(0, MAX_NOTIFICATIONS)) {
    const { pr } = item;
    const by = event.kind === "new" ? ` · by ${firstName(pr.author)}` : "";
    void bridge.notify(EVENTS[event.kind].say(firstName(event.who)), `${pr.title}\n${pr.repository.nameWithOwner}#${pr.number}${by}`, sound);
    sound = false;
  }
  const rest = fresh.length - MAX_NOTIFICATIONS;
  if (rest > 0) void bridge.notify(`${rest} more pull request updates`, "Open Focus Diff Pro to see them", sound);
}

export const isUnread = (item: Item, seen = snapshot.seen) => item.events.some((e) => !seen[e.key]);

let lastCount = -1;
function updateTray(animate: boolean) {
  const count = new Set(Object.values(snapshot.items).flat().filter((item) => isUnread(item)).map((item) => item.pr.id)).size;
  if (count === lastCount && !animate) return;
  lastCount = count;
  void bridge.trayUpdate(count, animate);
}

// MARK: Actions

/** Clicking a card counts as having looked at it. */
export function markSeen(item: Item) {
  for (const e of item.events) persisted.seen[e.key] = true;
  const arrivals = new Set(snapshot.arrivals);
  arrivals.delete(item.pr.id);
  save();
  set({ seen: { ...persisted.seen }, arrivals });
  updateTray(false);
}

export function markQueueSeen(queueId: string) {
  for (const item of snapshot.items[queueId] ?? []) for (const e of item.events) persisted.seen[e.key] = true;
  save();
  set({ seen: { ...persisted.seen } });
  updateTray(false);
}

/** Takes a PR off a queue by hand (merged: seen; others: ignored), until it leaves the search. */
export function dismiss(item: Item) {
  persisted.dismissed[`${item.queueId}:${item.pr.id}`] = true;
  markSeen(item);
  const items = { ...snapshot.items, [item.queueId]: (snapshot.items[item.queueId] ?? []).filter((i) => i.pr.id !== item.pr.id) };
  set({ items, dismissed: { ...persisted.dismissed } });
  updateTray(false);
}

export function clearArrival(prId: string) {
  if (!snapshot.arrivals.has(prId)) return;
  const arrivals = new Set(snapshot.arrivals);
  arrivals.delete(prId);
  set({ arrivals });
}

// MARK: Starting

async function signIn() {
  const auth = await bridge.authStatus();
  set({ auth, me: auth.login });
  return auth;
}

export async function reloadConfig() {
  const config = await loadConfig();
  set({ config });
  await refresh(true);
}

export async function reloadAuth() {
  const auth = await signIn();
  if (auth.signed_in) await refresh(true);
  else set({ items: {} });
}

export async function start() {
  await loadPersisted();
  const [config] = await Promise.all([loadConfig(), signIn()]);
  set({ config, ready: true, seen: { ...persisted.seen }, dismissed: { ...persisted.dismissed } });
  void refresh(true);
  void bridge.on("tick", () => void refresh());
  void bridge.on("panel-shown", () => void refresh());
  // A review window approved, commented, merged…
  void bridge.on("prs-changed", () => void refresh(true));
  void bridge.on<string>("file-changed", (name) => {
    if (name === "config") void reloadConfig();
    if (name === "auth") void reloadAuth();
  });
}
