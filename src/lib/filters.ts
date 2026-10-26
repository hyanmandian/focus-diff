// The diff's filters at work in the review window, as in Focus Diff's bar: the ones a repository
// gets, several on at once, what each holds (files viewed, lines, time left), the next file left to
// review, and filters shared as text with Focus Diff in both directions.

import { inFilter, isRepoPattern, newId, normalize, type DiffFilter } from "./config";
import type { Estimator } from "./estimate";

/** Whether "owner/name" or "owner/*" covers a repository. Case doesn't matter, as on GitHub. */
export function repoMatches(pattern: string, repo: string): boolean {
  const key = pattern.trim().toLowerCase();
  const target = repo.toLowerCase();
  return key === target || (key.endsWith("/*") && target.startsWith(key.slice(0, -1)));
}

/** The filters a repository gets: those for everywhere, and its own. */
export const filtersFor = (filters: DiffFilter[], repo: string) => filters.filter((f) => !f.repos.length || f.repos.some((p) => repoMatches(p, repo)));

/** A repository's choice as it was kept: one filter id before filters could be combined, a list now. */
export const keptSelection = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : typeof value === "string" && value ? [value] : [];

/** The choice after a chip is pressed: All ("") clears it, a filter joins it or leaves it. */
export const toggled = (ids: string[], id: string): string[] => (!id ? [] : ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]);

/** Whether a file is in any of the chosen filters; with none chosen, every file is. */
export const inAny = (chosen: DiffFilter[], path: string) => !chosen.length || chosen.some((f) => inFilter(f, path));

export type FileLike = { path: string; additions: number; deletions: number };

/** What a set of files holds: how many, how many viewed, their lines, the minutes they take and
 *  the minutes left for those not viewed yet. */
export type Totals = { files: number; viewed: number; additions: number; deletions: number; minutes: number; minutesLeft: number };

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

/** The next filter in the bar, after the chosen ones, that still has files to review. */
export function nextFilterWithWork<F extends FileLike>(files: F[], filters: DiffFilter[], ids: string[], isViewed: (f: F) => boolean) {
  const last = Math.max(-1, ...ids.map((id) => filters.findIndex((f) => f.id === id)));
  for (let offset = 1; offset <= filters.length; offset++) {
    const filter = filters[(last + offset) % filters.length];
    if (!filter || ids.includes(filter.id)) continue;
    const left = files.filter((f) => !isViewed(f) && inFilter(filter, f.path)).length;
    if (left) return { id: filter.id, name: filter.name, left };
  }
  return undefined;
}

/** The file to go to next: the first not viewed after the one at the top of the screen, wrapping
 *  around. `atTop` is the file there, if it's already been brought up (else it's the next itself). */
export function nextFile<F extends FileLike>(shown: F[], isViewed: (f: F) => boolean, atTop: { path: string; reached: boolean } | null): F | undefined {
  const left = shown.filter((f) => !isViewed(f));
  const at = atTop ? shown.findIndex((f) => f.path === atTop.path) : -1;
  const current = shown[at];
  if (current && !atTop!.reached && !isViewed(current)) return current;
  return left.find((f) => shown.indexOf(f) > at) ?? left[0];
}

/** One step through the bar's chips (All first), from the first chosen: one filter at a time, as
 *  Focus Diff's next and previous filter do. `options` are the chips worth stopping at. */
export function stepFilter(options: string[], ids: string[], by: 1 | -1): string[] {
  const all = ["", ...options];
  const at = Math.max(0, all.indexOf(ids[0] ?? ""));
  const next = all[(at + by + all.length) % all.length] ?? "";
  return next ? [next] : [];
}

// MARK: Sharing

/** Focus Diff's filters as it copies them: those for everywhere, then each repository's own. */
type Shared = { global: SharedFilter[]; repos: Array<{ repo: string; filters: SharedFilter[] }> };
type SharedFilter = { id: string; name: string; include: string; exclude: string };

/** The filters as text, exactly as Focus Diff copies its own, so either can import them. A filter
 *  for several repositories goes under each; ids stay unique, as Focus Diff's are. */
export function exportFilters(filters: DiffFilter[]): string {
  const used = new Set(["all"]);
  const unique = (id: string) => {
    let next = id;
    for (let n = 2; used.has(next); n++) next = `${id}-${n}`;
    used.add(next);
    return next;
  };
  const shared = (f: DiffFilter): SharedFilter => ({ id: unique(f.id), name: f.name, include: f.include, exclude: f.exclude });
  const out: Shared = { global: filters.filter((f) => !f.repos.length).map(shared), repos: [] };
  for (const f of filters)
    for (const repo of f.repos) {
      const entry = out.repos.find((e) => e.repo === repo) ?? out.repos[out.repos.push({ repo, filters: [] }) - 1]!;
      entry.filters.push(shared(f));
    }
  return JSON.stringify(out, null, 2);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Filters from text Focus Diff (or this app) copied, through the config's own checks. The same
 * filter under several repositories comes back as one. Null when it isn't such text; an empty list
 * when it has no filters. Repositories this app can't name (a GitLab group's) are left out, with
 * their filters, rather than turning them into filters for everywhere.
 */
export function importFilters(text: string): DiffFilter[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw) || (!Array.isArray(raw.global) && !Array.isArray(raw.repos))) return null;
  // Focus Diff keeps only filters with a name.
  const named = (v: unknown): v is Record<string, unknown> => isRecord(v) && typeof v.name === "string" && Boolean(v.name.trim());
  const found: Array<Record<string, unknown> & { repos: string[] }> = list(raw.global)
    .filter(named)
    .map((f) => ({ ...f, repos: [] }));
  for (const entry of list(raw.repos)) {
    if (!isRecord(entry) || typeof entry.repo !== "string" || !isRepoPattern(entry.repo.trim())) continue;
    const repo = entry.repo.trim();
    for (const f of list(entry.filters).filter(named)) {
      const same = found.find((x) => x.repos.length && x.name === f.name && x.include === f.include && x.exclude === f.exclude);
      if (same) same.repos = [...new Set([...same.repos, repo])];
      else found.push({ ...f, repos: [repo] });
    }
  }
  return normalize({ filters: found }).filters;
}

/** Imported filters added to the person's own: ones they already have are skipped, ids kept
 *  unique, up to the 12 the app keeps. */
export function addImported(own: DiffFilter[], imported: DiffFilter[]): { filters: DiffFilter[]; added: number; skipped: number } {
  const key = (f: DiffFilter) => JSON.stringify([f.name, f.include, f.exclude, [...f.repos].sort()]);
  const have = new Set(own.map(key));
  const ids = new Set(own.map((f) => f.id));
  const fresh = imported.filter((f) => !have.has(key(f)) && (have.add(key(f)), true));
  const room = Math.max(0, 12 - own.length);
  const added = fresh.slice(0, room).map((f) => {
    const id = ids.has(f.id) ? newId() : f.id;
    ids.add(id);
    return { ...f, id };
  });
  return { filters: [...own, ...added], added: added.length, skipped: fresh.length - added.length };
}
