export interface Stackable {
  repo: string;
  head: string;
  base: string;
  fork?: boolean | undefined;
}

export interface StackPlace {
  stack: string;
  index: number;
  size: number;
}

const branch = (repo: string, name: string) => `${repo.toLowerCase()}:${name}`;

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
