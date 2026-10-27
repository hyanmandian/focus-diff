// A pull request's link on github.com, to open its review straight from it (pasted in the panel,
// typed in Open Pull Request…, or from a focusdiff:// link or the command line). Read strictly, as
// GitHub writes them: anything else isn't taken for one.

import { bridge, graphql } from "@/utils/bridge/bridge";

export type PullLink = { owner: string; repo: string; number: number };

// An owner as GitHub allows: letters, digits and single hyphens between them, 39 at most. A
// repository: letters, digits, `.`, `_` and `-`. Then the number, and whatever GitHub adds after it
// (`/files`, `/changes`, `/commits/…`, a query, an anchor). The scheme may be left off.
const LINK =
  /^(?:https:\/\/)?(?:www\.)?github\.com\/([A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38})\/([\w.-]{1,100})\/pull\/([1-9]\d{0,9})(?:\/[\w.\-/]*)?(?:\?[^\s#]*)?(?:#\S*)?$/u;

/** The pull request a link is to, or null when it isn't a pull request's link on github.com. */
export function parsePullLink(text: string): PullLink | null {
  const [, owner, repo, number] = LINK.exec(text.trim()) ?? [];
  if (!owner || !repo || !number || repo === "." || repo === "..") return null;
  return { owner, repo, number: Number(number) };
}

/** The link as GitHub writes it. */
export const pullLinkUrl = ({ owner, repo, number }: PullLink) => `https://github.com/${owner}/${repo}/pull/${number}`;

type Found = {
  repository: {
    pullRequest: {
      id: string;
      number: number;
      title: string;
      author: { login: string; name?: string | null } | null;
    } | null;
  } | null;
};

/** Opens the pull request's review window, outside any queue (so no Next or Back). Throws when
 *  GitHub has no such pull request, or not one you can see. */
export async function openPullLink(link: PullLink) {
  const data = await graphql<Found>(
    `
      query ($owner: String!, $name: String!, $number: Int!) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            id
            number
            title
            author {
              login
              ... on User {
                name
              }
            }
          }
        }
      }
    `,
    { owner: link.owner, name: link.repo, number: link.number },
  );
  const pull = data.repository?.pullRequest;
  if (!pull) throw new NoSuchPull();
  await bridge.openReview({ ...pull, repository: { nameWithOwner: `${link.owner}/${link.repo}` } });
}

/** GitHub has no pull request at the link, or none you can see. */
export class NoSuchPull extends Error {
  constructor() {
    super("No such pull request");
    this.name = "NoSuchPull";
  }
}
