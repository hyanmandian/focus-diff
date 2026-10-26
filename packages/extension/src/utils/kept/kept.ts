// The last copy of each pull request's review, so opening it again shows it at once while GitHub is asked for what
// changed, as the desktop's kept.rs. Kept in the browser's local storage, one entry per pull request, with an index of
// when each was last used: what's gone unused for two weeks goes, and so do the oldest past a budget.

import { storage } from "#imports";

export const SWEEP_AFTER = 14 * 24 * 60 * 60_000;
/** The largest copy kept; a larger one only removes the last. */
export const LARGEST = 8 * 1024 * 1024;
/** All of them together. */
export const BUDGET = 48 * 1024 * 1024;

type Index = Record<string, { at: number; size: number }>;

export const indexItem = storage.defineItem<Index>("local:kept", { fallback: {} });

const entry = (id: string) => `local:kept.${id}` as const;

/** A pull request's node id, as GitHub makes them. */
const check = (id: string) => {
  if (!/^[\w-]{1,64}$/u.test(id)) throw new Error("Bad pull request");
};

const size = (text: string) => new TextEncoder().encode(text).length;

/** The last copy kept of a pull request's review, or null. */
export const keptRead = async (id: string): Promise<string | null> => {
  check(id);
  const text = await storage.getItem<string>(entry(id));
  if (text === null) return null;
  const index = await indexItem.getValue();
  await indexItem.setValue({ ...index, [id]: { at: Date.now(), size: index[id]?.size ?? size(text) } });
  return text;
};

/** Keeps a pull request's review; forgets the oldest unused ones. */
export const keptWrite = async (id: string, contents: string): Promise<void> => {
  check(id);
  // A copy: what storage hands back may be its fallback, shared.
  const index = { ...(await indexItem.getValue()) };
  const bytes = size(contents);
  const gone: string[] = [];
  if (bytes > LARGEST) {
    gone.push(id);
    delete index[id];
  } else {
    await storage.setItem(entry(id), contents);
    index[id] = { at: Date.now(), size: bytes };
  }
  const now = Date.now();
  let total = 0;
  // The newest first: what's past the budget, or unused too long, goes.
  for (const [key, { at, size: kept }] of Object.entries(index).toSorted(([, a], [, b]) => b.at - a.at)) {
    total += kept;
    if (now - at > SWEEP_AFTER || total > BUDGET) {
      gone.push(key);
      delete index[key];
    }
  }
  await storage.removeItems(gone.map((key) => entry(key)));
  await indexItem.setValue(index);
};
