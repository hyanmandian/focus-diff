import { describe, expect, it } from "vitest";

import {
  createEstimator,
  isGenerated,
  kindOf,
  learnFile,
  LINES_PER_HOUR,
  MINUTES_PER_FILE,
  normalizeLearned,
  paceFactors,
  reviewMinutes,
  type Learned,
} from "./review-time";

describe("reviewMinutes", () => {
  it("reads added lines at the review pace, plus a moment to open the file", () => {
    expect(reviewMinutes("src/app.ts", { additions: LINES_PER_HOUR, deletions: 0 })).toBe(MINUTES_PER_FILE + 60);
  });

  it("counts removed lines at a quarter", () => {
    expect(reviewMinutes("src/app.ts", { additions: 0, deletions: 1000 })).toBe(MINUTES_PER_FILE + 12);
  });

  it("only opens generated and lock files", () => {
    expect(reviewMinutes("package-lock.json", { additions: 5000, deletions: 3000 })).toBe(MINUTES_PER_FILE);
    expect(reviewMinutes("web/dist/app.min.js", { additions: 1, deletions: 0 })).toBe(MINUTES_PER_FILE);
  });

  it("still counts files whose stats have not loaded", () => {
    expect(reviewMinutes("src/app.ts", null)).toBe(MINUTES_PER_FILE);
  });
});

describe("isGenerated", () => {
  it("spots lock files, bundles and snapshots, not regular code", () => {
    expect(
      ["yarn.lock", "go.sum", "a/__snapshots__/x.snap", "vendor/lib.js", "app.min.css"].every((each) =>
        isGenerated(each),
      ),
    ).toBe(true);
    expect(["src/lock.ts", "docs/dist.md", "src/vendors.ts"].some((each) => isGenerated(each))).toBe(false);
  });
});

describe("kindOf", () => {
  it("sorts files into the kinds a reader goes through at different paces", () => {
    expect(
      ["src/app.ts", "src/app.test.ts", "tests/e2e.py", "README.md", "src/app.css", "config/app.yml", "yarn.lock"].map(
        (path) => kindOf(path),
      ),
    ).toEqual(["code", "tests", "tests", "docs", "styles", "config", "generated"]);
  });
});

describe("learning the reader’s pace", () => {
  const nothing = normalizeLearned(null);
  const learnMany = (path: string, expected: number, actual: number, times: number) =>
    Array.from({ length: times }).reduce<Learned>((learned) => learnFile(learned, path, expected, actual), nothing);

  it("starts at the starting pace", () => {
    expect(paceFactors(nothing).all).toBe(1);
    const estimate = createEstimator(LINES_PER_HOUR, nothing);
    expect(estimate("src/app.ts", { additions: 100, deletions: 0 })).toBe(
      reviewMinutes("src/app.ts", { additions: 100, deletions: 0 }),
    );
  });

  it("moves a little with each file, and a lot with many", () => {
    const one = paceFactors(learnMany("src/app.ts", 2, 4, 1)).kinds.code;
    const many = paceFactors(learnMany("src/app.ts", 2, 4, 40)).kinds.code;
    expect(one).toBeGreaterThan(1);
    expect(one).toBeLessThan(1.3);
    expect(many).toBeGreaterThan(1.7);
    expect(many).toBeLessThanOrEqual(2);
  });

  it("learns each kind on its own, the rest leaning on the overall pace", () => {
    const learned = learnMany("src/app.test.ts", 4, 1, 30);
    const factors = paceFactors(learned);
    expect(factors.kinds.tests).toBeLessThan(0.5);
    expect(factors.kinds.code).toBeLessThan(1);
    expect(factors.kinds.code).toBeGreaterThan(factors.kinds.tests);
  });

  it("can’t be thrown far by one file left open", () => {
    const learned = learnFile(nothing, "src/app.ts", 1, 600);
    expect(learned.all.actual).toBe(6);
  });

  it("reads what was stored, whatever it holds", () => {
    expect(
      normalizeLearned({ all: { actual: "x", expected: -1, files: 3 }, kinds: { code: { actual: 2 }, nope: {} } }),
    ).toEqual({
      all: { actual: 0, expected: 0, files: 3 },
      kinds: { code: { actual: 2, expected: 0, files: 0 } },
    });
  });
});
