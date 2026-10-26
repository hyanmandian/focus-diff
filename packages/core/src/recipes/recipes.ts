import type { PathPatterns } from "../filters/filters";

/** The path filters both apps offer to start from. Each app names them in its own words, keyed by these names. */
export const PATH_FILTER_NAMES = [
  "frontend",
  "backend",
  "code",
  "tests",
  "generated",
  "payments",
  "infra",
  "database",
  "docs",
] as const;
export type PathFilterName = (typeof PATH_FILTER_NAMES)[number];

export const PATH_FILTERS: Record<PathFilterName, PathPatterns> = {
  frontend: { include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$", exclude: "\\.(test|spec|stories)\\." },
  backend: { include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$", exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\." },
  code: { include: "", exclude: "\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/" },
  tests: { include: "\\.(test|spec)\\.|(^|/)(tests?|__tests__)/", exclude: "" },
  generated: {
    include: "",
    exclude:
      "(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|poetry\\.lock|go\\.sum)$|\\.snap$|\\.min\\.(js|css)$|(^|/)(dist|build|generated|__generated__)/",
  },
  payments: { include: "^(apps|packages|services)/payments/", exclude: "" },
  infra: {
    include:
      "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$",
    exclude: "",
  },
  database: { include: "(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$", exclude: "" },
  docs: { include: "\\.(mdx?|rst|txt)$|(^|/)docs/", exclude: "" },
};

/** Recipes: sets of filters for a common way to split a review. */
export const RECIPE_IDS = ["stack", "area", "tests", "generated", "infra", "database", "docs"] as const;
export type RecipeId = (typeof RECIPE_IDS)[number];

export const RECIPES: Record<RecipeId, readonly PathFilterName[]> = {
  stack: ["frontend", "backend"],
  area: ["payments"],
  tests: ["code", "tests"],
  generated: ["generated"],
  infra: ["infra"],
  database: ["database"],
  docs: ["docs"],
};
