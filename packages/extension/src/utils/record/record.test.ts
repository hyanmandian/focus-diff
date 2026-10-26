import { describe, expect, it } from "vitest";

import { asRecord, asText, isRecord, keysOf, oneOf, recordOf } from "./record";

describe("record", () => {
  it("tells objects from everything else", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("text")).toBe(false);
  });

  it("reads an object's fields, or none", () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord("text")).toEqual({});
  });

  it("reads strings and numbers as text, and nothing else", () => {
    expect(asText("ada")).toBe("ada");
    expect(asText(12)).toBe("12");
    expect(asText({})).toBe("");
  });

  it("keeps a value only when it's on the list", () => {
    expect(oneOf([2, 5], 5, 2)).toBe(5);
    expect(oneOf([2, 5], "5", 2)).toBe(2);
  });

  it("lists a record's keys and builds one from keys", () => {
    expect(keysOf({ grouped: true, sticky: false })).toEqual(["grouped", "sticky"]);
    expect(recordOf(["a", "b"], (key) => key.toUpperCase())).toEqual({ a: "A", b: "B" });
  });
});
