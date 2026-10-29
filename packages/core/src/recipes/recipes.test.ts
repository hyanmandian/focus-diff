import { describe, expect, it } from "vitest";

import { toMatcher } from "../filters/filters";
import { PATH_FILTER_NAMES, PATH_FILTERS, RECIPE_IDS, RECIPES, upgradePatterns } from "./recipes";

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

  it.each([
    ["api/service.py", "backend"],
    ["src/latest.py", "backend"],
    ["app/models/contest.rb", "backend"],
    ["services/greatest.go", "backend"],
    ["src/main/java/acme/Cart.java", "backend"],
    ["src/Testing/Harness.cs", "backend"],
    ["web/src/latest.tsx", "frontend"],
    ["pkg/cart_test.go", "tests"],
    ["spec/models/user_spec.rb", "tests"],
    ["app/models/user_spec.rb", "tests"],
    ["api/test_cart.py", "tests"],
    ["api/conftest.py", "tests"],
    ["src/test/java/acme/CartTest.java", "tests"],
    ["Acme.Tests/CartTests.cs", "tests"],
    ["app/src/androidTest/java/CartTest.kt", "tests"],
    ["web/src/app.test.tsx", "tests"],
    ["web/__mocks__/api.ts", "tests"],
  ] as const)("puts %s with the %s", (path, where) => {
    expect({
      path,
      backend: keeps("backend", path),
      frontend: keeps("frontend", path),
      tests: keeps("tests", path),
    }).toEqual({
      path,
      backend: where === "backend",
      frontend: where === "frontend",
      tests: where === "tests",
    });
    expect(keeps("code", path)).toBe(where !== "tests");
  });

  it("keep stories out of the code, and text files out of the docs", () => {
    expect(keeps("code", "web/src/button.stories.tsx")).toBe(false);
    expect(keeps("docs", "requirements.txt")).toBe(false);
    expect(keeps("docs", "doc/guide.adoc")).toBe(true);
  });

  it("bring filters saved with earlier patterns up to date, and leave the rest alone", () => {
    const old = {
      id: "b",
      name: "Backend",
      include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$",
      exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\.",
    };
    expect(upgradePatterns(old)).toEqual({ ...old, ...PATH_FILTERS.backend });
    const mine = { name: "Mine", include: "^src/", exclude: "" };
    expect(upgradePatterns(mine)).toBe(mine);
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
