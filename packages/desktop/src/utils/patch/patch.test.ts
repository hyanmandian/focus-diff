import { describe, expect, it } from "vite-plus/test";

import { patchLines } from "@/utils/patch/patch";

describe("patchLines", () => {
  it("numbers each line on both sides of the diff", () => {
    const patch = "diff --git a/a b/a\n@@ -3,3 +3,3 @@\n keep\n-gone\n+came\n\\ No newline at end of file\n tail";
    expect([...patchLines(patch)].map(({ kind, old, now }) => [kind, old, now])).toEqual([
      [" ", 3, 3],
      ["-", 4, 4],
      ["+", 5, 4],
      [" ", 5, 5],
    ]);
  });
});
