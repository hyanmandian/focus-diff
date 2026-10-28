import type { Details } from "@/utils/details/details";
import { hash, patchHash } from "@/utils/hashes/hashes";
import { invoke } from "@/utils/platform/platform";
import type { ReviewFile, Thread } from "@/utils/review/review";

export type Kept = { details: Details; files: ReviewFile[]; threads: Thread[] };

const VERSIONS = "kept-versions";
const WRITTEN = "kept-written";
const REWRITE_AFTER = 7 * 24 * 3600_000;

type Written = Record<string, { rest: string; files: string; at: number }>;

function parse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only keep() writes these, in these shapes
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    return parse(localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

export const keptCurrent = (id: string, updatedAt: string) =>
  read<Record<string, string>>(VERSIONS, {})[id] === updatedAt;

const filesId = (id: string) => `${id}-files`;

export async function readKept(id: string): Promise<Kept | null> {
  try {
    const text = await invoke<string | null>("kept_read", { id });
    if (!text) return null;
    const kept = parse<Partial<Kept>>(text, {});
    const files =
      kept.files ?? parse<ReviewFile[] | null>(await invoke<string | null>("kept_read", { id: filesId(id) }), null);
    return kept.details && kept.threads && files ? { details: kept.details, threads: kept.threads, files } : null;
  } catch {
    return null;
  }
}

const filesSignature = (files: ReviewFile[]) =>
  hash(files.map((f) => `${f.path}\u0000${f.previousPath ?? ""}\u0000${patchHash(f)}`).join("\n"));

const isId = (id: string) => /^[\w-]{1,128}$/u.test(id) && id !== "__proto__";

const withLatest = <T>(list: Record<string, T>, key: string, value: T) => {
  const entries = new Map(Object.entries(list));
  entries.delete(key);
  entries.set(key, value);
  return Object.fromEntries([...entries].slice(-200));
};

export async function keep(id: string, kept: Kept, updatedAt?: string) {
  if (!isId(id)) return;
  try {
    const written = read<Written>(WRITTEN, {});
    const before = written[id];
    const fresh = before && Date.now() - before.at < REWRITE_AFTER;
    const rest = JSON.stringify({ details: kept.details, threads: kept.threads });
    const now = { rest: hash(rest), files: filesSignature(kept.files), at: fresh ? before.at : Date.now() };
    if (!fresh || before.files !== now.files)
      await invoke("kept_write", { id: filesId(id), contents: JSON.stringify(kept.files) });
    if (!fresh || before.rest !== now.rest) await invoke("kept_write", { id, contents: rest });
    localStorage.setItem(WRITTEN, JSON.stringify(withLatest(written, id, now)));
    if (updatedAt)
      localStorage.setItem(
        VERSIONS,
        JSON.stringify(withLatest(read<Record<string, string>>(VERSIONS, {}), id, updatedAt)),
      );
  } catch {}
}
