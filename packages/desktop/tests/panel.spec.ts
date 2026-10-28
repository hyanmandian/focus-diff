import { expect, test, type Page } from "@playwright/test";

import { callsOf, recordCalls } from "./ipc";

const PROMO = "Checkout: keep the promo code when the cart changes";
const FLAKY = "Fix flaky date picker test in Safari";
const INVOICES = "Move invoice exports to the background queue so large accounts don't time out";
const REASONS = "Show why a promo code stopped applying";

const row = (page: Page, title: string) =>
  page.getByRole("button", {
    name: new RegExp(`^(Unread: )?${title.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")} #`, "u"),
  });

async function pick(page: Page, title: string, modifiers: Array<"Shift"> = []) {
  await row(page, title).hover();
  await page.getByRole("checkbox", { name: `Select ${title}` }).click({ force: true, modifiers });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.getByRole("tablist", { name: "Queues" })).toBeVisible();
  await recordCalls(page);
});

test("shows each queue's pull requests in its tab", async ({ page }) => {
  const queues = page.getByRole("tablist", { name: "Queues" });
  await expect(queues.getByRole("tab", { name: "Review 4" })).toHaveAttribute("aria-selected", "true");
  await expect(row(page, PROMO)).toBeVisible();

  await queues.getByRole("tab", { name: "Updates 3" }).click();
  await expect(queues.getByRole("tab", { name: "Updates 3" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Updates" })).toBeVisible();
  await expect(row(page, "Upgrade to React 19")).toBeVisible();
  await expect(row(page, PROMO)).toBeHidden();

  await queues.getByRole("tab", { name: "Merged 1" }).click();
  await expect(row(page, "Header: show the workspace switcher on small screens")).toBeVisible();
});

test("remembers the queue last chosen", async ({ page }) => {
  await page.getByRole("tab", { name: "My PRs 2" }).click();
  await page.reload();
  await recordCalls(page);
  await expect(page.getByRole("tab", { name: "My PRs 2" })).toHaveAttribute("aria-selected", "true");
});

test("narrows the list to one repository with its chip", async ({ page }) => {
  const repos = page.getByRole("group", { name: "Repositories" });
  await expect(repos.getByRole("button", { name: "All 4" })).toHaveAttribute("aria-pressed", "true");

  await repos.getByRole("button", { name: "api 1" }).click();
  await expect(repos.getByRole("button", { name: "api 1" })).toHaveAttribute("aria-pressed", "true");
  await expect(row(page, INVOICES)).toBeVisible();
  await expect(row(page, PROMO)).toBeHidden();

  await repos.getByRole("button", { name: "web 3" }).click();
  await expect(row(page, PROMO)).toBeVisible();
  await expect(row(page, FLAKY)).toBeVisible();
  await expect(row(page, REASONS)).toBeVisible();
  await expect(row(page, INVOICES)).toBeHidden();

  await repos.getByRole("button", { name: "All 4" }).click();
  await expect(row(page, INVOICES)).toBeVisible();
  await expect(row(page, PROMO)).toBeVisible();
});

test("picks rows with their box, and a run of them with Shift", async ({ page }) => {
  await pick(page, FLAKY);
  await expect(page.getByRole("checkbox", { name: `Select ${FLAKY}` })).toBeChecked();
  await expect(page.getByRole("status")).toHaveText("1 selected");

  await pick(page, INVOICES, ["Shift"]);
  await expect(page.getByRole("status")).toHaveText("4 selected");
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);

  await pick(page, PROMO);
  await expect(page.getByRole("checkbox", { name: `Select ${PROMO}` })).not.toBeChecked();
  await expect(page.getByRole("status")).toHaveText("3 selected");

  await page.getByRole("button", { name: "Clear" }).click();
  await expect(page.getByRole("checkbox", { name: `Select ${FLAKY}` })).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Mark Done" })).toBeHidden();
});

test("picks the focused row with x, and Esc lets go", async ({ page }) => {
  await row(page, PROMO).focus();
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: `Select ${PROMO}` })).toBeChecked();
  await expect(page.getByRole("status")).toHaveText("1 selected");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("checkbox", { name: `Select ${PROMO}` })).not.toBeChecked();
});

test("marks picked rows done, and Undo puts them back", async ({ page }) => {
  await pick(page, FLAKY);
  await pick(page, INVOICES);
  await page.getByRole("button", { name: "Mark Done" }).click();

  await expect(page.getByRole("status")).toHaveText("2 marked done");
  await expect(row(page, FLAKY)).toBeHidden();
  await expect(row(page, INVOICES)).toBeHidden();
  await expect(row(page, PROMO)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Review 2" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(row(page, FLAKY)).toBeVisible();
  await expect(row(page, INVOICES)).toBeVisible();
  await expect(page.getByRole("tab", { name: "Review 4" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo" })).toBeHidden();
});

test("keeps a stack together, bottom first, in a group of its own", async ({ page }) => {
  const stack = page.getByRole("list", { name: "Stack of 2" });
  await expect(stack.getByRole("button", { name: /^(Unread: )?(Checkout|Show why)/u })).toHaveText([
    new RegExp(PROMO, "u"),
    new RegExp(REASONS, "u"),
  ]);
  await expect(stack.getByText("2 of 2 in a stack, from the bottom")).toBeAttached();
});

test("asks for the review window when a row is clicked", async ({ page }) => {
  await row(page, PROMO).click();

  await expect.poll(() => callsOf(page, "open_review")).toHaveLength(1);
  const [call] = await callsOf(page, "open_review");
  expect(call?.args).toMatchObject({ id: "PR_1807", repo: "acme/web", number: 1807, queue: "review" });
  await expect(row(page, PROMO)).toHaveAccessibleName(/^Checkout/u);
});

test("walks the rows with the arrow keys and opens one with Return", async ({ page }) => {
  await page.keyboard.press("ArrowDown");
  await expect(row(page, FLAKY)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(page, PROMO)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await callsOf(page, "open_review")).map((c) => c.args.id)).toEqual(["PR_1807"]);
});

test("opens Settings from the menu", async ({ page }) => {
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("menuitem", { name: /Settings/u }).click();
  await expect.poll(() => callsOf(page, "open_settings")).toHaveLength(1);
});
