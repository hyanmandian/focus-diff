import { describe, expect, it } from "vitest";
import { commentable } from "./ai";

describe("commentable", () => {
  it("takes the lines the diff adds or shows, in the new file", () => {
    const patch = ["diff --git a/x b/x", "--- a/x", "+++ b/x", "@@ -10,4 +10,5 @@ fn", " same", "-gone", "+new", "+newer", " same", "\\ No newline at end of file", "@@ -40,2 +41,2 @@", " kept"].join("\n");
    expect([...commentable(patch)]).toEqual([10, 11, 12, 13, 41]);
  });
});
