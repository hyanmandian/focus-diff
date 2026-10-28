import { describe, expect, it } from "vite-plus/test";

import { findInPatches, rangesIn } from "@/utils/find/find";

describe("findInPatches", () => {
  const patch = [
    "@@ -10,4 +10,5 @@",
    " const total = cart.total;",
    "-const code = promo.code;",
    "+const code = promo.code ?? PROMO;",
    "+check(promo);",
    "\\ No newline at end of file",
    " return total;",
  ].join("\n");

  it("finds each occurrence, on its side and line, ignoring case", () => {
    expect(findInPatches([{ path: "a.ts", patch }], "Promo")).toEqual([
      { path: "a.ts", side: "deletions", line: 11, nth: 0 },
      { path: "a.ts", side: "additions", line: 11, nth: 0 },
      { path: "a.ts", side: "additions", line: 11, nth: 1 },
      { path: "a.ts", side: "additions", line: 12, nth: 0 },
    ]);
    expect(findInPatches([{ path: "a.ts", patch }], "total")).toEqual([
      { path: "a.ts", side: "additions", line: 10, nth: 0 },
      { path: "a.ts", side: "additions", line: 10, nth: 1 },
      { path: "a.ts", side: "additions", line: 13, nth: 0 },
    ]);
  });

  it("finds nothing for an empty query, or outside a hunk", () => {
    expect(findInPatches([{ path: "a.ts", patch }], "  ")).toEqual([]);
    expect(findInPatches([{ path: "b.ts", patch: "+promo outside any hunk" }], "promo")).toEqual([]);
  });
});

describe("rangesIn", () => {
  const line = () => {
    const element = document.createElement("div");
    element.innerHTML = "<span>const </span><span>pro</span><span>mo</span><span> = promo;</span>";
    return element;
  };

  it("spans a match across the pieces syntax colouring cuts a line into", () => {
    const ranges = rangesIn(line(), "PROMO");
    expect(ranges.map((r) => r.toString())).toEqual(["promo", "promo"]);
    expect(ranges[0]!.startContainer.textContent).toBe("pro");
    expect(ranges[0]!.endContainer.textContent).toBe("mo");
  });

  it("finds nothing for an empty query", () => {
    expect(rangesIn(line(), " ")).toEqual([]);
  });
});
