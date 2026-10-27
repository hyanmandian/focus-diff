// Opens a pull request's review from its link (pasted in the panel, typed in Open Pull Request…,
// or from a focusdiff:// link or the command line). The link itself is read by
// @focus-diff/core/pull-link, which the browser extension reads links with too.

import type { PullLink } from "@focus-diff/core/pull-link";

import { bridge, graphql } from "@/utils/bridge/bridge";

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
