// The last copy of a pull request's review, kept on disk by the app (kept.rs): a window shows it
// at once and asks GitHub for what changed meanwhile. Which version each copy is (the pull
// request's updatedAt when it was fetched) is noted here, so the panel fetches ahead only what changed.
//
// The files (every patch, the bulk of it) are kept apart from the details and conversations, and
// each part is written only when it changed: most loads find the same patches, and writing
// megabytes of them each time was most of the work.

import { invoke } from "@tauri-apps/api/core";

import type { Details } from "@/utils/details/details";
import { hash, patchHash } from "@/utils/hashes/hashes";
import type { ReviewFile, Thread } from "@/utils/review/review";

export type Kept = { details: Details; files: ReviewFile[]; threads: Thread[] };

const VERSIONS = "kept-versions";
/** What each part last written was, by pull request, and when. */
const WRITTEN = "kept-written";
/** Written again after this even if unchanged, so a copy swept from disk comes back. */
const REWRITE_AFTER = 7 * 24 * 3600_000;

type Written = Record<string, { rest: string; files: string; at: number }>;

/** What this file wrote earlier, as it wrote it; `fallback` when there's nothing to read. */
function parse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only keep() writes these, in these shapes
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const read = <T>(key: string, fallback: T) => parse(localStorage.getItem(key), fallback);

/** Whether the copy kept is of this version of the pull request. */
export const keptCurrent = (id: string, updatedAt: string) =>
  read<Record<string, string>>(VERSIONS, {})[id] === updatedAt;

/** Where a pull request's files are kept (kept.rs takes letters, digits, `_` and `-`). */
const filesId = (id: string) => `${id}-files`;

export async function readKept(id: string): Promise<Kept | null> {
  try {
    const text = await invoke<string | null>("kept_read", { id });
    if (!text) return null;
    const kept = parse<Partial<Kept>>(text, {});
    // A copy from before the files were kept apart has them inside.
    const files =
      kept.files ?? parse<ReviewFile[] | null>(await invoke<string | null>("kept_read", { id: filesId(id) }), null);
    return kept.details && kept.threads && files ? { details: kept.details, threads: kept.threads, files } : null;
  } catch {
    return null;
  }
}

/** The files' identity: their paths and patches (hashed once per file, hashes.ts). */
const filesSignature = (files: ReviewFile[]) =>
  hash(files.map((f) => `${f.path}\u0000${f.previousPath ?? ""}\u0000${patchHash(f)}`).join("\n"));

export async function keep(id: string, kept: Kept, updatedAt?: string) {
  try {
    const written = read<Written>(WRITTEN, {});
    const before = written[id];
    const fresh = before && Date.now() - before.at < REWRITE_AFTER;
    const rest = JSON.stringify({ details: kept.details, threads: kept.threads });
    const now = { rest: hash(rest), files: filesSignature(kept.files), at: fresh ? before.at : Date.now() };
    // The files first: details without their files read as no copy at all.
    if (!fresh || before.files !== now.files)
      await invoke("kept_write", { id: filesId(id), contents: JSON.stringify(kept.files) });
    if (!fresh || before.rest !== now.rest) await invoke("kept_write", { id, contents: rest });
    // The most recent couple hundred are enough to know.
    localStorage.setItem(
      WRITTEN,
      JSON.stringify(Object.fromEntries(Object.entries({ ...written, [id]: now }).slice(-200))),
    );
    if (updatedAt) {
      const all = Object.entries({ ...read<Record<string, string>>(VERSIONS, {}), [id]: updatedAt }).slice(-200);
      localStorage.setItem(VERSIONS, JSON.stringify(Object.fromEntries(all)));
    }
  } catch {
    // Only slower next time.
  }
}
