// The stack a pull request is in: pull requests built one on another, each one's base the branch of
// the one below it (as Graphite, ghstack or stacking by hand leave them). Found from the branches, so
// it works whatever made the stack: down through the pull requests whose branch is this one's base,
// up through those based on this one's branch. Open ones only, in the same repository.

import { graphql } from "@/utils/bridge/bridge";

/** A pull request of a stack, as its menu lists it. */
export type StackPull = {
  id: string;
  number: number;
  title: string;
  author: { login: string; name?: string | null } | null;
  /** Approved, changes asked for, or still to review. */
  decision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  isDraft: boolean;
};

type RawPull = Omit<StackPull, "decision"> & {
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
  reviewDecision: StackPull["decision"];
};
type Raw = { repository: { above: { nodes: RawPull[] }; below: { nodes: RawPull[] } } };

/** How far a stack is followed each way: more than this isn't a stack anyone reviews in one go. */
const MOST = 12;

const FIELDS =
  "id number title isDraft isCrossRepository headRefName baseRefName reviewDecision author { login ... on User { name } }";

/** A fork's branch can share a name with one here; only this repository's own make a stack. */
const own = (p: RawPull) => !p.isCrossRepository;

/** The pull requests next to a branch: the one whose branch it's based on, and those based on it. */
async function around(owner: string, name: string, head: string, base: string) {
  const data = await graphql<Raw>(
    `query ($owner: String!, $name: String!, $head: String!, $base: String!) {
      repository(owner: $owner, name: $name) {
        above: pullRequests(baseRefName: $head, states: OPEN, first: 5, orderBy: { field: CREATED_AT, direction: ASC }) { nodes { ${FIELDS} } }
        below: pullRequests(headRefName: $base, states: OPEN, first: 5) { nodes { ${FIELDS} } }
      }
    }`,
    { owner, name, head, base },
  );
  return {
    above: data.repository.above.nodes.find(own) ?? null,
    below: data.repository.below.nodes.find(own) ?? null,
  };
}

const fromRaw = (p: RawPull): StackPull => ({
  id: p.id,
  number: p.number,
  title: p.title,
  author: p.author,
  isDraft: p.isDraft,
  decision: p.reviewDecision,
});

/** The stack around a pull request, from the bottom (nearest the default branch) to the top, or
 *  just the pull request itself when it isn't in one. Where a branch has more than one pull request
 *  on it, the oldest is followed. */
export async function loadStack(pull: {
  owner: string;
  repo: string;
  headRefName: string;
  baseRefName: string;
  self: StackPull;
}): Promise<StackPull[]> {
  const { owner, repo } = pull;
  const below: StackPull[] = [];
  const above: StackPull[] = [];
  const seen = new Set([pull.self.id]);
  const start = await around(owner, repo, pull.headRefName, pull.baseRefName);
  // Down to the bottom: each time the pull request whose branch is this one's base.
  let down = start.below;
  for (let step = 0; down && !seen.has(down.id) && step < MOST; step++) {
    seen.add(down.id);
    below.unshift(fromRaw(down));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step down starts from the one before
    down = (await around(owner, repo, down.headRefName, down.baseRefName)).below;
  }
  // Up to the top: each time the pull request based on this one's branch.
  let up = start.above;
  for (let step = 0; up && !seen.has(up.id) && step < MOST; step++) {
    seen.add(up.id);
    above.push(fromRaw(up));
    // oxlint-disable-next-line eslint/no-await-in-loop -- each step up starts from the one before
    up = (await around(owner, repo, up.headRefName, up.baseRefName)).above;
  }
  return [...below, pull.self, ...above];
}
