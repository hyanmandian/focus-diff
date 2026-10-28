import { github } from "@/utils/bridge/bridge";
import { invoke } from "@/utils/platform/platform";
import type { PullRef } from "@/utils/review/review";

export type Source = { repo: string; head: string; base: () => Promise<string> };

const files = new Map<string, Promise<Uint8Array | null>>();

export function fileAt(repo: string, sha: string, path: string): Promise<Uint8Array | null> {
  const key = `${repo}\n${sha}\n${path}`;
  let known = files.get(key);
  if (!known) {
    known = invoke<ArrayBuffer | Uint8Array>("github_file", { repo, sha, path }).then(
      (bytes) => (bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
      (e: unknown) => {
        if (e === "absent") return null;
        files.delete(key);
        throw e instanceof Error ? e : new Error(String(e));
      },
    );
    files.set(key, known);
  }
  return known;
}

export const isBinary = (bytes: Uint8Array) => bytes.subarray(0, 8000).includes(0);

export class BinaryFile extends Error {}

export async function textAt(repo: string, sha: string, path: string): Promise<string | null> {
  const bytes = await fileAt(repo, sha, path);
  if (!bytes) return null;
  if (isBinary(bytes)) throw new BinaryFile(path);
  return new TextDecoder().decode(bytes);
}

const bases = new Map<string, Promise<string>>();

export function mergeBase(d: PullRef, head: string): Promise<string> {
  const key = `${d.owner}/${d.repo}#${d.number}@${head}`;
  let known = bases.get(key);
  if (!known) {
    known = (async () => {
      const pull = await github<{ base: { sha: string } }>("GET", `/repos/${d.owner}/${d.repo}/pulls/${d.number}`);
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
