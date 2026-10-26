import { getSingularPatch, parseDiffFromFile } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { findingSide, hunkTail, lineText, placeThread } from "@/utils/placement/placement";

// Lines 10–14 of the old version, 10–15 of the new: line 11 changed, line 13 added.
const diff = getSingularPatch(
  [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -10,5 +10,6 @@",
    " one",
    "-two",
    "+TWO",
    " three",
    "+new",
    " four",
    " five",
    "",
  ].join("\n"),
);

describe("a line's text", () => {
  it("reads either side of a hunk", () => {
    expect(lineText(diff, "additions", 11)).toBe("TWO");
    expect(lineText(diff, "deletions", 11)).toBe("two");
    expect(lineText(diff, "additions", 13)).toBe("new");
    expect(lineText(diff, "deletions", 13)).toBe("four");
  });

  it("is null outside the hunks", () => {
    expect(lineText(diff, "additions", 9)).toBeNull();
    expect(lineText(diff, "additions", 16)).toBeNull();
  });

  it("reads any line of a full file, in or out of the hunks", () => {
    const full = parseDiffFromFile(
      { name: "a.ts", contents: "one\ntwo\nthree\nfour\n" },
      { name: "a.ts", contents: "one\nTWO\nthree\nfour\n" },
    );
    expect(full.isPartial).toBe(false);
    expect(lineText(full, "additions", 4)).toBe("four");
    expect(lineText(full, "deletions", 2)).toBe("two");
    expect(lineText(full, "additions", 0)).toBeNull();
    expect(lineText(full, "additions", 9)).toBeNull();
  });
});

describe("placing a conversation", () => {
  it("puts a current one at its line, on its side", () => {
    expect(placeThread(diff, { side: "deletions", line: 11, outdated: false })).toEqual({
      side: "deletions",
      lineNumber: 11,
      moved: false,
    });
  });

  it("puts one on the file, or on a line not shown, at the top", () => {
    expect(placeThread(diff, { side: "additions", line: 0, outdated: false })).toMatchObject({
      lineNumber: 0,
      moved: true,
    });
    expect(placeThread(diff, { side: "additions", line: 40, outdated: false })).toMatchObject({
      lineNumber: 0,
      moved: true,
    });
  });

  it("keeps an outdated one at its line only where that line is still the same code", () => {
    expect(placeThread(diff, { side: "additions", line: 13, outdated: true, context: "new" })).toMatchObject({
      lineNumber: 13,
      moved: false,
    });
    // Same number, other code: never pinned there.
    expect(placeThread(diff, { side: "additions", line: 11, outdated: true, context: "two" })).toMatchObject({
      lineNumber: 0,
      moved: true,
    });
    expect(placeThread(diff, { side: "additions", line: 11, outdated: true })).toMatchObject({
      lineNumber: 0,
      moved: true,
    });
  });

  it("reads the commented line from GitHub's diff hunk", () => {
    expect(hunkTail("@@ -1,2 +1,3 @@\n a\n+b\n")).toBe("b");
    expect(hunkTail("@@ -1,2 +1,3 @@")).toBeUndefined();
    expect(hunkTail(null)).toBeUndefined();
  });
});

describe("an AI comment's side", () => {
  it("is the new version's, unless only the old side shows that line", () => {
    expect(findingSide(diff, 11)).toBe("additions");
    const deleted = getSingularPatch(
      ["diff --git a/b.ts b/b.ts", "--- a/b.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-a", "-b", ""].join("\n"),
    );
    expect(findingSide(deleted, 2)).toBe("deletions");
  });
});
