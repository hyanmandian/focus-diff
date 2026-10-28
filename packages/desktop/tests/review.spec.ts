import { expect, test, type Locator, type Page } from "@playwright/test";

import { callsOf, recordCalls } from "./ipc";

const URL = "/review.html?id=PR_1807&repo=acme/web&number=1807&queue=review";

const fileDiff = (page: Page, path: string) => page.locator("diffs-container").filter({ hasText: path });

async function settled(page: Page, target: Locator) {
  await expect(async () => {
    const before = await target.boundingBox();
    await page.waitForTimeout(150);
    const after = await target.boundingBox();
    expect(before && after && before.y === after.y).toBe(true);
  }).toPass();
}

async function selectLines(page: Page, file: Locator, from: number, to: number) {
  const number = (line: number) => file.locator(`[data-line-type="change-addition"][data-column-number="${line}"]`);
  await expect(async () => {
    await settled(page, number(from));
    const [start, end] = await Promise.all([number(from).boundingBox(), number(to).boundingBox()]);
    if (!start || !end) throw new Error("The line numbers aren't on screen");
    await page.mouse.move(start.x + 4, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(end.x + 4, end.y + end.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect(page.getByRole("tablist", { name: `On lines ${from}–${to}` })).toBeVisible({ timeout: 1000 });
  }).toPass();
}

const openDiff = async (page: Page) => {
  await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: /^Diff/u }).click();
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "emoji",
      JSON.stringify({
        at: Date.now(),
        value: [
          { name: "tada", char: "🎉" },
          { name: "taco", char: "🌮" },
          { name: "rocket", char: "🚀" },
        ],
      }),
    );
  });
  await page.goto(URL);
  await expect(
    page.getByRole("heading", { name: "Checkout: keep the promo code when the cart changes", level: 1 }).first(),
  ).toBeVisible();
});

test("opens on the overview, and switches to the diff and back", async ({ page }) => {
  const view = page.getByRole("tablist", { name: "View" });
  await expect(view.getByRole("tab", { name: /^Overview/u })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Description" })).toContainText("Changing the cart used to drop");
  await expect(page.getByRole("region", { name: "Checks" })).toBeVisible();

  await openDiff(page);
  await expect(view.getByRole("tab", { name: /^Diff/u })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Description" })).toBeHidden();

  await view.getByRole("tab", { name: /^Overview/u }).click();
  await expect(page.getByRole("region", { name: "Description" })).toBeVisible();
});

test("lists the changed files in a tree, and filters them by name", async ({ page }) => {
  await openDiff(page);
  const tree = page.getByRole("tree", { name: "Files" });
  await expect(tree.getByRole("treeitem", { name: /^cart\.ts/u })).toBeVisible();
  await expect(page.getByText("1/10 viewed")).toBeVisible();

  await page.getByRole("searchbox", { name: "Filter files" }).fill("promo.go");
  await expect(tree.getByRole("treeitem")).toHaveCount(1);
  await expect(tree.getByRole("treeitem", { name: /^api\/promo\.go/u })).toBeVisible();

  await page.getByRole("searchbox", { name: "Filter files" }).fill("");
  await expect(tree.getByRole("treeitem", { name: /^cart\.ts/u })).toBeVisible();
});

test("picks a file from the tree", async ({ page }) => {
  await openDiff(page);
  const item = page.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^totals\.ts/u });
  await item.click();
  await expect(item).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("checkbox", { name: "Viewed src/checkout/totals.ts" })).toBeInViewport();
});

test("marks a file viewed", async ({ page }) => {
  await openDiff(page);
  const viewed = page.getByRole("checkbox", { name: "Viewed src/checkout/cart.ts" });
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^cart\.ts/u })
    .click();
  await viewed.click();
  await expect(viewed).toBeChecked();
  await expect(page.getByText("2/10 viewed")).toBeVisible();
});

test("narrows the files to one part with the filter chips", async ({ page }) => {
  await openDiff(page);
  const parts = page.getByRole("group", { name: "Review one part" });
  const tree = page.getByRole("tree", { name: "Files" });
  await expect(parts.getByRole("button", { name: "All 10" })).toHaveAttribute("aria-pressed", "true");

  await parts.getByRole("button", { name: "Backend 1" }).click();
  await expect(parts.getByRole("button", { name: "Backend 1" })).toHaveAttribute("aria-pressed", "true");
  await expect(tree.getByRole("treeitem", { name: /^promo\.go/u })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /^cart\.ts/u })).toBeHidden();

  await parts.getByRole("button", { name: "Tests 1" }).click();
  await expect(parts.getByRole("button", { name: "Backend 1" })).toHaveAttribute("aria-pressed", "true");
  await expect(tree.getByRole("treeitem", { name: /^promo\.test\.ts/u })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /^promo\.go/u })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /^cart\.ts/u })).toBeHidden();

  await parts.getByRole("button", { name: "All 10" }).click();
  await expect(tree.getByRole("treeitem", { name: /^promo\.go/u })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: /^cart\.ts/u })).toBeVisible();
});

