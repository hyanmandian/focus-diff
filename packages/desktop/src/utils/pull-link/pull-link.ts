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

export class NoSuchPull extends Error {
  constructor() {
    super("No such pull request");
    this.name = "NoSuchPull";
  }
}
