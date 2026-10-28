// How long a review takes: the estimate shared with Focus Diff (@focus-diff/core/estimate), about
// 1,000 changed lines an hour to start with, then the reader's own pace, learned from the files they
// mark as viewed. What's learned is kept in pace.json beside the config, so every window (and Rust)
// reads the same.

import {
  learnFile,
  LINES_PER_HOUR,
  MINUTES_PER_FILE,
  normalizeLearned,
  paceFactors,
  REMOVED_LINE_WEIGHT,
  type Learned,
  type LineCounts,
} from "@focus-diff/core/estimate";
import { useSyncExternalStore } from "react";

import { bridge } from "@/utils/bridge/bridge";
import type { T } from "@/utils/i18n/i18n";

/** A whole pull request from its totals alone, as the panel knows it: no paths, so the overall pace. */
export function pullMinutes(pr: LineCounts & { changedFiles: number }, learned: Learned | null): number {
  const lines = pr.additions + pr.deletions * REMOVED_LINE_WEIGHT;
  const minutes = pr.changedFiles * MINUTES_PER_FILE + (lines / LINES_PER_HOUR) * 60;
  return learned ? minutes * paceFactors(learned).all : minutes;
}

/** What the estimate assumes, for its tooltip. (An estimate in words is t.duration, lib/i18n.ts.) */
export const estimateHint = (t: T) => t("config.estimateHint", { lines: LINES_PER_HOUR });

// MARK: Kept

let learned: Learned | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  loading ??= (async () => {
    // Other windows learn too: follow what they write.
    bridge.on<string>("file-changed", (name) => {
      if (name === "pace") void read();
    });
    await read();
  })();
}

async function read(): Promise<Learned> {
  let next: Learned;
  try {
    const text = await bridge.readFile("pace");
    next = normalizeLearned(text ? JSON.parse(text) : null);
  } catch {
    next = normalizeLearned(null);
  }
  learned = next;
  for (const listener of listeners) listener();
  return next;
}

/** What's been learned of the reader's pace; null until it's read. */
export function useLearned(): Learned | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      load();
      return () => {
        listeners.delete(listener);
      };
    },
    () => learned,
  );
}

/** Learns from files just reviewed, on top of what's on disk (another window may have learned
 *  something since). */
export async function learnFiles(samples: Array<{ path: string; expected: number; actual: number }>) {
  if (samples.length === 0) return;
  let next = await read();
  for (const s of samples) next = learnFile(next, s.path, s.expected, s.actual);
  learned = next;
  for (const listener of listeners) listener();
  await bridge.writeFile("pace", JSON.stringify(next)).catch(() => {});
}
