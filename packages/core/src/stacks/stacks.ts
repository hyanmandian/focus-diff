/**
 * Stacks in a list of pull requests: ones built on one another, each based on the branch of the one below it (as
 * Graphite, ghstack or stacking by hand leave them). Told from the branches alone, so whatever made the stack, and only
 * from what's in the list: a stack's pull requests that aren't in it aren't known here.
 */

/** A pull request as far as stacks go: its repository and its two branches. */
export interface Stackable {
  repo: string;
  head: string;
  base: string;
  /** From a fork, whose branch names say nothing about the repository's own. */
  fork?: boolean;
}

/** Where a pull request stands in its stack: which one (the same for all of its pull requests), and its place from the bottom, from 0. */
export interface StackPlace {
  stack: string;
  index: number;
  size: number;
}

const branch = (repo: string, name: string) => `${repo.toLowerCase()}:${name}`;

/**
 * The list with each stack's pull requests together, bottom first, where its first one in the list stood; everything
 * else keeps its place. Where one branch has more than one pull request on it, each goes up in turn after the one it's
 * on, in the list's order.
 */
export const groupStacks = <T extends Stackable>(list: readonly T[]): { list: T[]; places: Map<T, StackPlace> } => {
  const own = list.filter((pull) => !pull.fork && pull.head && pull.base);
  const byHead = new Map<string, T>();
  for (const pull of own) {
    const key = branch(pull.repo, pull.head);
    if (!byHead.has(key)) byHead.set(key, pull);
  }
  const below = new Map<T, T>();
  const above = new Map<T, T[]>();
  for (const pull of own) {
    const under = byHead.get(branch(pull.repo, pull.base));
    if (!under || under === pull) continue;
    below.set(pull, under);
    above.set(under, [...(above.get(under) ?? []), pull]);
  }

  // Each stack from its bottom, up through everything built on it.
  const places = new Map<T, StackPlace>();
  const stacks = new Map<T, T[]>();
  for (const bottom of own) {
    if (below.has(bottom) || !above.has(bottom)) continue;
    const members: T[] = [];
    const climb = (pull: T) => {
      members.push(pull);
      for (const next of above.get(pull) ?? []) climb(next);
    };
    climb(bottom);
    const stack = branch(bottom.repo, bottom.head);
    members.forEach((pull, index) => {
      places.set(pull, { stack, index, size: members.length });
      stacks.set(pull, members);
    });
  }

  const out: T[] = [];
  const placed = new Set<T>();
  for (const pull of list) {
    if (placed.has(pull)) continue;
    for (const each of stacks.get(pull) ?? [pull]) {
      placed.add(each);
      out.push(each);
    }
  }
  return { list: out, places };
};
