import type { PathPatterns } from "@focus-diff/core/filters";
import { PATH_FILTERS, RECIPES as RECIPE_FILTERS, type PathFilterName, type RecipeId } from "@focus-diff/core/recipes";

interface RecipeFilter extends PathPatterns {
  name: string;
}

export interface Recipe {
  id: RecipeId;
  title: string;
  description: string;
  filters: RecipeFilter[];
}

/** The recipes' words (message keys), in the order the welcome page offers them. */
const WORDS: [RecipeId, title: string, description: string][] = [
  ["stack", "recipeStackTitle", "recipeStackDescription"],
  ["area", "recipeAreaTitle", "recipeAreaDescription"],
  ["tests", "recipeTestsTitle", "recipeTestsDescription"],
  ["generated", "recipeGeneratedTitle", "recipeGeneratedDescription"],
  ["infra", "recipeInfraTitle", "recipeInfraDescription"],
  ["database", "recipeDatabaseTitle", "recipeDatabaseDescription"],
  ["docs", "recipeDocsTitle", "recipeDocsDescription"],
];

/** Each filter's name (a message key). */
const NAMES: Record<PathFilterName, string> = {
  frontend: "recipeStackFrontend",
  backend: "recipeStackBackend",
  payments: "recipeAreaName",
  code: "recipeTestsCode",
  tests: "recipeTestsOnly",
  generated: "recipeGeneratedName",
  infra: "recipeInfraName",
  database: "recipeDatabaseName",
  docs: "recipeDocsName",
};

export const RECIPES: Recipe[] = WORDS.map(([id, title, description]) => ({
  id,
  title,
  description,
  filters: RECIPE_FILTERS[id].map((name) => ({ name: NAMES[name], ...PATH_FILTERS[name] })),
}));
