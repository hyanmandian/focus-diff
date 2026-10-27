import { groupStacks, type StackPlace } from "@focus-diff/core/stacks";

import { fetchBranches, type PullBranches, type PullRequest } from "@/utils/github-inbox/github-inbox";
import { pool } from "@/utils/inbox-check/inbox-check";
import { pullBranchesItem } from "@/utils/storage/storage";

/** A pull request's branches as read at its latest commit. */
export interface BranchesRecord extends PullBranches {
  sha: string;
}

/** Hovercards read on one look at most; the rest wait for the next one. */
const BRANCHES_LIMIT = 30;
/** Hovercards read at once. */
const BRANCHES_CONCURRENCY = 3;

/**
 * The pull requests that could be in a stack with another on the same list: a stack takes two pull requests of one
 * repository, so one alone from its repository on every list it's on needs no branches.
 */
export const mayStack = (lists: PullRequest[][]): PullRequest[] => {
  const found = new Map<string, PullRequest>();
  for (const list of lists) {
    const repos = new Map<string, number>();
    for (const pull of list) repos.set(pull.repo, (repos.get(pull.repo) ?? 0) + 1);
    for (const pull of list) if (Number(repos.get(pull.repo)) > 1) found.set(pull.url, pull);
  }
  return [...found.values()];
};

const readNow = async (lists: PullRequest[][]) => {
  const stored = await pullBranchesItem.getValue();
  // A copy: with nothing stored, the item hands out its one fallback object, which mustn't fill up.
  const cache = { ...stored };
  const queue = pool(BRANCHES_CONCURRENCY);
  let budget = BRANCHES_LIMIT;
  await Promise.all(
    mayStack(lists).map(async (pull) => {
      // Branches only change with a push, if then.
      if (cache[pull.url]?.sha === pull.headSha || budget <= 0) return;
      budget -= 1;
      const branches = await queue(() => fetchBranches(pull.repo, pull.number)).catch(() => "unreached" as const);
      // A card that couldn't be reached is asked for again on the next look. One that didn't read as expected waits for
      // the next push instead, so a change on GitHub's side doesn't turn into a request per pull request per look.
      if (branches === "unreached") return;
      cache[pull.url] = { sha: pull.headSha, ...(branches ?? { head: "", base: "", fork: false }) };
    }),
  );
  // Only the pull requests still listed are kept, so the cache doesn't grow with every one ever read.
  const urls = new Set(lists.flat().map((pull) => pull.url));
  const kept = Object.fromEntries(Object.entries(cache).filter(([url]) => urls.has(url)));
  if (JSON.stringify(kept) !== JSON.stringify(stored)) await pullBranchesItem.setValue(kept);
};

/** One read at a time, since each writes the whole cache. */
let branchesQueue: Promise<unknown> = Promise.resolve();

/**
 * The branches of the pull requests on the popup's lists that could be in a stack, each read once per commit from its
 * hovercard, for the popup to put stacks together. Not a request more for one that can't be.
 */
export const readBranches = (lists: PullRequest[][]): Promise<void> => {
  const next = branchesQueue.then(() => readNow(lists));
  branchesQueue = next.catch(() => {});
  return next;
};

/** A pull request on a list, with where it stands in a stack there, if it's in one with others on the list. */
export interface Stacked {
  pull: PullRequest;
  place: StackPlace | null;
}

/** The list with each stack's pull requests together, bottom first, where its first one stood; the rest keep their place. */
export const stackPulls = (pulls: PullRequest[], branches: Record<string, BranchesRecord>): Stacked[] => {
  const { list, places } = groupStacks(
    pulls.map((pull) => {
      const known = branches[pull.url];
      return { pull, repo: pull.repo, head: known?.head ?? "", base: known?.base ?? "", fork: known?.fork ?? false };
    }),
  );
  return list.map((each) => ({ pull: each.pull, place: places.get(each) ?? null }));
};

/**
 * Where a pull request stands in its stack, from the bottom and from 1: as GitHub numbers the stacks it keeps itself,
 * which knows of ones not on the list too, or else as the list's branches say.
 */
export const stackPosition = ({ pull, place }: Stacked): { position: number; size: number } | null =>
  pull.stack ?? (place ? { position: place.index + 1, size: place.size } : null);
