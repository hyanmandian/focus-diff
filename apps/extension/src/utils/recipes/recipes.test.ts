import { PATH_FILTERS } from "@focus-diff/core/recipes";
import { describe, expect, it } from "vitest";

import { RECIPES } from "./recipes";

describe("RECIPES", () => {
  it("offers the recipes in the welcome page's order, each with its words", () => {
    expect(RECIPES.map((recipe) => recipe.id)).toEqual([
      "stack",
      "area",
      "tests",
      "generated",
      "infra",
      "database",
      "docs",
    ]);
    for (const { id, title, description } of RECIPES) {
      const key = `recipe${id[0]?.toUpperCase()}${id.slice(1)}`;
      expect({ title, description }).toEqual({ title: `${key}Title`, description: `${key}Description` });
    }
  });

  it("names each filter in words and keeps the shared patterns", () => {
    const [stack] = RECIPES;
    expect(stack?.filters).toEqual([
      { name: "recipeStackFrontend", ...PATH_FILTERS.frontend },
      { name: "recipeStackBackend", ...PATH_FILTERS.backend },
    ]);
    expect(RECIPES.flatMap((recipe) => recipe.filters.map((filter) => filter.name))).toEqual([
      "recipeStackFrontend",
      "recipeStackBackend",
      "recipeAreaName",
      "recipeTestsCode",
      "recipeTestsOnly",
      "recipeGeneratedName",
      "recipeInfraName",
      "recipeDatabaseName",
      "recipeDocsName",
    ]);
  });
});
