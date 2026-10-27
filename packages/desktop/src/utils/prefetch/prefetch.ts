// Fetching a pull request ahead of the click: the pointer resting on its row, or the panel opening
// on the queue it's in. The review window makes the same requests, which the app answers from what
// it kept (github.rs), and the copy goes to disk (kept.ts), so the window opens with it there.

import { loadCommits } from "../commits/commits";
import { loadDetails } from "../details/details";
import { keep, keptCurrent } from "../kept/kept";
import { loadManage } from "../manage/manage";
import { loadFiles, loadThreads } from "../review/review";
import { shelve } from "../shelf/shelf";

const fetched = new Map<string, number>();

/** Puts it on the shelf once it's loaded. */
async function shelveWhenLoaded(key: string, loading: Promise<unknown>) {
  try {
    shelve(key, await loading);
  } catch {
    // The window asks again.
  }
}

/** `updatedAt`: the version the panel knows; nothing's fetched when that copy is already kept. */
export function prefetch(id: string, nameWithOwner: string, number: number, updatedAt?: string): Promise<void> {
  const key = `${nameWithOwner}#${number}`;
  // The app keeps answers two minutes; asking again sooner would be for nothing.
  if (Date.now() - (fetched.get(key) ?? 0) < 90_000 || (updatedAt && keptCurrent(id, updatedAt)))
    return Promise.resolve();
  fetched.set(key, Date.now());
  const [owner = "", repo = ""] = nameWithOwner.split("/");
  const ref = { owner, repo, number };
  // What's around it (merging, people, commits) is kept on the shelf the window reads first.
  void shelveWhenLoaded(`manage:${id}`, loadManage(ref));
  void shelveWhenLoaded(`commits:${id}`, loadCommits(ref));
  return Promise.all([loadDetails(nameWithOwner, number), loadFiles(ref), loadThreads(ref)])
    .then(([details, files, threads]) => keep(id, { details, files, threads }, details.updatedAt))
    .catch(() => void fetched.delete(key));
}

/** The first few pull requests of a list, one after another (not a burst at GitHub). */
export async function prefetchSome(
  prs: Array<{ id: string; repository: { nameWithOwner: string }; number: number; updatedAt: string }>,
  limit = 5,
) {
  // oxlint-disable-next-line eslint/no-await-in-loop -- one after another on purpose
  for (const pr of prs.slice(0, limit)) await prefetch(pr.id, pr.repository.nameWithOwner, pr.number, pr.updatedAt);
}
