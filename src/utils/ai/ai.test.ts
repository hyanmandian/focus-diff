import { describe, expect, it } from "vite-plus/test";

import { commentable, linesFromPatch } from "@/utils/ai/ai";

describe("commentable", () => {
  it("takes the lines the diff adds or shows, in the new file", () => {
    const patch = [
      "diff --git a/x b/x",
      "--- a/x",
      "+++ b/x",
      "@@ -10,4 +10,5 @@ fn",
      " same",
      "-gone",
      "+new",
      "+newer",
      " same",
      "\\ No newline at end of file",
      "@@ -40,2 +41,2 @@",
      " kept",
    ].join("\n");
    expect([...commentable(patch)]).toEqual([10, 11, 12, 13, 41]);
  });
});

describe("linesFromPatch", () => {
  it("takes the selected lines of the new version, or of the old", () => {
    const patch = ["@@ -10,3 +10,4 @@", " same", "-gone", "+new", "+newer", " end"].join("\n");
    expect(linesFromPatch(patch, 11, 12)).toBe("+new\n+newer");
    expect(linesFromPatch(patch, 11, 11, "deletions")).toBe("-gone");
  });
});
