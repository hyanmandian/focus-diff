import type { Estimator } from "@focus-diff/core/estimate";
import { inFilter } from "@focus-diff/core/filters";
import { repoMatches } from "@focus-diff/core/repos";

import { isRecord } from "@/utils/bridge/bridge";
import { isRepoPattern, newId, normalize, type DiffFilter } from "@/utils/config/config";

export const filtersFor = (filters: DiffFilter[], repo: string) =>
  filters.filter((f) => f.repos.length === 0 || f.repos.some((p) => repoMatches(p, repo)));

export const keptSelection = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : typeof value === "string" && value
      ? [value]
      : [];

export const toggled = (ids: string[], id: string): string[] =>
  id ? (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]) : [];

export const inAny = (chosen: DiffFilter[], path: string) =>
  chosen.length === 0 || chosen.some((f) => inFilter(f, path));

type FileLike = { path: string; additions: number; deletions: number };

export type Totals = {
  files: number;
  viewed: number;
  additions: number;
  deletions: number;
  minutes: number;
  minutesLeft: number;
};

export function totals<F extends FileLike>(files: F[], isViewed: (f: F) => boolean, minutesOf: Estimator): Totals {
  const t: Totals = { files: 0, viewed: 0, additions: 0, deletions: 0, minutes: 0, minutesLeft: 0 };
  for (const f of files) {
    const minutes = minutesOf(f.path, f);
    t.files++;
    t.additions += f.additions;
    t.deletions += f.deletions;
    t.minutes += minutes;
    if (isViewed(f)) t.viewed++;
    else t.minutesLeft += minutes;
  }
  return t;
}

export function nextFilterWithWork<F extends FileLike>(
  files: F[],
  filters: DiffFilter[],
  ids: string[],
  isViewed: (f: F) => boolean,
): { id: string; name: string; left: number } | undefined {
  const last = Math.max(-1, ...ids.map((id) => filters.findIndex((f) => f.id === id)));
  for (let offset = 1; offset <= filters.length; offset++) {
    const filter = filters[(last + offset) % filters.length];
    if (!filter || ids.includes(filter.id)) continue;
    const left = files.filter((f) => !isViewed(f) && inFilter(filter, f.path)).length;
    if (left) return { id: filter.id, name: filter.name, left };
  }
  return undefined;
}

export function nextFile<F extends FileLike>(
  shown: F[],
  isViewed: (f: F) => boolean,
  atTop: { path: string; reached: boolean } | null,
): F | undefined {
  const left = shown.filter((f) => !isViewed(f));
  const at = atTop ? shown.findIndex((f) => f.path === atTop.path) : -1;
  const current = shown[at];
  if (current && !atTop!.reached && !isViewed(current)) return current;
  return left.find((f) => shown.indexOf(f) > at) ?? left[0];
}

export function stepFilter(options: string[], ids: string[], by: 1 | -1): string[] {
  const all = ["", ...options];
  const at = Math.max(0, all.indexOf(ids[0] ?? ""));
  const next = all[(at + by + all.length) % all.length]!;
  return next ? [next] : [];
}

type Shared = { global: SharedFilter[]; repos: Array<{ repo: string; filters: SharedFilter[] }> };
type SharedFilter = { id: string; name: string; include: string; exclude: string };

export function exportFilters(filters: DiffFilter[]): string {
  const used = new Set(["all"]);
  const unique = (id: string) => {
    let next = id;
    for (let n = 2; used.has(next); n++) next = `${id}-${n}`;
    used.add(next);
    return next;
  };
  const shared = (f: DiffFilter): SharedFilter => ({
    id: unique(f.id),
    name: f.name,
    include: f.include,
    exclude: f.exclude,
  });
  const out: Shared = { global: filters.filter((f) => f.repos.length === 0).map((f) => shared(f)), repos: [] };
  for (const f of filters)
    for (const repo of f.repos) {
      const entry = out.repos.find((e) => e.repo === repo) ?? out.repos[out.repos.push({ repo, filters: [] }) - 1]!;
      entry.filters.push(shared(f));
    }
  return JSON.stringify(out, null, 2);
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const named = (v: unknown): v is Record<string, unknown> =>
  isRecord(v) && typeof v.name === "string" && Boolean(v.name.trim());

const sameness = (f: DiffFilter) => JSON.stringify([f.name, f.include, f.exclude, f.repos.toSorted()]);

export function importFilters(text: string): DiffFilter[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || (!Array.isArray(raw.global) && !Array.isArray(raw.repos))) return null;
  const found: Array<Record<string, unknown> & { repos: string[] }> = list(raw.global)
    .filter((v) => named(v))
    .map((f) => Object.assign(f, { repos: [] }));
  for (const entry of list(raw.repos)) {
    if (!isRecord(entry) || typeof entry.repo !== "string" || !isRepoPattern(entry.repo.trim())) continue;
    const repo = entry.repo.trim();
    for (const f of list(entry.filters).filter((v) => named(v))) {
      const same = found.find(
        (x) => x.repos.length > 0 && x.name === f.name && x.include === f.include && x.exclude === f.exclude,
      );
      if (same) same.repos = [...new Set([...same.repos, repo])];
      else found.push({ ...f, repos: [repo] });
    }
  }
  return normalize({ filters: found }).filters;
}

export function addImported(
  own: DiffFilter[],
  imported: DiffFilter[],
): { filters: DiffFilter[]; added: number; skipped: number } {
  const have = new Set(own.map((f) => sameness(f)));
  const ids = new Set(own.map((f) => f.id));
  const fresh = imported.filter((f) => !have.has(sameness(f)) && (have.add(sameness(f)), true));
  const room = Math.max(0, 12 - own.length);
  const added: DiffFilter[] = [];
  for (const f of fresh.slice(0, room)) {
    const id = ids.has(f.id) ? newId() : f.id;
    ids.add(id);
    added.push({ ...f, id });
  }
  return { filters: [...own, ...added], added: added.length, skipped: fresh.length - added.length };
}
