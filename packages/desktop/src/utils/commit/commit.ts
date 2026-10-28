import { github, GitHubError } from "@/utils/bridge/bridge";
import { mutate } from "@/utils/comments/comments";
import { applyEdits, coAuthors, toBase64, type Author, type Edit } from "@/utils/suggestion/suggestion";

export type Applied = Edit & { thread: string; comment: string; path: string; author: Author };

export class StaleHead extends Error {}

export const defaultHeadline = (items: Applied[]) =>
  items.length === 1 ? `Update ${items[0]!.path.split("/").pop()}` : "Apply suggestions from code review";

const contentsPath = (repo: string, path: string, ref: string) =>
  `/repos/${repo}/contents/${path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}?ref=${ref}`;

export async function commitSuggestions(c: {
  repo: string;
  branch: string;
  head: string;
  items: Applied[];
  headline: string;
  body: string;
  me: string | null;
}) {
  const byPath = new Map<string, Edit[]>();
  for (const item of c.items)
    byPath.set(item.path, [...(byPath.get(item.path) ?? []), { start: item.start, end: item.end, lines: item.lines }]);
  const additions = await Promise.all(
    [...byPath].map(async ([path, edits]) => {
      const text = await github<string>(
        "GET",
        contentsPath(c.repo, path, c.head),
        undefined,
        "application/vnd.github.raw+json",
      );
      return { path, contents: toBase64(applyEdits(text, edits)) };
    }),
  );
  const credits = coAuthors(
    c.items.map((i) => i.author),
    c.me,
  );
  const body = [c.body.trim(), credits.join("\n")].filter(Boolean).join("\n\n");
  try {
    await mutate(
      "mutation($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }",
      {
        input: {
          branch: { repositoryNameWithOwner: c.repo, branchName: c.branch },
          expectedHeadOid: c.head,
          message: body ? { headline: c.headline.trim(), body } : { headline: c.headline.trim() },
          fileChanges: { additions },
        },
      },
    );
  } catch (e) {
    if (e instanceof GitHubError && /expected branch to point to|is at .* but expected/iu.test(e.message))
      throw new StaleHead(e.message);
    throw e;
  }
}
