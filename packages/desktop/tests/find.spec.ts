import { expect, test, type Page } from "@playwright/test";

const URL = "/review.html?id=PR_1807&repo=acme/web&number=1807&queue=review";

const highlighted = (page: Page, name: string) =>
  page.evaluate((key) => {
    const found = CSS.highlights.get(key);
    return found ? [...found].map((range) => (range instanceof Range ? range.toString() : "")) : [];
  }, name);

test("finds text across the diff with Cmd-F, steps through it, and lets go on Escape", async ({ page }) => {
  await page.goto(URL);
  await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: /^Diff/u }).click();
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();

  await page.keyboard.press("Meta+F");
  const field = page.getByRole("searchbox", { name: "Find in diff" });
  await expect(field).toBeFocused();
  await field.fill("promo");
  const status = page.getByRole("search", { name: "Find in diff" }).locator("output");
  await expect(status).toHaveText(/^1 of \d+$/u);
  const total = Number((await status.textContent())!.split(" of ")[1]);
  expect(total).toBeGreaterThan(1);
  await expect.poll(() => highlighted(page, "find-current")).toEqual(["promo"]);
  await expect.poll(async () => (await highlighted(page, "find")).length).toBeGreaterThan(1);

  await field.press("Enter");
  await expect(status).toHaveText(`2 of ${total}`);
  await expect.poll(() => highlighted(page, "find-current")).toEqual(["promo"]);
  await field.press("Shift+Enter");
  await expect(status).toHaveText(`1 of ${total}`);
  await field.press("Shift+Enter");
  await expect(status).toHaveText(`${total} of ${total}`);
  await page.keyboard.press("Meta+G");
  await expect(status).toHaveText(`1 of ${total}`);

  await field.fill("no such text anywhere");
  await expect(status).toHaveText("No results");

  await field.press("Escape");
  await expect(page.getByRole("search", { name: "Find in diff" })).toBeHidden();
  await expect.poll(() => highlighted(page, "find")).toEqual([]);

  await page.keyboard.press("Meta+Shift+F");
  await expect(page.getByRole("searchbox", { name: "Filter files" })).toBeFocused();
});
