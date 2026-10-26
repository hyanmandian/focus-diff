import { describe, expect, it } from "vitest";

import type { DiffFilter } from "@/utils/config/config";
import { reviewMinutes } from "@/utils/estimate/estimate";
import {
  addImported,
  exportFilters,
  filtersFor,
  importFilters,
  inAny,
  keptSelection,
  nextFile,
  nextFilterWithWork,
  repoMatches,
  stepFilter,
  toggled,
  totals,
} from "@/utils/filters/filters";

const filter = (id: string, include: string, repos: string[] = [], exclude = ""): DiffFilter => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  include,
  exclude,
  repos,
});
const frontend = filter("frontend", "\\.tsx?$", [], "\\.test\\.");
const docs = filter("docs", "\\.md$");
const payments = filter("payments", "^payments/", ["acme/web", "acme/*"]);

describe("per repository", () => {
  it("matches owner/name and owner/*, ignoring case", () => {
    expect(repoMatches("acme/web", "Acme/Web")).toBe(true);
    expect(repoMatches("acme/*", "acme/api")).toBe(true);
    expect(repoMatches("acme/*", "acmeinc/api")).toBe(false);
    expect(repoMatches("acme/web", "acme/website")).toBe(false);
  });

  it("gives a repository the filters for everywhere and its own", () => {
    const solo = filter("solo", "", ["other/repo"]);
    expect(filtersFor([frontend, payments, solo], "acme/api").map((f) => f.id)).toEqual(["frontend", "payments"]);
    expect(filtersFor([frontend, payments, solo], "other/repo").map((f) => f.id)).toEqual(["frontend", "solo"]);
  });
});

describe("combining filters", () => {
  it("reads the old single choice and the new list", () => {
    expect(keptSelection("frontend")).toEqual(["frontend"]);
    expect(keptSelection("")).toEqual([]);
    expect(keptSelection(["a", 3, "b"])).toEqual(["a", "b"]);
    expect(keptSelection(null)).toEqual([]);
  });

  it("toggles filters in and out; All clears them", () => {
    expect(toggled([], "docs")).toEqual(["docs"]);
    expect(toggled(["docs"], "frontend")).toEqual(["docs", "frontend"]);
    expect(toggled(["docs", "frontend"], "docs")).toEqual(["frontend"]);
    expect(toggled(["docs"], "")).toEqual([]);
  });

  it("keeps the union, or everything with none on", () => {
    expect(inAny([frontend, docs], "src/app.tsx")).toBe(true);
    expect(inAny([frontend, docs], "README.md")).toBe(true);
    expect(inAny([frontend, docs], "src/app.test.tsx")).toBe(false);
    expect(inAny([], "anything.go")).toBe(true);
  });

  it("steps one filter at a time, through All", () => {
    expect(stepFilter(["a", "b"], [], 1)).toEqual(["a"]);
    expect(stepFilter(["a", "b"], ["b"], 1)).toEqual([]);
    expect(stepFilter(["a", "b"], [], -1)).toEqual(["b"]);
    expect(stepFilter(["a", "b"], ["b", "a"], -1)).toEqual(["a"]);
  });
});

describe("breakdown and the next file", () => {
  const files = [
    { path: "src/app.tsx", additions: 100, deletions: 50 },
    { path: "README.md", additions: 10, deletions: 0 },
    { path: "package-lock.json", additions: 5000, deletions: 3000 },
  ];
  const viewed = new Set(["README.md"]);
  const isViewed = (f: { path: string }) => viewed.has(f.path);

  it("adds up files, viewed, lines and time left", () => {
    const t = totals(files, isViewed, reviewMinutes);
    expect(t).toMatchObject({ files: 3, viewed: 1, additions: 5110, deletions: 3050 });
    // A lockfile only costs opening it.
    expect(t.minutesLeft).toBeCloseTo(reviewMinutes("src/app.tsx", files[0]!) + 0.25);
    expect(t.minutes).toBeGreaterThan(t.minutesLeft);
  });

  it("finds the next filter with files left", () => {
    expect(nextFilterWithWork(files, [frontend, docs], ["docs"], isViewed)).toEqual({
      id: "frontend",
      name: "Frontend",
      left: 1,
    });
    expect(nextFilterWithWork(files, [frontend, docs], ["frontend"], isViewed)).toBeUndefined();
  });

  it("goes to the next file not viewed, wrapping around", () => {
    expect(nextFile(files, isViewed, { path: "src/app.tsx", reached: true })?.path).toBe("package-lock.json");
    expect(nextFile(files, isViewed, { path: "package-lock.json", reached: true })?.path).toBe("src/app.tsx");
    expect(nextFile(files, isViewed, { path: "src/app.tsx", reached: false })?.path).toBe("src/app.tsx");
    expect(nextFile(files, () => true, null)).toBeUndefined();
  });
});

