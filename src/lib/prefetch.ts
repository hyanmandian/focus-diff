// Fetching a pull request ahead of the click (the pointer resting on its row): the review window
// makes the same requests, which the app answers from what it kept (github.rs), so it opens with
// everything there.

import { loadDetails } from "./details";
import { loadFiles, loadThreads } from "./review";

const fetched = new Map<string, number>();

export function prefetch(nameWithOwner: string, number: number) {
  const key = `${nameWithOwner}#${number}`;
  // The app keeps answers two minutes; asking again sooner would be for nothing.
  if (Date.now() - (fetched.get(key) ?? 0) < 90_000) return;
  fetched.set(key, Date.now());
  const [owner = "", repo = ""] = nameWithOwner.split("/");
  const ref = { owner, repo, number };
  void Promise.all([loadDetails(nameWithOwner, number), loadFiles(ref), loadThreads(ref)]).catch(() => fetched.delete(key));
}
