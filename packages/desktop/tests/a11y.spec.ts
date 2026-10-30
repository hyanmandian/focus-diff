import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PAGES: Array<{ name: string; url: string; ready: (page: Page) => Promise<void> }> = [
  {
    name: "panel",
    url: "/index.html",
    ready: (page) => expect(page.getByRole("tablist", { name: "Queues" })).toBeVisible(),
  },
  {
    name: "review overview",
    url: "/review.html?id=PR_1807&repo=acme/web&number=1807&queue=review",
    ready: (page) => expect(page.getByRole("region", { name: "Description" })).toBeVisible(),
  },
  {
    name: "settings",
    url: "/settings.html",
    ready: (page) => expect(page.getByRole("tablist", { name: "Settings" })).toBeVisible(),
  },
  {
    name: "setup",
    url: "/setup.html",
    ready: (page) =>
      expect(page.getByRole("heading", { name: "Your reviews, without opening GitHub", level: 1 })).toBeVisible(),
  },
];

const violations = async (page: Page) => {
  const { violations: found } = await new AxeBuilder({ page })
    .exclude("[data-slot=file-icon]")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  return found.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
};

for (const scheme of ["light", "dark"] as const) {
  for (const { name, url, ready } of PAGES) {
    test(`the ${name} has no accessibility violations in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      await ready(page);
      await page.addStyleTag({ content: "html.panel, html.panel.dark { --panel-tint: var(--background); }" });
      expect(await violations(page)).toEqual([]);
    });
  }
}

test("the review's diff has no accessibility violations", async ({ page }) => {
  await page.goto(PAGES[1]?.url ?? "");
  await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: /^Diff/u }).click();
  await expect(page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: /^Diff/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(await violations(page)).toEqual([]);
});
