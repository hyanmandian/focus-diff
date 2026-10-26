import { describe, expect, it } from "vitest";
import { commitRange, inRange, sameRange, sinceReview, type Commit, type Commits } from "@/utils/commits/commits";

const commit = (oid: string, parent: string | null): Commit => ({ oid, short: oid.slice(0, 7), headline: oid, body: "", at: "2026-01-01T00:00:00Z", author: { login: "ana", name: "Ana", avatarUrl: null }, verified: null, ci: null, parent });
const commits = [commit("a", "base"), commit("b", "a"), commit("c", "b"), commit("d", "c")];
const list = (reviewed: string | null): Commits => ({ commits, forcePushes: [], reviewed });

describe("ranges", () => {
  it("makes one commit's range from its parent", () => {
    expect(commitRange(commits, 1, 1)).toEqual({ from: "a", to: "b" });
    expect(commitRange(commits, 0, 0)).toEqual({ from: "base", to: "a" });
  });

  it("makes a run of commits in either order, and all of them no range at all", () => {
    expect(commitRange(commits, 2, 1)).toEqual({ from: "a", to: "c" });
    expect(commitRange(commits, 0, 3)).toBeNull();
    expect(commitRange(commits, 5, 5)).toBeNull();
  });

  it("knows which commits a range shows", () => {
    expect(inRange(commits, null)).toEqual([0, 1, 2, 3]);
    expect(inRange(commits, { from: "a", to: "c" })).toEqual([1, 2]);
    expect(inRange(commits, { from: "base", to: "a" })).toEqual([0]);
    expect(inRange(commits, { from: "gone", to: "d" })).toEqual([]);
    expect(inRange(commits, { from: "a", to: "gone" })).toEqual([]);
  });

  it("compares ranges by their commits", () => {
    expect(sameRange({ from: "a", to: "b" }, { from: "a", to: "b" })).toBe(true);
    expect(sameRange(null, null)).toBe(true);
    expect(sameRange(null, { from: "a", to: "b" })).toBe(false);
  });
});

describe("since your last review", () => {
  it("goes from the commit reviewed to the head", () => {
    expect(sinceReview(list("b"))).toEqual({ range: { from: "b", to: "d" }, count: 2, rewritten: false });
  });

  it("is nothing when not reviewed, or when nothing's new", () => {
    expect(sinceReview(list(null))).toBeNull();
    expect(sinceReview(list("d"))).toBeNull();
  });

  it("compares the two versions after a force push", () => {
    expect(sinceReview(list("old"))).toEqual({ range: { from: "old", to: "d" }, count: 0, rewritten: true });
  });
});
