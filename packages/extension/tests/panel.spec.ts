// The popup: the Mac app's panel under the toolbar button, on GitHub's API answered from sample data (tests/github.ts).
import type { Page } from "@playwright/test";

import { expect, expectSoundPage, test } from "./fixtures";
import { fakeGitHub, PULLS } from "./github";

const PROMO = PULLS[0]!.title;
const SEARCH = PULLS[1]!.title;

/** A pull request's row: the button that opens it. */
const row = (page: Page, title: string) =>
  page.getByRole("button", {
    name: new RegExp(`^(Unread: )?${title.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&")} #`, "u"),
  });

/** Picks a row with its box, as a person does. */
const pick = async (page: Page, title: string) => {
  await row(page, title).hover();
  await page.getByRole("checkbox", { name: `Select ${title}` }).click({ force: true });
};

test.describe("the popup", () => {
  test("asks to connect GitHub, then shows each queue's pull requests", async ({ context, openExtensionPage }) => {
    const sent = await fakeGitHub(context);
    const popup = await openExtensionPage("popup.html");
    await expect(popup.getByRole("heading", { name: "Your reviews, without opening GitHub" })).toBeVisible();
    await expect(popup.getByText(/kept in this browser and only ever sent to GitHub/u)).toBeVisible();
    await popup.getByLabel("Personal access token").fill("ghp_sample");
    await popup.getByRole("button", { name: "Use this token" }).click();

    const queues = popup.getByRole("tablist", { name: "Queues" });
    await expect(queues.getByRole("tab", { name: "Review 2" })).toHaveAttribute("aria-selected", "true");
    await expect(row(popup, PROMO)).toBeVisible();
    await expect(row(popup, SEARCH)).toBeVisible();
    await queues.getByRole("tab", { name: "My PRs 1" }).click();
    await expect(row(popup, PULLS[2]!.title)).toBeVisible();
    // The token went to GitHub's API, and only there.
    expect(sent.some((request) => request.path === "/user")).toBe(true);
  });

  test("marks pull requests done, and Undo puts them back", async ({ context, openExtensionPage, signIn }) => {
    await fakeGitHub(context);
    const popup = await openExtensionPage("popup.html");
    await signIn(popup);
    await expect(row(popup, PROMO)).toBeVisible();
    await pick(popup, PROMO);
    await popup.getByRole("button", { name: "Mark Done" }).click();
    await expect(popup.getByRole("status")).toHaveText("1 marked done");
    await expect(row(popup, PROMO)).toBeHidden();
    await expect(popup.getByRole("tab", { name: "Review 1" })).toBeVisible();
    // It stays done when the popup opens again.
    await popup.reload();
    await expect(row(popup, SEARCH)).toBeVisible();
    await expect(row(popup, PROMO)).toBeHidden();
  });

  test("Undo brings a pull request marked done back", async ({ context, openExtensionPage, signIn }) => {
    await fakeGitHub(context);
    const popup = await openExtensionPage("popup.html");
    await signIn(popup);
    await pick(popup, SEARCH);
    await popup.getByRole("button", { name: "Mark Done" }).click();
    await expect(row(popup, SEARCH)).toBeHidden();
    await popup.getByRole("button", { name: "Undo" }).click();
    await expect(row(popup, SEARCH)).toBeVisible();
    await expect(popup.getByRole("tab", { name: "Review 2" })).toBeVisible();
  });

  test("opens a pull request in a review tab, and the same tab again when asked twice", async ({
    context,
    extensionId,
    openExtensionPage,
    signIn,
  }) => {
    await fakeGitHub(context);
    const popup = await openExtensionPage("popup.html");
    await signIn(popup);
    const opened = context.waitForEvent("page");
    await row(popup, PROMO).click();
    const review = await opened;
    await expect(review).toHaveURL(
      new RegExp(`^chrome-extension://${extensionId}/review\\.html\\?id=PR_1807&repo=acme%2Fweb&number=1807`, "u"),
    );
    await expect(review.getByRole("heading", { name: PROMO, level: 1 }).first()).toBeVisible();
    const pages = context.pages().length;
    await row(popup, PROMO).click();
    await expect.poll(() => context.pages().length).toBe(pages);
  });

  test("has Settings in its menu and no Quit", async ({ context, openExtensionPage, signIn }) => {
    await fakeGitHub(context);
    const popup = await openExtensionPage("popup.html");
    await signIn(popup);
    await popup.getByRole("button", { name: "Menu" }).click();
    await expect(popup.getByRole("menuitem", { name: /Settings/u })).toBeVisible();
    await expect(popup.getByRole("menuitem", { name: /Quit/u })).toHaveCount(0);
    const opened = context.waitForEvent("page");
    await popup.getByRole("menuitem", { name: /Settings/u }).click();
    await expect(await opened).toHaveURL(/\/options\.html$/u);
  });

  // The popup is the panel's size wherever it opens.
  for (const view of [
    ["light", 470],
    ["dark", 470],
  ] as const) {
    test(`passes an accessibility check (${view.join(", ")})`, async ({
      context,
      openExtensionPage,
      signIn,
      pageErrors,
    }) => {
      await fakeGitHub(context);
      const popup = await openExtensionPage("popup.html");
      await signIn(popup);
      await expectSoundPage(popup, view, row(popup, PROMO));
      expect(pageErrors).toEqual([]);
    });
  }
});
