// A queue's pull requests in the order the panel shows them, so "next" in a review window is the
// row below in the panel.

import type { Item } from "../engine/engine";

export type Group = { repo: string; items: Item[] };

const at = (i: Item) => Math.max(...i.events.map((e) => e.at), Date.parse(i.pr.updatedAt));

/** By repository, the busiest first; within one, asked again first, then news, then the most
 *  recently active. Drafts apart, in the same order. */
export function arrange(list: Item[], unread: (item: Item) => boolean): { groups: Group[]; drafts: Item[] } {
  const order = (a: Item, b: Item) =>
    Number(b.events.some((e) => e.kind === "rerequest")) - Number(a.events.some((e) => e.kind === "rerequest")) ||
    Number(unread(b)) - Number(unread(a)) ||
    at(b) - at(a);
  const groups: Group[] = [];
  for (const item of list.filter((i) => !i.pr.isDraft)) {
    const name = item.pr.repository.nameWithOwner;
    const group = groups.find((g) => g.repo === name) ?? groups[groups.push({ repo: name, items: [] }) - 1]!;
    group.items.push(item);
  }
  for (const g of groups) g.items.sort(order);
  groups.sort(
    (a, b) =>
      b.items.filter(unread).length - a.items.filter(unread).length ||
      Math.max(...b.items.map(at)) - Math.max(...a.items.map(at)),
  );
  return { groups, drafts: list.filter((i) => i.pr.isDraft).toSorted(order) };
}

/** The one after `current` in the panel's order (drafts last), back to the top past the end; the
 *  first when `current` has left the queue (approved, say). None when it's the only one. */
export function nextAfter(list: Item[], current: string, unread: (item: Item) => boolean): Item | null {
  const { groups, drafts } = arrange(list, unread);
  const all = [...groups.flatMap((g) => g.items), ...drafts];
  const index = all.findIndex((i) => i.pr.id === current);
  const next = index < 0 ? all[0] : all[(index + 1) % all.length];
  return next && next.pr.id !== current ? next : null;
}
