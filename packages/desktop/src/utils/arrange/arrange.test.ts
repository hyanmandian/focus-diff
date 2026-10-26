import { describe, expect, it } from "vite-plus/test";

import { arrange, nextAfter } from "@/utils/arrange/arrange";
import type { Event, Item } from "@/utils/engine/engine";

const item = (id: string, repo: string, updatedAt: string, isDraft = false, events: Event[] = []): Item => ({
  queueId: "q",
  pr: {
    id,
    number: 1,
    title: id,
    url: `https://github.com/${repo}/pull/1`,
    isDraft,
    state: "OPEN",
    createdAt: updatedAt,
    updatedAt,
    mergedAt: null,
    headRefOid: "abc",
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    repository: { nameWithOwner: repo },
    author: null,
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    comments: 0,
  },
  events,
  ci: null,
});

const read = () => false;
const ids = (items: Item[]) => items.map((i) => i.pr.id);

describe("arrange", () => {
  it("puts the repository with the most news first, and news first within one", () => {
    const list = [
      item("a", "o/one", "2026-01-03"),
      item("b", "o/two", "2026-01-01"),
      item("c", "o/two", "2026-01-02"),
      item("d", "o/one", "2026-01-04"),
    ];
    const news = new Set(["b", "c"]);
    const { groups } = arrange(list, (i) => news.has(i.pr.id));
    expect(groups.map((g) => g.repo)).toEqual(["o/two", "o/one"]);
    expect(ids(groups[0]!.items)).toEqual(["c", "b"]);
  });

  it("puts one asked again first, then news, then the most recently active", () => {
    const rerequest: Event = { key: "k", kind: "rerequest", at: 1, who: null };
    const comment: Event = { key: "k2", kind: "comment", at: Date.parse("2026-02-01"), who: null };
    const list = [
      item("old", "o/one", "2026-01-01"),
      item("busy", "o/one", "2026-01-01", false, [comment]),
      item("news", "o/one", "2026-01-01"),
      item("again", "o/one", "2026-01-01", false, [rerequest]),
    ];
    const { groups } = arrange(list, (i) => i.pr.id === "news");
    expect(ids(groups[0]!.items)).toEqual(["again", "news", "busy", "old"]);
  });

  it("keeps drafts apart, in the same order", () => {
    const list = [item("x", "o/one", "2026-01-01", true), item("y", "o/two", "2026-01-05", true)];
    expect(ids(arrange(list, read).drafts)).toEqual(["y", "x"]);
    expect(arrange(list, read).groups).toEqual([]);
  });
});

describe("nextAfter", () => {
  const list = [
    item("a", "o/one", "2026-01-03"),
    item("b", "o/one", "2026-01-01"),
    item("c", "o/two", "2026-01-02"),
    item("d", "o/one", "2026-01-04", true),
  ];

  it("follows the panel's order: by repository, then the drafts", () => {
    expect(nextAfter(list, "a", read)?.pr.id).toBe("b");
    expect(nextAfter(list, "b", read)?.pr.id).toBe("c");
    expect(nextAfter(list, "c", read)?.pr.id).toBe("d");
  });

  it("goes back to the top past the end, and to it when the current one has left", () => {
    expect(nextAfter(list, "d", read)?.pr.id).toBe("a");
    expect(nextAfter(list, "gone", read)?.pr.id).toBe("a");
  });

  it("has none when it's the only one", () => {
    expect(nextAfter([list[0]!], "a", read)).toBeNull();
    expect(nextAfter([], "a", read)).toBeNull();
  });
});
