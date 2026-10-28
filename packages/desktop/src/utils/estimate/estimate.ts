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

export function pullMinutes(pr: LineCounts & { changedFiles: number }, learned: Learned | null): number {
  const lines = pr.additions + pr.deletions * REMOVED_LINE_WEIGHT;
  const minutes = pr.changedFiles * MINUTES_PER_FILE + (lines / LINES_PER_HOUR) * 60;
  return learned ? minutes * paceFactors(learned).all : minutes;
}

export const estimateHint = (t: T) => t("config.estimateHint", { lines: LINES_PER_HOUR });

let learned: Learned | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  loading ??= (async () => {
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

export async function learnFiles(samples: Array<{ path: string; expected: number; actual: number }>) {
  if (samples.length === 0) return;
  let next = await read();
  for (const s of samples) next = learnFile(next, s.path, s.expected, s.actual);
  learned = next;
  for (const listener of listeners) listener();
  await bridge.writeFile("pace", JSON.stringify(next)).catch(() => {});
}
