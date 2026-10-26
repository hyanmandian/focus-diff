// Files at a commit, for what a patch alone can't show (the lines between hunks, pictures, files too large for
// GitHub's diff), as the desktop's blobs.rs: what a commit holds never changes, so each is kept once fetched. Here
// in memory, while the background is awake, the most recently used first.

import type { GitHubApi } from "@/utils/github-api/github-api";
import { returned } from "@/utils/github-api/github-api";

/** The largest file fetched. */
const LARGEST = 20 * 1024 * 1024;
/** How much is kept in memory. */
export const BUDGET = 64 * 1024 * 1024;
/** How many files known not to be there are remembered. */
export const MOST_ABSENT = 2000;
/** What a file that isn't at that commit rejects with, as the pages tell it apart. */
export const ABSENT = "absent";

const NAME = /^[\w.-]{1,100}$/u;

/** "owner/name", nothing more. */
export const validRepo = (repo: string): boolean => {
  const parts = repo.split("/");
  return parts.length === 2 && parts.every((part) => NAME.test(part));
};

export const validSha = (sha: string): boolean => (sha.length === 40 || sha.length === 64) && /^[\da-f]+$/iu.test(sha);

/** A path in the repository: relative, no `.` or `..` or empty parts, no backslashes or NUL. */
export const validPath = (path: string): boolean =>
  path !== "" &&
  path.length <= 4096 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.includes("\0") &&
  path.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** A path for the contents API: each byte that isn't plain percent-encoded, slashes kept. */
export const encode = (path: string): string =>
  [...new TextEncoder().encode(path)]
    .map((byte) => {
      const c = String.fromCodePoint(byte);
      return /[\w.~/-]/u.test(c) && byte < 128 ? c : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");

export const createBlobs = (api: Pick<GitHubApi, "bytes">) => {
  const kept = new Map<string, Uint8Array>();
  const absent = new Set<string>();
  let bytes = 0;

  const keep = (key: string, file: Uint8Array) => {
    kept.set(key, file);
    bytes += file.length;
    for (const [oldest, old] of kept) {
      if (bytes <= BUDGET) break;
      kept.delete(oldest);
      bytes -= old.length;
    }
  };

  /** A file's bytes at a commit; rejects with ABSENT when it isn't there. */
  return async (repo: string, sha: string, path: string): Promise<Uint8Array> => {
    if (!validRepo(repo) || !validSha(sha) || !validPath(path)) throw new Error("Bad request");
    const key = `${repo}\n${sha}\n${path}`;
    const known = kept.get(key);
    if (known) {
      // The most recently used last, so it's the last to go.
      kept.delete(key);
      kept.set(key, known);
      return known;
    }
    if (absent.has(key)) throw new Error(ABSENT);
    const got = await api.bytes(
      `/repos/${repo}/contents/${encode(path)}?ref=${sha}`,
      "application/vnd.github.raw+json",
      LARGEST,
    );
    if (got.status === 200) {
      keep(key, got.bytes);
      return got.bytes;
    }
    if (got.status === 404) {
      absent.add(key);
      if (absent.size > MOST_ABSENT) absent.delete(absent.values().next().value!);
      throw new Error(ABSENT);
    }
    throw new Error(returned(got.status));
  };
};
