import { describe, expect, it } from "vite-plus/test";

import { descriptionText, diffForAi, isNoise, moves, numbered } from "@/utils/ai-diff/ai-diff";
import type { ReviewFile } from "@/utils/review/review";

const file = (path: string, patch: string, patch2: Partial<ReviewFile> = {}): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  patch,
  ...patch2,
});

describe("numbered", () => {
  it("numbers the new version's lines and keeps what a hunk removes in place, without a number", () => {
    const patch = [
      "@@ -10,4 +10,5 @@ fn total",
      " same",
      "-gone",
      "+new",
      "+newer",
      " same",
      "\\ No newline at end of file",
      "",
    ].join("\n");
    expect(numbered(patch)).toBe(
      ["@@ 10 fn total", "10  same", "-gone", "11 +new", "12 +newer", "13  same"].join("\n"),
    );
  });

  it("sums up hunks that only remove lines, and skips those with no change", () => {
    const patch = [
      "@@ -1,4 +1,2 @@",
      " a",
      "-b",
      "-c",
      " d",
      "@@ -20,2 +18,1 @@",
      "-x",
      " y",
      "@@ -40,1 +38,1 @@",
      " z",
      "@@ -50,1 +48,2 @@",
      "+only added",
    ].join("\n");
    expect(numbered(patch)).toBe(
      ["@@ 2 (removes 2 lines here)", "@@ 18 (removes 1 line here)", "@@ 48", "48 +only added"].join("\n"),
    );
  });

  it("keeps only the lines near a change, starting a hunk again after a gap", () => {
    const patch = ["@@ -1,9 +1,9 @@", " a", " b", "-c", "+C", " d", " e", " f", " g", "-h", "+H", " i"].join("\n");
    expect(numbered(patch, 1)).toBe(
      ["@@ 2", "2  b", "-c", "3 +C", "4  d", "@@ 7", "7  g", "-h", "8 +H", "9  i"].join("\n"),
    );
    expect(numbered(patch, 0)).toBe(["@@ 3", "-c", "3 +C", "@@ 8", "-h", "8 +H"].join("\n"));
  });

  it("shows a change of spacing alone as unchanged lines", () => {
    const patch = ["@@ -1,3 +1,3 @@", "-if (a) {", "-  go()", "+if (a)  {", "+    go()", "-x", "+y"].join("\n");
    expect(numbered(patch)).toBe(["@@ 1", "1  if (a)  {", "2      go()", "-x", "3 +y"].join("\n"));
  });

  it("ignores what comes before the first hunk", () => {
    expect(numbered("+++ b/x\n+stray")).toBe("");
  });
});

