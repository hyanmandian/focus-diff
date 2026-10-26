import { describe, expect, it } from "vitest";

import { toMatcher } from "../filters/filters";
import { PATH_FILTER_NAMES, PATH_FILTERS, RECIPE_IDS, RECIPES } from "./recipes";

const keeps = (name: keyof typeof PATH_FILTERS, path: string) => toMatcher(PATH_FILTERS[name])?.(path);

describe("path filters", () => {
  it("are all valid patterns", () => {
    for (const name of PATH_FILTER_NAMES)
      expect({ name, ok: toMatcher(PATH_FILTERS[name]) !== null }).toEqual({ name, ok: true });
  });

  it("split code from its tests", () => {
    expect(keeps("frontend", "web/src/app.tsx")).toBe(true);
    expect(keeps("frontend", "web/src/app.test.tsx")).toBe(false);
    expect(keeps("backend", "api/service.py")).toBe(true);
    expect(keeps("backend", "api/tests/service.py")).toBe(false);
    expect(keeps("code", "src/app.ts")).toBe(true);
    expect(keeps("code", "src/__mocks__/app.ts")).toBe(false);
    expect(keeps("tests", "src/app.spec.ts")).toBe(true);
  });

  it("leave out generated files, and pick out infrastructure, databases and docs", () => {
    expect(keeps("generated", "package-lock.json")).toBe(false);
    expect(keeps("generated", "src/app.ts")).toBe(true);
    expect(keeps("payments", "services/payments/charge.ts")).toBe(true);
    expect(keeps("infra", ".github/workflows/ci.yml")).toBe(true);
    expect(keeps("database", "db/migrations/001.sql")).toBe(true);
    expect(keeps("docs", "docs/setup.md")).toBe(true);
  });
});

describe("recipes", () => {
  it("are made of the path filters, each used once", () => {
    const used = RECIPE_IDS.flatMap((id) => RECIPES[id]);
    expect(used.toSorted()).toEqual([...PATH_FILTER_NAMES].toSorted());
  });
});
