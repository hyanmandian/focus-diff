import { describe, expect, it } from "vite-plus/test";

import { lineRange } from "./range";

describe("lines picked for a comment", () => {
  it("is one line, with its side", () => {
    expect(lineRange({ start: 4, end: 4, side: "deletions", endSide: "deletions" })).toEqual({
      side: "deletions",
      line: 4,
    });
  });

  it("starts at the earlier line, dragged either way", () => {
    expect(lineRange({ start: 9, end: 5, side: "additions", endSide: "additions" })).toEqual({
      side: "additions",
      line: 9,
      startSide: "additions",
      startLine: 5,
    });
  });

  it("starts on the old side across the two", () => {
    expect(lineRange({ start: 12, end: 3, side: "additions", endSide: "deletions" })).toEqual({
      side: "additions",
      line: 12,
      startSide: "deletions",
      startLine: 3,
    });
    expect(lineRange({ start: 3, end: 12, side: "deletions", endSide: "additions" })).toEqual({
      side: "additions",
      line: 12,
      startSide: "deletions",
      startLine: 3,
    });
  });

  it("takes the new side when the selection names no side", () => {
    expect(lineRange({ start: 2, end: 2 })).toEqual({ side: "additions", line: 2 });
  });

  it("takes the other end's side when one end names none", () => {
    expect(lineRange({ start: 2, end: 4, endSide: "deletions" })).toEqual({
      side: "deletions",
      line: 4,
      startSide: "deletions",
      startLine: 2,
    });
    expect(lineRange({ start: 2, end: 4, side: "deletions" })).toEqual({
      side: "deletions",
      line: 4,
      startSide: "deletions",
      startLine: 2,
    });
  });
});
