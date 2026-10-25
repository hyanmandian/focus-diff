// The last copy of a pull request's review, kept on disk by the app (kept.rs): a window shows it
// at once and asks GitHub for what changed meanwhile. Which version each copy is (the pull
// request's updatedAt when it was fetched) is noted here, so the panel fetches ahead only what changed.

import { invoke } from "@tauri-apps/api/core";
import type { Details } from "./details";
import type { ReviewFile, Thread } from "./review";

export type Kept = { details: Details; files: ReviewFile[]; threads: Thread[] };

const VERSIONS = "kept-versions";

function versions(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(VERSIONS) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Whether the copy kept is of this version of the pull request. */
export const keptCurrent = (id: string, updatedAt: string) => versions()[id] === updatedAt;

export async function readKept(id: string): Promise<Kept | null> {
  try {
    const text = await invoke<string | null>("kept_read", { id });
    return text ? (JSON.parse(text) as Kept) : null;
  } catch {
    return null;
  }
}

export async function keep(id: string, kept: Kept, updatedAt?: string) {
  try {
    await invoke("kept_write", { id, contents: JSON.stringify(kept) });
    if (updatedAt) {
      // The most recent couple hundred are enough to know.
      const all = Object.entries({ ...versions(), [id]: updatedAt }).slice(-200);
      localStorage.setItem(VERSIONS, JSON.stringify(Object.fromEntries(all)));
    }
  } catch {
    // Only slower next time.
  }
}
