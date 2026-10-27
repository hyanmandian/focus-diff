/**
 * A pull request's link on github.com, to open it straight from the link: pasted in the desktop app's panel or the
 * extension's popup, typed in Open Pull Request…, or sent from a focusdiff:// link or the command line. Read strictly,
 * as GitHub writes them: anything else isn't taken for one.
 */

export interface PullLink {
  owner: string;
  repo: string;
  number: number;
}

// An owner as GitHub allows: letters, digits and single hyphens between them, 39 at most. A repository: letters,
// digits, `.`, `_` and `-`. Then the number, and whatever GitHub adds after it (`/files`, `/changes`, `/commits/…`, a
// query, an anchor). The scheme may be left off.
const LINK =
  /^(?:https:\/\/)?(?:www\.)?github\.com\/([A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38})\/([\w.-]{1,100})\/pull\/([1-9]\d{0,9})(?:\/[\w.\-/]*)?(?:\?[^\s#]*)?(?:#\S*)?$/u;

/** The pull request a link is to, or null when it isn't a pull request's link on github.com. */
export const parsePullLink = (text: string): PullLink | null => {
  const [, owner, repo, number] = LINK.exec(text.trim()) ?? [];
  if (!owner || !repo || !number || repo === "." || repo === "..") return null;
  return { owner, repo, number: Number(number) };
};

/** The link as GitHub writes it. */
export const pullLinkUrl = ({ owner, repo, number }: PullLink): string =>
  `https://github.com/${owner}/${repo}/pull/${number}`;
