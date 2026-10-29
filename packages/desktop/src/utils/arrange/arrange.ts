import { groupStacks, type StackPlace } from "@focus-diff/core/stacks";

import type { Item } from "@/utils/engine/engine";

type Group = { repo: string; items: Item[] };

const at = (i: Item) => Math.max(...i.events.map((e) => e.at), Date.parse(i.pr.updatedAt));

function stacked(items: Item[], stacks: Map<string, StackPlace>) {
  const { list, places } = groupStacks(
    items.map((item) => ({
      item,
      repo: item.pr.repository.nameWithOwner,
      head: item.pr.headRefName ?? "",
      base: item.pr.baseRefName ?? "",
      fork: item.pr.isCrossRepository,
    })),
  );
  for (const [each, place] of places) stacks.set(each.item.pr.id, place);
  return list.map((each) => each.item);
}

export function arrange(
  list: Item[],
  unread: (item: Item) => boolean,
): { groups: Group[]; drafts: Item[]; stacks: Map<string, StackPlace> } {
  const order = (a: Item, b: Item) =>
    Number(b.events.some((e) => e.kind === "rerequest")) - Number(a.events.some((e) => e.kind === "rerequest")) ||
    Number(unread(b)) - Number(unread(a)) ||
    at(b) - at(a);
  const stacks = new Map<string, StackPlace>();
  const groups: Group[] = [];
  for (const item of list.filter((i) => !i.pr.isDraft)) {
    const name = item.pr.repository.nameWithOwner;
    const group = groups.find((g) => g.repo === name) ?? groups[groups.push({ repo: name, items: [] }) - 1]!;
    group.items.push(item);
  }
  for (const g of groups) g.items = stacked(g.items.toSorted(order), stacks);
  groups.sort(
    (a, b) =>
      b.items.filter(unread).length - a.items.filter(unread).length ||
      Math.max(...b.items.map(at)) - Math.max(...a.items.map(at)),
  );
  return { groups, drafts: stacked(list.filter((i) => i.pr.isDraft).toSorted(order), stacks), stacks };
}

export function nextAfter(list: Item[], current: string, unread: (item: Item) => boolean): Item | null {
  const { groups, drafts } = arrange(list, unread);
  const all = [...groups.flatMap((g) => g.items), ...drafts];
  const index = all.findIndex((i) => i.pr.id === current);
  const next = index < 0 ? all[0] : all[(index + 1) % all.length];
  return next && next.pr.id !== current ? next : null;
}
