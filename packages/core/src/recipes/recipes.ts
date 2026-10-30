import type { PathPatterns } from "../filters/filters";

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

const TEST_FILES =
  "(^|/|\\.)(tests?|specs?|__tests__|__mocks__|androidTest|integrationTest)/|[._](test|spec)\\.[^/]+$|(^|/)(test_[^/]*|conftest)\\.py$";
const STORIES = "\\.stories\\.[^/]+$";

export const PATH_FILTERS: Record<PathFilterName, PathPatterns> = {
  frontend: { include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$", exclude: `${TEST_FILES}|${STORIES}` },
  backend: { include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$", exclude: TEST_FILES },
  code: { include: "", exclude: `${TEST_FILES}|${STORIES}` },
  tests: { include: TEST_FILES, exclude: "" },
  generated: {
    include: "",
    exclude:
      "(^|/)(package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|Cargo\\.lock|poetry\\.lock|go\\.sum)$|\\.snap$|\\.min\\.(js|css)$|(^|/)(dist|build|generated|__generated__)/",
  },
  payments: { include: "^(apps|packages|services)/payments/", exclude: "" },
  infra: {
    include:
      "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|(^|/)Dockerfile|(^|/)docker-compose|\\.(tf|ya?ml)$",
    exclude: "",
  },
  database: { include: "(^|/)migrations?/|\\.sql$|(^|/)schema\\.(prisma|rb)$", exclude: "" },
  docs: { include: "\\.(mdx?|rst|adoc)$|(^|/)docs?/", exclude: "" },
};

const EARLIER: Array<[before: PathPatterns, now: PathFilterName]> = [
  [{ include: "\\.(tsx?|jsx?|vue|svelte|css|scss)$", exclude: "\\.(test|spec|stories)\\." }, "frontend"],
  [{ include: "\\.(py|go|rb|java|kt|cs|php|rs|ex)$", exclude: "(^|/)(tests?|spec)/|_test\\.|Test\\." }, "backend"],
  [{ include: "", exclude: "\\.(test|spec|stories)\\.|(^|/)(tests?|__tests__|__mocks__)/" }, "code"],
  [{ include: "\\.(test|spec)\\.|(^|/)(tests?|__tests__)/", exclude: "" }, "tests"],
  [
    {
      include:
        "(^|/)(\\.github|\\.gitlab|\\.circleci|infra|terraform|k8s|helm|docker)/|Dockerfile|docker-compose|\\.(tf|ya?ml)$",
      exclude: "",
    },
    "infra",
  ],
  [{ include: "(^|/)migrations?/|\\.sql$|schema\\.(prisma|rb)$", exclude: "" }, "database"],
  [{ include: "\\.(mdx?|rst|txt)$|(^|/)docs/", exclude: "" }, "docs"],
];

export function upgradePatterns<T extends PathPatterns>(filter: T): T {
  const earlier = EARLIER.find(([before]) => before.include === filter.include && before.exclude === filter.exclude);
  return earlier ? { ...filter, ...PATH_FILTERS[earlier[1]] } : filter;
}

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
