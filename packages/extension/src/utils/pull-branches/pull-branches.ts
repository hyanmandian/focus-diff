import { groupStacks, type StackPlace } from "@focus-diff/core/stacks";

import { fetchBranches, type PullBranches, type PullRequest } from "@/utils/github-inbox/github-inbox";
import { pool } from "@/utils/inbox-check/inbox-check";
import { pullBranchesItem } from "@/utils/storage/storage";

export interface BranchesRecord extends PullBranches {
  sha: string;
}

const BRANCHES_LIMIT = 30;
const BRANCHES_CONCURRENCY = 3;

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
  const cache = { ...stored };
  const queue = pool(BRANCHES_CONCURRENCY);
  let budget = BRANCHES_LIMIT;
  await Promise.all(
    mayStack(lists).map(async (pull) => {
      if (cache[pull.url]?.sha === pull.headSha || budget <= 0) return;
      budget -= 1;
      const branches = await queue(() => fetchBranches(pull.repo, pull.number)).catch(() => "unreached" as const);
      if (branches === "unreached") return;
      cache[pull.url] = { sha: pull.headSha, ...(branches ?? { head: "", base: "", fork: false }) };
    }),
  );
  const urls = new Set(lists.flat().map((pull) => pull.url));
  const kept = Object.fromEntries(Object.entries(cache).filter(([url]) => urls.has(url)));
  if (JSON.stringify(kept) !== JSON.stringify(stored)) await pullBranchesItem.setValue(kept);
};

const oneRead = pool(1);

export const readBranches = (lists: PullRequest[][]): Promise<void> => oneRead(() => readNow(lists));

export interface Stacked {
  pull: PullRequest;
  place: StackPlace | null;
}

export const stackPulls = (pulls: PullRequest[], branches: Record<string, BranchesRecord>): Stacked[] => {
  const { list, places } = groupStacks(
    pulls.map((pull) => {
      const known = branches[pull.url];
      return { pull, repo: pull.repo, head: known?.head ?? "", base: known?.base ?? "", fork: known?.fork ?? false };
    }),
  );
  return list.map((each) => ({ pull: each.pull, place: places.get(each) ?? null }));
};

export const stackPosition = ({ pull, place }: Stacked): { position: number; size: number } | null =>
  pull.stack ?? (place ? { position: place.index + 1, size: place.size } : null);
