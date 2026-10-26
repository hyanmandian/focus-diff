// Files at a commit, for what a patch alone can't show: the lines between hunks, pictures, files
// too large for GitHub's diff. Rust fetches them and keeps them for good (blobs.rs): what a commit
// holds never changes. The old version is the one at the commit the pull request branched from
// (the merge base), which is what GitHub's diff compares against, not the base branch's tip.

import { github } from "@/utils/bridge/bridge";
import { invoke } from "@/utils/platform/platform";
import type { PullRef } from "@/utils/review/review";

/** What one pull request's files are compared between. */
export type Source = { repo: string; head: string; base: () => Promise<string> };

const files = new Map<string, Promise<Uint8Array | null>>();

/** A file's bytes at a commit; null when it isn't there (added after, or deleted before). */
export function fileAt(repo: string, sha: string, path: string): Promise<Uint8Array | null> {
  const key = `${repo}\n${sha}\n${path}`;
  let known = files.get(key);
  if (!known) {
    known = invoke<ArrayBuffer | Uint8Array>("github_file", { repo, sha, path }).then(
      (bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
      (e: unknown) => {
        if (e === "absent") return null;
        // Tried again next time: it may have been the network.
        files.delete(key);
        throw e instanceof Error ? e : new Error(String(e));
      },
    );
    files.set(key, known);
  }
  return known;
}

/** Binary, as git decides it: a zero byte in the first 8,000. */
export const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8000).includes(0);

export class BinaryFile extends Error {}

/** A file's text at a commit; null when it isn't there. Throws BinaryFile for one that isn't text. */
export async function textAt(repo: string, sha: string, path: string): Promise<string | null> {
  const bytes = await fileAt(repo, sha, path);
  if (!bytes) return null;
  if (isBinary(bytes)) throw new BinaryFile(path);
  return new TextDecoder().decode(bytes);
}

const bases = new Map<string, Promise<string>>();

/** The commit a pull request's head branched from its base, asked of GitHub once per head. */
export function mergeBase(d: PullRef, head: string): Promise<string> {
  const key = `${d.owner}/${d.repo}#${d.number}@${head}`;
  let known = bases.get(key);
  if (!known) {
    known = (async () => {
      const pull = await github<{ base: { sha: string } }>("GET", `/repos/${d.owner}/${d.repo}/pulls/${d.number}`);
      // Only the merge base is wanted: one commit and one file are the least it lists.
      const compare = await github<{ merge_base_commit: { sha: string } }>(
        "GET",
        `/repos/${d.owner}/${d.repo}/compare/${pull.base.sha}...${head}?per_page=1`,
      );
      return compare.merge_base_commit.sha;
    })();
    known.catch(() => bases.delete(key));
    bases.set(key, known);
  }
  return known;
}

/** A file's two versions as text, the old (at the merge base, under its old name if renamed) and
 *  the new (at the head); null for a side it isn't on. */
export async function bothVersions(
  source: Source,
  file: { path: string; previousPath: string | null; status: string },
) {
  const [oldText, newText] = await Promise.all([
    file.status === "added"
      ? null
      : source.base().then((base) => textAt(source.repo, base, file.previousPath ?? file.path)),
    file.status === "removed" ? null : textAt(source.repo, source.head, file.path),
  ]);
  return { oldText, newText };
}
