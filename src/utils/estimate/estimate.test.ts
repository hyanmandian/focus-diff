import { describe, expect, it } from "vitest";
import { createEstimator, creditFor, kindOf, learnFile, normalizeLearned, paceFactors, pullMinutes, reviewMinutes, share } from "@/utils/estimate/estimate";

describe("review time", () => {
  it("takes about an hour for 1,000 added lines", () => {
    expect(reviewMinutes("src/app.ts", { additions: 1000, deletions: 0 })).toBeCloseTo(60.25);
    // Removed lines count a fifth.
    expect(reviewMinutes("src/app.ts", { additions: 0, deletions: 1000 })).toBeCloseTo(12.25);
    // Generated and lock files only cost opening them.
    expect(reviewMinutes("yarn.lock", { additions: 9000, deletions: 0 })).toBe(0.25);
  });

  it("estimates a pull request from its totals", () => {
    expect(pullMinutes({ additions: 1000, deletions: 0, changedFiles: 4 }, null)).toBeCloseTo(61);
  });

  it("tells kinds of file apart", () => {
    expect(kindOf("src/app.test.ts")).toBe("tests");
    expect(kindOf("docs/setup.md")).toBe("docs");
    expect(kindOf("package-lock.json")).toBe("generated");
    expect(kindOf("src/app.ts")).toBe("code");
  });

});

describe("learning the reader's pace", () => {
  it("starts at the starting pace", () => {
    const { all, kinds } = paceFactors(normalizeLearned(null));
    expect(all).toBe(1);
    expect(kinds.code).toBe(1);
  });

  it("slows the estimates for a slow reader, most for the kind they're slow at", () => {
    let learned = normalizeLearned(null);
    for (let i = 0; i < 20; i++) learned = learnFile(learned, `src/f${i}.ts`, 5, 10);
    const { all, kinds } = paceFactors(learned);
    expect(all).toBeGreaterThan(1.5);
    expect(kinds.code).toBeGreaterThan(kinds.docs);
    const estimate = createEstimator(learned);
    expect(estimate("src/x.ts", { additions: 100, deletions: 0 })).toBeGreaterThan(reviewMinutes("src/x.ts", { additions: 100, deletions: 0 }) * 1.5);
  });

  it("can't be skewed by one file left open", () => {
    const learned = learnFile(normalizeLearned(null), "src/a.ts", 1, 600);
    expect(learned.all.actual).toBe(6);
    expect(learnFile(learned, "src/a.ts", 0, 5)).toBe(learned);
  });

  it("reads what's kept, dropping what's broken", () => {
    expect(normalizeLearned({ all: { actual: 3, expected: -1, files: "x" }, kinds: { code: { actual: 1 }, nope: {} } })).toEqual({
      all: { actual: 3, expected: 0, files: 0 },
      kinds: { code: { actual: 1, expected: 0, files: 0 } },
    });
  });
});

describe("time spent on files", () => {
  it("counts a still moment only up to a limit", () => {
    expect(creditFor(30_000)).toBe(30_000);
    expect(creditFor(10 * 60_000)).toBe(90_000);
    expect(creditFor(-5)).toBe(0);
  });

  it("shares it by how much of the screen each file takes", () => {
    expect(share(900, [["a", 200], ["b", 100]])).toEqual([["a", 600], ["b", 300]]);
    expect(share(900, [])).toEqual([]);
  });
});