describe("diffForAi", () => {
  const code = "@@ -1 +1 @@\n-a\n+b";

  it("lists files by path, one line for removed files and the noise", () => {
    const text = diffForAi(
      [
        file("src/b.ts", code),
        file("package-lock.json", code, { additions: 900, deletions: 12 }),
        file("src/a.ts", code, { previousPath: "src/old.ts", status: "renamed" }),
        file("src/gone.ts", "@@ -1,3 +1,0 @@\n-x\n-y\n-z", { status: "removed", deletions: 3 }),
        file("logo.png", "", { additions: 0, deletions: 0 }),
        file("src/same.ts", code, { previousPath: "src/same.ts" }),
      ],
      10_000,
    );
    expect(text).toBe(
      [
        "## src/a.ts (renamed from src/old.ts)\n@@ 1\n-a\n1 +b",
        "## src/b.ts\n@@ 1\n-a\n1 +b",
        "## src/gone.ts (removed, 3 lines)",
        "## src/same.ts\n@@ 1\n-a\n1 +b",
        "Not shown (lockfiles, generated, binary or too large):\n- logo.png (+0 -0)\n- package-lock.json (+900 -12)",
      ].join("\n\n"),
    );
  });

  it("leaves out the largest files outside the main language first, and says which", () => {
    const big = `@@ -1 +1,40 @@\n${Array.from({ length: 40 }, (_, i) => `+line ${i}`).join("\n")}`;
    const files = [
      file("src/a.ts", code, { additions: 50 }),
      file("src/b.ts", big, { additions: 40 }),
      file("docs/notes.md", big, { additions: 40 }),
      file("scripts/x.py", code),
      file("Makefile", code),
    ];
    const text = diffForAi(files, 500);
    expect(text).toContain("## src/a.ts");
    expect(text).toContain("## scripts/x.py");
    expect(text).toContain("## Makefile");
    expect(text).not.toContain("## src/b.ts");
    expect(text).not.toContain("## docs/notes.md");
    expect(text).toContain("Left out to fit (ask about them by name):\n- docs/notes.md (+40 -1)\n- src/b.ts (+40 -1)");
    expect(diffForAi(files, 100_000)).not.toContain("Left out");
  });

  it("is empty with no files", () => {
    expect(diffForAi([], 10)).toBe("");
  });

  it("names files by id when they have one", () => {
    const ids = new Map([["src/b.ts", 2]]);
    const text = diffForAi([file("src/b.ts", code), file("src/c.ts", code), file("yarn.lock", code)], 10_000, {
      ids,
      context: 0,
    });
    expect(text).toContain("## [2] src/b.ts\n@@ 1");
    expect(text).toContain("## src/c.ts");
    expect(text).toContain("- yarn.lock (+1 -1)");
  });

  it("tells code moved between files from code written anew, and a change of spacing alone", () => {
    const block = ["const total = sum(items);", "const tax = total * rate;", "return total + tax;"];
    const from = `@@ -1,5 +1,2 @@\n keep()\n${block.map((l) => `-${l}`).join("\n")}\n-short\n+tall`;
    const to = `@@ -0,0 +1,4 @@\n+export function price() {\n${block.map((l) => `+  ${l}`).join("\n")}`;
    const spacing = "@@ -1,1 +1,1 @@\n-a  =  1\n+a = 1";
    const text = diffForAi([file("a.ts", from), file("b.ts", to), file("c.ts", spacing)], 10_000, { context: 0 });
    expect(text).toContain("## a.ts\n@@ 2\n-(3 lines moved elsewhere in the diff)\n-short\n2 +tall");
    const partly = `@@ -1,4 +1,0 @@\n${block.map((l) => `-${l}`).join("\n")}\n-short`;
    expect(numbered(partly, 3, moves([to]))).toBe("@@ 1 (removes 4 lines here, 3 of them moved elsewhere in the diff)");
    expect(text).toContain("## b.ts\n@@ 1\n1 +export function price() {\n2-4 +(3 lines moved here unchanged)");
    expect(text).toContain("## c.ts (only spacing changed)");
    const gone = `@@ -1,3 +1,0 @@\n${block.map((l) => `-${l}`).join("\n")}`;
    expect(numbered(gone, 3, moves([to]))).toBe("@@ 1 (moves 3 lines elsewhere in the diff)");
    expect(numbered(gone, 3, moves([]))).toBe("@@ 1 (removes 3 lines here)");
    expect(numbered(`@@ -1,2 +1,2 @@\n-${block[0]!}\n-${block[1]!}\n+x`, 3, moves([to]))).toBe(
      `@@ 1\n-${block[0]!}\n-${block[1]!}\n1 +x`,
    );
  });

  it("tells noise from code", () => {
    for (const path of [
      "yarn.lock",
      "a/pnpm-lock.yaml",
      "Cargo.lock",
      "x.min.js",
      "a.css.map",
      "t/__snapshots__/a.ts",
      "a.snap",
      "dist/x.js",
      "vendor/y.go",
      "go.sum",
    ])
      expect(isNoise(path)).toBe(true);
    for (const path of ["src/lock.ts", "README", "distance.ts", "src/vendors.ts"]) expect(isNoise(path)).toBe(false);
  });
});

describe("descriptionText", () => {
  it("keeps the text, marks done tasks and drops empty ones and template comments", () => {
    const html = [
      "<p>Fixes totals.</p>",
      '<ul><li class="task-list-item"><input type="checkbox" checked disabled> Tests</li>',
      '<li class="task-list-item"><input type="checkbox" disabled> Docs</li>',
      '<li class="task-list-item"><input type="checkbox" disabled> </li></ul>',
      "<p>&lt;!-- Describe your change --&gt;</p>",
      "\n\n\n\n<p>End</p>",
      '<input type="checkbox">',
    ].join("\n");
    expect(descriptionText(html)).toBe("Fixes totals.\n[x] Tests\n[ ] Docs\n\nEnd\n[ ]");
  });
});
