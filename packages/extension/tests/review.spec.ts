// A pull request's review in a tab: the Mac app's review window, on its sample pull request #1807 (packages/app's
// utils/mock), which the stand-in GitHub answers (tests/github.ts): ten changed files, one viewed.
import type { Page } from "@playwright/test";

import { expect, expectSoundPage, PAGE_VIEWS, test } from "./fixtures";
import { fakeGitHub } from "./github";

const TITLE = "Checkout: keep the promo code when the cart changes";

/** The review, signed in. */
const openReview = async (
  open: (file: string) => Promise<Page>,
  signIn: (page: Page) => Promise<void>,
): Promise<Page> => {
  const page = await open("review.html?id=PR_1807&repo=acme%2Fweb&number=1807&queue=review&title=%231807");
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: TITLE, level: 1 }).first()).toBeVisible();
  return page;
};

const openDiff = async (page: Page) => {
  await page.getByRole("tablist", { name: "View" }).getByRole("tab", { name: /^Diff/u }).click();
  await expect(page.getByRole("tree", { name: "Files" })).toBeVisible();
};

test.describe("a review in a tab", () => {
  test("opens on the overview, and switches to the diff", async ({ context, openExtensionPage, signIn }) => {
    await fakeGitHub(context);
    const review = await openReview(openExtensionPage, signIn);
    await expect(review).toHaveTitle("#1807");
    const view = review.getByRole("tablist", { name: "View" });
    await expect(view.getByRole("tab", { name: /^Overview/u })).toHaveAttribute("aria-selected", "true");
    await expect(review.getByRole("region", { name: "Description" })).toContainText("Changing the cart used to drop");
    await expect(review.getByRole("region", { name: "Checks" })).toBeVisible();
    await openDiff(review);
    await expect(
      review.getByRole("tree", { name: "Files" }).getByRole("treeitem", { name: /^cart\.ts/u }),
    ).toBeVisible();
    await expect(review.getByText("1/10 viewed")).toBeVisible();
  });

  test("marks a file viewed on GitHub", async ({ context, openExtensionPage, signIn }) => {
    const sent = await fakeGitHub(context);
    const review = await openReview(openExtensionPage, signIn);
    await openDiff(review);
    await review
      .getByRole("tree", { name: "Files" })
      .getByRole("treeitem", { name: /^cart\.ts/u })
      .click();
    const viewed = review.getByRole("checkbox", { name: "Viewed src/checkout/cart.ts" });
    await viewed.click();
    await expect(viewed).toBeChecked();
    await expect(review.getByText("2/10 viewed")).toBeVisible();
    // Sent by the background, which keeps it until GitHub takes it.
    await expect
      .poll(() => sent.filter((request) => request.body.includes("markFileAsViewed")).map((request) => request.body))
      .toEqual([expect.stringContaining('"path":"src/checkout/cart.ts"')]);
  });

  test("narrows the files to one part with the setup's filters", async ({ context, openExtensionPage, signIn }) => {
    await fakeGitHub(context);
    const review = await openReview(openExtensionPage, signIn);
    await openDiff(review);
    const parts = review.getByRole("group", { name: "Review one part" });
    const tree = review.getByRole("tree", { name: "Files" });
    await expect(parts.getByRole("button", { name: "All 10" })).toHaveAttribute("aria-pressed", "true");
    await parts.getByRole("button", { name: "Backend 1" }).click();
    await expect(tree.getByRole("treeitem", { name: /^promo\.go/u })).toBeVisible();
    await expect(tree.getByRole("treeitem", { name: /^cart\.ts/u })).toBeHidden();
  });

  for (const view of PAGE_VIEWS) {
    test(`passes an accessibility check (${view.join(", ")})`, async ({
      context,
      openExtensionPage,
      signIn,
      pageErrors,
    }) => {
      await fakeGitHub(context);
      const review = await openReview(openExtensionPage, signIn);
      // The review draws its buttons and states in the Mac's accent and status colours (the design system's), which
      // fall short of 4.5:1 in places, as macOS's own do; the rest is checked.
      await expectSoundPage(review, view, review.getByRole("region", { name: "Description" }), ["color-contrast"]);
      expect(pageErrors).toEqual([]);
    });
  }
});
