import { describe, expect, it } from "vite-plus/test";

import { ignoreWhitespace } from "@/utils/whitespace/whitespace";

const head = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";

describe("hiding whitespace changes", () => {
  it("shows re-indented lines as unchanged, keeping real changes", () => {
    const patch = `${head}@@ -1,3 +1,3 @@\n if (a) {\n-call(x);\n-old();\n+  call(x);\n+  fresh();\n }\n`;
    expect(ignoreWhitespace(patch)).toBe(`${head}@@ -1,3 +1,3 @@\n if (a) {\n   call(x);\n-old();\n+  fresh();\n }\n`);
  });

  it("drops a hunk left with no changes", () => {
    const patch = `${head}@@ -1,2 +1,2 @@\n-a  =  1\n+a = 1\n b\n@@ -9,2 +9,2 @@\n c\n-d\n+e\n`;
    expect(ignoreWhitespace(patch)).toBe(`${head}@@ -9,2 +9,2 @@\n c\n-d\n+e\n`);
  });

  it("keeps a file whose changes are all whitespace as it is", () => {
    const patch = `${head}@@ -1,1 +1,1 @@\n-a\t=1\n+a = 1\n`;
    expect(ignoreWhitespace(patch)).toBe(patch);
  });

  it("leaves a run ending without a newline alone", () => {
    const patch = `${head}@@ -1,1 +1,1 @@\n-a = 1\n\\ No newline at end of file\n+a  = 1\n`;
    expect(ignoreWhitespace(patch)).toBe(patch);
  });

  it("pairs lines in order, removed before added between pairs", () => {
    const patch = `${head}@@ -1,3 +1,3 @@\n-x\n-  y\n-z\n+w\n+y\n+v\n`;
    expect(ignoreWhitespace(patch)).toBe(`${head}@@ -1,3 +1,3 @@\n-x\n+w\n y\n-z\n+v\n`);
  });

  it("pairs a huge run's lines only at the same place", () => {
    const removed = Array.from({ length: 2001 }, (_, i) => `-line${i}`);
    const added = ["+other", ...Array.from({ length: 2000 }, (_, i) => `+  line${i + 1}`)];
    const patch = `${head}@@ -1,2001 +1,2001 @@\n${[...removed, ...added].join("\n")}\n`;
    const out = ignoreWhitespace(patch).split("\n");
    expect(out.slice(3, 7)).toEqual(["@@ -1,2001 +1,2001 @@", "-line0", "+other", "   line1"]);
    expect(out.filter((l) => /^[-+][^-+]/u.test(l))).toEqual(["-line0", "+other"]);
  });
});
