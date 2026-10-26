// First run: the Mac app's setup, which opens on install. A browser has no AI tools, so there's no AI step.
import type { Page } from "@playwright/test";

import { expect, expectSoundPage, PAGE_VIEWS, test } from "./fixtures";
import { fakeGitHub } from "./github";

const step = (page: Page, name: string) => page.getByRole("list", { name: "Steps" }).getByRole("listitem", { name });
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

test.describe("setup", () => {
  test("opens on install", async ({ context, extensionId }) => {
    const url = `chrome-extension://${extensionId}/setup.html`;
    await expect.poll(() => context.pages().map((page) => page.url())).toContain(url);
  });

  test("connects GitHub, picks the queues, and saves them", async ({ context, openExtensionPage, background }) => {
    await fakeGitHub(context);
    const setup = await openExtensionPage("setup.html");
    await expect(setup.getByRole("heading", { name: "Your reviews, without opening GitHub", level: 1 })).toBeVisible();
    await expect(setup.getByText(/sits in your browser's toolbar/u)).toBeVisible();
    await expect(setup.getByRole("button", { name: "Continue" })).toBeDisabled();
    await setup.getByLabel("Personal access token").fill("ghp_sample");
    await setup.getByRole("button", { name: "Use this token" }).click();
    await expect(setup.getByText("Connected as @you")).toBeVisible();

    await next(setup);
    await expect(step(setup, "Queues")).toHaveAttribute("aria-current", "step");
    await setup.getByRole("checkbox", { name: /^Merged without me/u }).click();
    await next(setup);
    await expect(step(setup, "Notifications")).toHaveAttribute("aria-current", "step");
    await expect(setup.getByText(/a count on its toolbar button/u)).toBeVisible();
    await next(setup);
    await expect(step(setup, "Ready")).toHaveAttribute("aria-current", "step");
    await expect(setup.getByRole("list", { name: "Steps" }).getByRole("listitem")).toHaveCount(4);
    await expect(setup.getByText(/lives in your browser's toolbar/u)).toBeVisible();

    const closed = setup.waitForEvent("close");
    await setup.getByRole("button", { name: "Open Focus Diff" }).click();
    await closed;
    const stored = await background.evaluate(() => chrome.storage.local.get("file.config"));
    const config = JSON.parse(String(stored["file.config"])) as { queues: Array<{ kind: string; enabled: boolean }> };
    expect(config.queues.filter((queue) => queue.enabled).map((queue) => queue.kind)).toEqual([
      "review",
      "involved",
      "authored",
      "merged",
    ]);
  });

  for (const view of PAGE_VIEWS) {
    test(`passes an accessibility check (${view.join(", ")})`, async ({ openExtensionPage, pageErrors }) => {
      const setup = await openExtensionPage("setup.html");
      await expectSoundPage(setup, view, setup.getByRole("list", { name: "Steps" }));
      expect(pageErrors).toEqual([]);
    });
  }
});