test("steps through the comments from the floating bar, with its arrows and with n and p", async ({ page }) => {
  await openDiff(page);
  const toggle = page.getByRole("button", { name: "Comments, 5 comments" });
  await toggle.click();
  const card = page.getByRole("dialog", { name: "Comments" });
  await expect(card).toContainText("1/5");
  await card.getByRole("button", { name: "Next comment" }).click();
  await expect(card).toContainText("2/5");
  await card.getByRole("button", { name: "Previous comment" }).click();
  await expect(card).toContainText("1/5");

  await page.keyboard.press("n");
  await expect(card).toContainText("2/5");
  await page.keyboard.press("n");
  await expect(card).toContainText("3/5");
  await page.keyboard.press("p");
  await expect(card).toContainText("2/5");
  await page.keyboard.press("p");
  await page.keyboard.press("p");
  await expect(card).toContainText("5/5");
});

test("shows the keyboard shortcuts with ?", async ({ page }) => {
  await page.keyboard.press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("region", { name: "Comments" })).toContainText("Next comment");

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  await openDiff(page);
  await page.keyboard.press("?");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("moves between files with j and k", async ({ page }) => {
  await openDiff(page);
  const tree = page.getByRole("tree", { name: "Files" });
  await tree.getByRole("treeitem", { name: /^promo\.go/u }).click();
  await settled(page, page.getByRole("checkbox", { name: "Viewed api/promo.go" }));
  await page.getByRole("heading", { name: "Checkout: keep the promo code when the cart changes" }).click();

  await page.keyboard.press("j");
  await expect(tree.getByRole("treeitem", { name: /^promo-codes\.md/u })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("k");
  await expect(tree.getByRole("treeitem", { name: /^promo\.go/u })).toHaveAttribute("aria-selected", "true");
});

test("selecting lines opens the comment box, to comment or to ask", async ({ page }) => {
  await openDiff(page);
  await page
    .getByRole("tree", { name: "Files" })
    .getByRole("treeitem", { name: /^cart\.ts/u })
    .click();
  await selectLines(page, fileDiff(page, "src/checkout/cart.ts"), 12, 14);

  const kinds = page.getByRole("tablist", { name: "On lines 12–14" });
  await expect(kinds.getByRole("tab", { name: "Comment" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Your comment for the author" })).toBeFocused();

  await kinds.getByRole("tab", { name: "Ask Claude Code" }).click();
  await expect(kinds.getByRole("tab", { name: "Ask Claude Code" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox", { name: "Your comment for the author" })).toBeHidden();

  await kinds.getByRole("tab", { name: "Comment" }).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(kinds).toBeHidden();
});

test("writes a comment with an @mention and an emoji, and keeps it for the review", async ({ page }) => {
  await openDiff(page);
  await page.getByRole("button", { name: "Comment on src/checkout/cart.ts" }).click();
  const box = page.getByRole("combobox", { name: "Your comment for the author" });
  await expect(box).toBeFocused();

  await box.pressSequentially("Thanks @octo");
  const people = page.getByRole("listbox", { name: "People to mention" });
  await expect(people.getByRole("option", { name: /octocat/u })).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue(/Thanks @octocat $/u);

  await box.pressSequentially("this works :tad");
  await expect(page.getByRole("option", { name: /tada/u })).toBeVisible();
  await box.press("Enter");
  await expect(box).toHaveValue("Thanks @octocat this works :tada: ");

  await page.getByRole("tab", { name: "Preview" }).click();
  await expect(page.getByRole("tabpanel", { name: "Preview" }).getByRole("link", { name: "@octocat" })).toBeVisible();

  const submit = page.getByRole("button", { name: /^Submit Review/u });
  await expect(submit).toHaveText(/1/u);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(submit).toHaveText(/2/u);
  await expect(fileDiff(page, "src/checkout/cart.ts")).toContainText("this works");
});

test("submits the review from its popover", async ({ page }) => {
  await page.getByRole("button", { name: /^Submit Review/u }).click();
  const finish = page.getByRole("dialog", { name: "Finish Your Review" });
  await expect(finish).toBeVisible();
  await expect(finish).toContainText("Sends 1 pending comment");

  await finish.getByRole("textbox", { name: "Review comment" }).fill("Looks good to me.");
  const kind = finish.getByRole("group", { name: "Kind of review" });
  await kind.getByRole("button", { name: "Approve" }).click();
  await expect(kind.getByRole("button", { name: "Approve" })).toHaveAttribute("aria-pressed", "true");
  await finish.getByRole("button", { name: "Approve", exact: true }).last().click();

  await expect(finish).toBeHidden();
});

test("goes through a stack in order, from Next and from the stack's menu", async ({ page }) => {
  await recordCalls(page);
  const stack = page.getByRole("button", { name: "1 of 2 in the stack" });
  await expect(stack).toBeVisible();
  await stack.click();
  await expect(page.getByRole("menuitemradio", { name: /#1807/u })).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("menuitemradio", { name: /#1812 Show why a promo code stopped applying/u }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Next in the stack: #1812 Show why a promo code stopped applying" }).click();
  await expect.poll(async () => (await callsOf(page, "switch_review")).map((c) => c.args.number)).toEqual([1812]);
});
