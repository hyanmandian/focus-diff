import { describe, expect, it } from "vite-plus/test";

import {
  applyEdits,
  coAuthors,
  linesFromPatch,
  suggestionBlock,
  SuggestionError,
  suggestionsIn,
  toBase64,
} from "@/utils/suggestion/suggestion";

describe("suggestionBlock", () => {
  it("starts as the lines themselves", () => {
    expect(suggestionBlock(["  const a = 1;", "  return a;"])).toBe("```suggestion\n  const a = 1;\n  return a;\n```");
    expect(suggestionBlock([])).toBe("```suggestion\n```");
  });

  it("fences longer than any backticks in the code", () => {
    expect(suggestionBlock(["const md = '```js';"])).toBe("````suggestion\nconst md = '```js';\n````");
  });
});

describe("suggestionsIn", () => {
  it("reads each block's lines, and nothing from other code blocks", () => {
    const body =
      "Try this:\r\n```suggestion\n  const a = 2;\n```\nand\n```js\n```suggestion\nnot one\n```\n~~~suggestion\n~~~";
    expect(suggestionsIn(body)).toEqual([["  const a = 2;"], []]);
  });

  it("reads a longer fence and runs an unclosed block to the end", () => {
    expect(suggestionsIn("````suggestion\nx = '```'\n````")).toEqual([["x = '```'"]]);
    expect(suggestionsIn("```suggestion\na\nb")).toEqual([["a", "b"]]);
  });

  it("finds none in plain text", () => {
    expect(suggestionsIn("Looks good to me")).toEqual([]);
  });
});

describe("applyEdits", () => {
  const file = "one\ntwo\nthree\nfour\n";

  it("replaces lines, keeping the final newline", () => {
    expect(applyEdits(file, [{ start: 2, end: 3, lines: ["2", "2.5", "3"] }])).toBe("one\n2\n2.5\n3\nfour\n");
    expect(applyEdits("a\nb", [{ start: 2, end: 2, lines: ["B"] }])).toBe("a\nB");
  });

  it("removes lines when the suggestion is empty", () => {
    expect(applyEdits(file, [{ start: 1, end: 1, lines: [] }])).toBe("two\nthree\nfour\n");
  });

  it("applies a batch from the bottom up, whatever its order", () => {
    expect(
      applyEdits(file, [
        { start: 4, end: 4, lines: ["4"] },
        { start: 1, end: 1, lines: ["1", "1.5"] },
      ]),
    ).toBe("1\n1.5\ntwo\nthree\n4\n");
  });

  it("keeps Windows line endings", () => {
    expect(applyEdits("a\r\nb\r\n", [{ start: 1, end: 1, lines: ["A"] }])).toBe("A\r\nb\r\n");
  });

  it("refuses overlapping edits and lines past the end", () => {
    expect(() =>
      applyEdits(file, [
        { start: 1, end: 2, lines: [] },
        { start: 2, end: 3, lines: [] },
      ]),
    ).toThrow(SuggestionError);
    expect(() => applyEdits(file, [{ start: 4, end: 5, lines: [] }])).toThrow(
      expect.objectContaining({ reason: "outside" }),
    );
  });
});

describe("linesFromPatch", () => {
  const patch =
    "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -10,4 +10,5 @@ fn x() {\n   keep\n-  old\n+  new\n+  newer\n   tail";

  it("reads either side's lines", () => {
    expect(linesFromPatch(patch, 11, 12, "additions")).toEqual(["  new", "  newer"]);
    expect(linesFromPatch(patch, 10, 11, "deletions")).toEqual(["  keep", "  old"]);
  });

  it("skips the patch's no-newline notes", () => {
    const end = "@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b";
    expect(linesFromPatch(end, 1, 1, "deletions")).toEqual(["a"]);
    expect(linesFromPatch(end, 1, 1, "additions")).toEqual(["b"]);
  });

  it("knows when the patch doesn't show them", () => {
    expect(linesFromPatch(patch, 1, 2, "additions")).toBeNull();
  });
});

describe("coAuthors", () => {
  it("credits each author once with GitHub's no-reply address, never yourself", () => {
    expect(
      coAuthors(
        [
          { login: "ana", name: "Ana Lima", databaseId: 7 },
          { login: "ana", name: "Ana Lima", databaseId: 7 },
          { login: "you", databaseId: 9 },
          { login: "bot", databaseId: null },
        ],
        "you",
      ),
    ).toEqual(["Co-authored-by: Ana Lima <7+ana@users.noreply.github.com>"]);
  });

  it("names someone by their login when they have no name", () => {
    expect(
      coAuthors(
        [
          { login: "bo", name: "  ", databaseId: 3 },
          { login: "cy", databaseId: 4 },
        ],
        null,
      ),
    ).toEqual([
      "Co-authored-by: bo <3+bo@users.noreply.github.com>",
      "Co-authored-by: cy <4+cy@users.noreply.github.com>",
    ]);
  });
});

describe("toBase64", () => {
  it("encodes UTF-8", () => {
    expect(toBase64("olá ✓")).toBe("b2zDoSDinJM=");
  });
});
