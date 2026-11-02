import { describe, expect, it } from "vite-plus/test";

import { leftOutAs, scope } from "@/utils/review-scope/review-scope";
import type { ReviewFile } from "@/utils/review/review";

const file = (path: string): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  patch: "@@ -1 +1 @@\n+x",
});

describe("leftOutAs", () => {
  it.each([
    ["src/cart/cart.test.ts", "tests"],
    ["src/cart/cart.spec.tsx", "tests"],
    ["src/__tests__/cart.ts", "tests"],
    ["tests/e2e/checkout.ts", "tests"],
    ["e2e/login.ts", "tests"],
    ["cypress/integration/cart.cy.ts", "tests"],
    ["pkg/cart/cart_test.go", "tests"],
    ["app/test_cart.py", "tests"],
    ["spec/models/cart_spec.rb", "tests"],
    ["src/test/java/acme/CartTest.java", "tests"],
    ["Sources/CartTests.swift", "tests"],
    ["src/__snapshots__/cart.ts.snap", "tests"],
    ["src/cart/Cart.stories.tsx", "stories"],
    [".storybook/preview.ts", "stories"],
    ["src/__mocks__/api.ts", "mocks"],
    ["test-data/orders.json", "mocks"],
    ["fixtures/orders.json", "mocks"],
    ["src/utils/mock/mock.ts", "mocks"],
    ["src/api/orders.mock.ts", "mocks"],
    ["data/promo-fixtures.json", "mocks"],
    ["internal/store_mock.go", "mocks"],
    ["internal/testdata/order.golden", "mocks"],
    ["src/gql/__generated__/types.ts", "generated"],
    ["api/orders.pb.go", "generated"],
    ["api/orders_pb2.py", "generated"],
    ["lib/order.freezed.dart", "generated"],
    ["package-lock.json", "dependencies"],
    ["vendor/github.com/x/y.go", "dependencies"],
    ["public/logo.svg", "assets"],
    ["fonts/Mona.woff2", "assets"],
    ["README.md", "docs"],
    ["docs/setup.ts", "docs"],
    ["docs/skills.md", "docs"],
    ["skills/charts/chart.test.ts", "tests"],
  ])("leaves out %s as %s", (path, reason) => {
    expect(leftOutAs(path)).toBe(reason);
  });

  it.each([
    "src/cart/cart.ts",
    "src/api/orders/route.ts",
    "package.json",
    "tsconfig.json",
    ".github/workflows/ci.yml",
    "db/migrations/2026_add_orders.sql",
    "src/contest/entry.ts",
    "src/latest/news.ts",
    "src/specs/openapi.yaml",
    "Dockerfile",
    "tools/agent/skills/charts/SKILL.md",
    "tools/agent/skills/charts/references/patterns.md",
    "AGENTS.md",
    "apps/web/CLAUDE.md",
    ".cursor/BUGBOT.md",
    ".cursor/rules/react.mdc",
    ".claude/commands/review.md",
    ".github/copilot-instructions.md",
    ".github/prompts/release.prompt.md",
    "server/prompts/summary.md",
  ])("keeps %s, code or what steers an agent", (path) => {
    expect(leftOutAs(path)).toBeNull();
  });
});

describe("scope", () => {
  it("keeps the code and says what it left out, by reason, in a steady order", () => {
    const files = ["README.md", "src/cart.ts", "src/cart.test.ts", "package.json", "src/a.test.ts"].map((path) =>
      file(path),
    );
    const { kept, leftOut } = scope(files);
    expect(kept.map((f) => f.path)).toEqual(["src/cart.ts", "package.json"]);
    expect(leftOut.map(({ reason, files: some }) => [reason, some.map((f) => f.path)])).toEqual([
      ["tests", ["src/cart.test.ts", "src/a.test.ts"]],
      ["docs", ["README.md"]],
    ]);
  });

  it("walks through the docs when they're all there is", () => {
    const { kept, leftOut } = scope(["docs/guide.md", "README.md", "src/a.test.ts"].map((path) => file(path)));
    expect(kept.map((f) => f.path)).toEqual(["docs/guide.md", "README.md"]);
    expect(leftOut.map((l) => l.reason)).toEqual(["tests"]);
  });

  it("has nothing to keep when there's only tests", () => {
    expect(scope([file("a.test.ts")]).kept).toEqual([]);
  });
});