describe("sharing with Focus Diff", () => {
  // As Focus Diff's settings copy it: JSON.stringify(normalize(config), null, 2).
  const fromExtension = JSON.stringify(
    {
      global: [{ id: "k3j9x0aa", name: "Frontend", include: "\\.(tsx?|css)$", exclude: "\\.test\\." }],
      repos: [
        { repo: "acme/web", filters: [{ id: "p1", name: "Payments", include: "^payments/", exclude: "" }] },
        { repo: "acme/*", filters: [{ id: "p2", name: "Payments", include: "^payments/", exclude: "" }] },
        { repo: "group/sub/name", filters: [{ id: "g1", name: "Nested", include: "", exclude: "" }] },
        { repo: "acme/api", filters: [{ id: "bad", name: "Broken", include: "(", exclude: "" }, { name: 3 }] },
      ],
    },
    null,
    2,
  );

  it("imports Focus Diff's text, a filter under several repositories as one", () => {
    const filters = importFilters(fromExtension)!;
    expect(filters.map((f) => [f.name, f.repos])).toEqual([
      ["Frontend", []],
      ["Payments", ["acme/web", "acme/*"]],
      ["Broken", ["acme/api"]],
    ]);
    // Through the config's own checks: a broken pattern is emptied.
    expect(filters[2]!.include).toBe("");
  });

  it("copies in Focus Diff's exact shape", () => {
    const text = exportFilters([frontend, payments]);
    const parsed = JSON.parse(text) as { global: object[]; repos: Array<{ repo: string; filters: object[] }> };
    expect(text).toBe(JSON.stringify(parsed, null, 2));
    expect(Object.keys(parsed)).toEqual(["global", "repos"]);
    expect(Object.keys(parsed.global[0]!)).toEqual(["id", "name", "include", "exclude"]);
    expect(parsed.repos.map((r) => r.repo)).toEqual(["acme/web", "acme/*"]);
    // Ids unique across the whole text, as Focus Diff keeps them.
    const ids = [...parsed.global, ...parsed.repos.flatMap((r) => r.filters)].map((f) => (f as { id: string }).id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("round-trips", () => {
    const own = [frontend, docs, payments];
    expect(importFilters(exportFilters(own))).toEqual(own);
    const again = importFilters(fromExtension)!;
    expect(importFilters(exportFilters(again))).toEqual(again);
  });

  it("tells text that isn't filters from text with none", () => {
    expect(importFilters("not json")).toBeNull();
    expect(importFilters('{"theme": "dark"}')).toBeNull();
    expect(importFilters('{"global": [], "repos": []}')).toEqual([]);
  });

  it("adds what's new, up to twelve, with unique ids", () => {
    const { filters, added, skipped } = addImported([frontend], [{ ...frontend }, { ...docs, id: "frontend" }]);
    expect(added).toBe(1);
    expect(skipped).toBe(0);
    expect(filters).toHaveLength(2);
    expect(filters[1]!.id).not.toBe("frontend");
    const many = Array.from({ length: 14 }, (_, i) => filter(`f${i}`, String(i)));
    expect(addImported([frontend], many)).toMatchObject({ added: 11, skipped: 3 });
  });
});
