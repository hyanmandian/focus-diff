import type { ThreadState } from "@/utils/provider/provider";
import { RECIPES } from "@/utils/recipes/recipes";

export interface DemoFile {
  path: string;
  additions: number;
  deletions: number;
  viewed?: boolean;
  conversations?: { line: number; state: ThreadState }[];
}

interface DemoFilter {
  id: string;
  name: string;
  include: string;
  exclude: string;
}

export interface DemoPullRequest {
  files: DemoFile[];
  filters: DemoFilter[];
}

const recipeFilter = (recipe: string, name: string, id: string): DemoFilter => {
  const filter = RECIPES.find((each) => each.id === recipe)?.filters.find((each) => each.name === name);
  return { id, name, include: filter?.include ?? "", exclude: filter?.exclude ?? "" };
};

export const SAMPLE_PULL_REQUEST: DemoPullRequest = {
  filters: [
    recipeFilter("stack", "recipeStackFrontend", "frontend"),
    recipeFilter("stack", "recipeStackBackend", "backend"),
  ],
  files: [
    {
      path: "web/src/checkout/cart.tsx",
      additions: 84,
      deletions: 12,
      conversations: [{ line: 31, state: "waiting" }],
    },
    { path: "web/src/checkout/use-cart.ts", additions: 46, deletions: 9, viewed: true },
    { path: "web/src/checkout/cart.css", additions: 20, deletions: 4 },
    { path: "web/src/checkout/cart.test.tsx", additions: 61, deletions: 0 },
    { path: "web/src/checkout/cart.stories.tsx", additions: 28, deletions: 0 },
    { path: "api/orders/service.py", additions: 73, deletions: 21, conversations: [{ line: 58, state: "answered" }] },
    { path: "api/orders/models.py", additions: 18, deletions: 2, viewed: true },
    { path: "api/orders/migrations/0042_cart.py", additions: 27, deletions: 0 },
    {
      path: "api/orders/tests/test_service.py",
      additions: 95,
      deletions: 7,
      conversations: [{ line: 12, state: "resolved" }],
    },
    { path: "docs/checkout.md", additions: 32, deletions: 5 },
    { path: "docs/api/orders.md", additions: 14, deletions: 3, viewed: true },
    { path: "package-lock.json", additions: 412, deletions: 380 },
  ],
};
