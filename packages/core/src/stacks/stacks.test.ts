import { describe, expect, it } from "vitest";

import { groupStacks, type Stackable } from "./stacks";

const pull = (name: string, base: string, more: Partial<Stackable> = {}) => ({
  name,
  repo: "octo/web",
  head: name,
  base,
  ...more,
});
const names = (list: Array<{ name: string }>) => list.map((each) => each.name);

describe("groupStacks", () => {
  it("puts a stack together, bottom first, where its first one stood", () => {
    const top = pull("c", "b");
    const lone = pull("x", "main");
    const bottom = pull("a", "main");
    const middle = pull("b", "a");
    const { list, places } = groupStacks([top, lone, bottom, middle]);
    expect(names(list)).toEqual(["a", "b", "c", "x"]);
    expect(places.get(bottom)).toEqual({ stack: "octo/web:a", index: 0, size: 3 });
    expect(places.get(middle)).toEqual({ stack: "octo/web:a", index: 1, size: 3 });
    expect(places.get(top)).toEqual({ stack: "octo/web:a", index: 2, size: 3 });
    expect(places.has(lone)).toBe(false);
  });

  it("leaves a list without stacks as it was", () => {
    const list = [pull("a", "main"), pull("b", "main"), pull("c", "develop")];
    expect(groupStacks(list)).toEqual({ list, places: new Map() });
  });

  it("goes up each branch built on the same one in the list's order", () => {
    const { list, places } = groupStacks([pull("b2", "a"), pull("a", "main"), pull("b1", "a"), pull("c", "b2")]);
    expect(names(list)).toEqual(["a", "b2", "c", "b1"]);
    expect([...places.values()].map((p) => p.size)).toEqual([4, 4, 4, 4]);
  });

  it("tells repositories apart, whatever the case of their names", () => {
    const { list, places } = groupStacks([
      pull("b", "a"),
      pull("a", "main", { repo: "octo/api" }),
      pull("a", "main", { repo: "Octo/Web" }),
    ]);
    expect(names(list)).toEqual(["a", "b", "a"]);
    expect(list[2]!.repo).toBe("octo/api");
    expect(places.size).toBe(2);
  });

  it("leaves forks, pull requests without branches, and ones on their own branch out", () => {
    const fork = pull("b", "a", { fork: true });
    const blank = pull("", "a");
    const self = pull("a", "a");
    expect(groupStacks([pull("a", "main"), fork, blank]).places.size).toBe(0);
    expect(groupStacks([self]).places.size).toBe(0);
  });

  it("follows the first of two pull requests on one branch", () => {
    const first = pull("a", "main");
    const again = pull("a", "develop");
    const { list, places } = groupStacks([pull("b", "a"), first, again]);
    expect(names(list)).toEqual(["a", "b", "a"]);
    expect(list[0]).toBe(first);
    expect(places.has(again)).toBe(false);
  });

  it("leaves a loop of branches, which has no bottom, as it was", () => {
    const list = [pull("a", "b"), pull("b", "a")];
    expect(groupStacks(list)).toEqual({ list, places: new Map() });
  });
});
