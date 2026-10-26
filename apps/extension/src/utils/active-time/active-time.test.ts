import { describe, expect, it } from "vitest";

import { creditFor, share } from "./active-time";

describe("creditFor", () => {
  it("counts a still moment as reading, up to a minute and a half", () => {
    expect(creditFor(800)).toBe(800);
    expect(creditFor(40_000)).toBe(40_000);
    expect(creditFor(30 * 60_000)).toBe(90_000);
    expect(creditFor(-5)).toBe(0);
  });
});

describe("share", () => {
  it("splits the time among the files on screen by how much of it each takes", () => {
    expect(
      share(9000, [
        ["a.ts", 600],
        ["b.ts", 300],
      ]),
    ).toEqual([
      ["a.ts", 6000],
      ["b.ts", 3000],
    ]);
    expect(share(9000, [])).toEqual([]);
  });
});
