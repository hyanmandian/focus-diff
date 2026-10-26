import { describe, expect, it } from "vitest";

import {
  attempt,
  choice,
  fields,
  flag,
  integer,
  list,
  maybe,
  maybeText,
  Mismatch,
  nested,
  requiredText,
  text,
  texts,
} from "./json-decode";

describe("reading JSON by serde's rules", () => {
  it("takes defaults for what's missing", () => {
    expect(text({}, "a")).toBe("");
    expect(maybeText({}, "a")).toBeNull();
    expect(maybeText({ a: null }, "a")).toBeNull();
    expect(flag({}, "a", true)).toBe(true);
    expect(integer({}, "a", { fallback: 7 })).toBe(7);
    expect(texts({}, "a")).toStrictEqual([]);
    expect(list({}, "a", String)).toStrictEqual([]);
    expect(maybe({ a: null }, "a", String)).toBeNull();
    expect(nested({}, "a", fields, () => ({ b: 1 }))).toStrictEqual({ b: 1 });
    expect(choice({}, "a", ["x", "y"], "y")).toBe("y");
  });

  it("reads what's there", () => {
    expect(text({ a: "x" }, "a")).toBe("x");
    expect(maybeText({ a: "x" }, "a")).toBe("x");
    expect(requiredText({ a: "x" }, "a")).toBe("x");
    expect(flag({ a: false }, "a", true)).toBe(false);
    expect(integer({ a: -3 }, "a")).toBe(-3);
    expect(texts({ a: ["x"] }, "a")).toStrictEqual(["x"]);
    expect(list({ a: [1] }, "a", (v) => Number(v) + 1)).toStrictEqual([2]);
    expect(maybe({ a: 1 }, "a", String)).toBe("1");
    expect(choice({ a: "x" }, "a", ["x", "y"], "y")).toBe("x");
    expect(choice({ a: "z" }, "a", ["x", "y"], "y")).toBe("y");
  });

  it("fails on the wrong type, and attempt turns that into null", () => {
    const bad: Array<() => unknown> = [
      () => fields(null),
      () => fields([]),
      () => text({ a: null }, "a"),
      () => maybeText({ a: 1 }, "a"),
      () => requiredText({}, "a"),
      () => flag({ a: 1 }, "a"),
      () => integer({ a: 1.5 }, "a"),
      () => integer({ a: -1 }, "a", { min: 0 }),
      () => integer({ a: 300 }, "a", { max: 255 }),
      () => integer({ a: "1" }, "a"),
      () => texts({ a: "x" }, "a"),
      () => texts({ a: [1] }, "a"),
      () => list({ a: {} }, "a", String),
      () => nested({ a: null }, "a", fields, () => ({})),
      () => choice({ a: 1 }, "a", ["x"], "x"),
    ];
    for (const read of bad) {
      expect(read).toThrow(Mismatch);
      expect(attempt(read)).toBeNull();
    }
  });

  it("lets other errors through", () => {
    expect(() =>
      attempt(() => {
        throw new RangeError("boom");
      }),
    ).toThrow(RangeError);
  });
});
