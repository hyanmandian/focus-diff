import { loadCommits } from "@/utils/commits/commits";
import { loadDetails } from "@/utils/details/details";
import { keep, keptCurrent } from "@/utils/kept/kept";
import { loadManage } from "@/utils/manage/manage";
import { loadFiles, loadThreads } from "@/utils/review/review";
import { shelve } from "@/utils/shelf/shelf";

const fetched = new Map<string, number>();

async function shelveWhenLoaded(key: string, loading: Promise<unknown>) {
  try {
    shelve(key, await loading);
  } catch {}
}

export function prefetch(id: string, nameWithOwner: string, number: number, updatedAt?: string): Promise<void> {
  const key = `${nameWithOwner}#${number}`;
  if (Date.now() - (fetched.get(key) ?? 0) < 90_000 || (updatedAt && keptCurrent(id, updatedAt)))
    return Promise.resolve();
  fetched.set(key, Date.now());
  const [owner = "", repo = ""] = nameWithOwner.split("/");
  const ref = { owner, repo, number };
  void shelveWhenLoaded(`manage:${id}`, loadManage(ref));
  void shelveWhenLoaded(`commits:${id}`, loadCommits(ref));
  return Promise.all([loadDetails(nameWithOwner, number), loadFiles(ref), loadThreads(ref)])
    .then(([details, files, threads]) => keep(id, { details, files, threads }, details.updatedAt))
    .catch(() => void fetched.delete(key));
}

export async function prefetchSome(
  prs: Array<{ id: string; repository: { nameWithOwner: string }; number: number; updatedAt: string }>,
  limit = 5,
) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one after another on purpose
  for (const pr of prs.slice(0, limit)) await prefetch(pr.id, pr.repository.nameWithOwner, pr.number, pr.updatedAt);
}
