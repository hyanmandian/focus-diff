import { afterEach, describe, expect, it, vi } from "vitest";

import { SAMPLE_PULL_REQUEST } from "./demo-sample";

const shown = (filterId: string) => {
  const filter = SAMPLE_PULL_REQUEST.filters.find((each) => each.id === filterId)!;
  return SAMPLE_PULL_REQUEST.files
    .map((file) => file.path)
    .filter(
      (path) =>
        new RegExp(filter.include, "iu").test(path) && !(filter.exclude && new RegExp(filter.exclude, "iu").test(path)),
    );
};

afterEach(() => {
  vi.doUnmock("@/utils/recipes/recipes");
  vi.resetModules();
});

describe("SAMPLE_PULL_REQUEST", () => {
  it("filters the way the welcome page's stack recipe will, named by message key", () => {
    expect(SAMPLE_PULL_REQUEST.filters.map(({ id, name }) => [id, name])).toEqual([
      ["frontend", "recipeStackFrontend"],
      ["backend", "recipeStackBackend"],
    ]);
    expect(shown("frontend")).toEqual([
      "web/src/checkout/cart.tsx",
      "web/src/checkout/use-cart.ts",
      "web/src/checkout/cart.css",
    ]);
    expect(shown("backend")).toEqual([
      "api/orders/service.py",
      "api/orders/models.py",
      "api/orders/migrations/0042_cart.py",
    ]);
  });

  it("leaves tests, docs and the lock file to All, with some files viewed and conversations in every state", () => {
    const filtered = new Set([...shown("frontend"), ...shown("backend")]);
    expect(SAMPLE_PULL_REQUEST.files.filter((file) => !filtered.has(file.path))).toHaveLength(6);
    expect(SAMPLE_PULL_REQUEST.files.filter((file) => file.viewed)).toHaveLength(3);
    expect(SAMPLE_PULL_REQUEST.files.flatMap((file) => file.conversations ?? []).map((each) => each.state)).toEqual([
      "waiting",
      "answered",
      "resolved",
    ]);
  });

  it("filters nothing out with a recipe that's gone", async () => {
    vi.doMock("@/utils/recipes/recipes", () => ({ RECIPES: [] }));
    const { SAMPLE_PULL_REQUEST: sample } = await import("./demo-sample");
    expect(sample.filters).toEqual([
      { id: "frontend", name: "recipeStackFrontend", include: "", exclude: "" },
      { id: "backend", name: "recipeStackBackend", include: "", exclude: "" },
    ]);
  });
});
