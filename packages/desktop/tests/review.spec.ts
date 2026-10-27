// A pull request's review window, on the sample pull request #1807 (src/utils/mock/mock.ts): ten
// changed files, five comments on the code and one of yours pending.

import { expect, test, type Locator, type Page } from "@playwright/test";

const URL = "/review.html?id=PR_1807&repo=acme/web&number=1807&queue=review";

/** A file's diff. The diff is drawn by @pierre/diffs in a shadow root, without roles for its parts. */
const fileDiff = (page: Page, path: string) => page.locator("diffs-container").filter({ hasText: path });

/** Waits for something in the diff to hold still: the diff scrolls smoothly to a file, and draws its
 *  lines again as they come on screen. */
async function settled(page: Page, target: Locator) {
  await expect(async () => {
    const before = await target.boundingBox();
    await page.waitForTimeout(150);
    const after = await target.boundingBox();
    expect(before && after && before.y === after.y).toBe(true);
  }).toPass();
}

/** Selects lines of a file's new version as a person does, dragging over their numbers. The library
 *  gives the numbers no role, so they're found by the line number it puts on them. */
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
  // GitHub's emoji, kept from an earlier day (utils/writer/writer.ts), so ":" has some to offer.
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

  // A second chip adds its files to the first's.
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
  // As the extension's bar has it: a button with the count, its card over it.
  const toggle = page.getByRole("button", { name: "Comments, 5 comments" });
  await toggle.click();
  const card = page.getByRole("dialog", { name: "Comments" });
  // Opening lands on the first.
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
  // Before the first comes the last.
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

  // From the diff too, and Esc closes it.
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
  // Off the tree, where the arrows are its own.
  await page.getByRole("heading", { name: "Checkout: keep the promo code when the cart changes" }).click();

  // In the diff's order, which keeps the files GitHub sent no patch for till the end.
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
