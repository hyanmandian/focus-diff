import type { Worker } from "@playwright/test";

import type { Config } from "../src/utils/filters/filters";
import { accessibilityViolations, CAN_SWITCH_LANGUAGE, expect, expectSoundPage, PAGE_VIEWS, test } from "./fixtures";

const storedNames = (background: Worker) =>
  background.evaluate(async () =>
    ((await chrome.storage.sync.get<{ config?: Config }>("config")).config?.global ?? []).map((filter) => filter.name),
  );

test.describe("welcome page", () => {
  test.beforeEach(({ seed }) => seed({ global: [], repos: [] }));

  test("opens right after installing", async ({ context, extensionId }) => {
    await expect
      .poll(() => context.pages().map((page) => page.url()))
      .toContain(`chrome-extension://${extensionId}/welcome.html`);
  });

  test("explains the extension and lists the examples", async ({ openExtensionPage }) => {
    const page = await openExtensionPage("welcome.html");
    await expect(page.locator("h1")).toHaveText("Welcome to Focus Diff");
    await expect(page.locator(".steps li")).toHaveCount(3);
    await expect(page.locator("#recipes .recipe")).toHaveCount(7);
    await expect(page.locator("#shortcuts kbd")).toHaveCount(4);
  });

  test("adds and removes an example", async ({ openExtensionPage, background }) => {
    const page = await openExtensionPage("welcome.html");
    const toggle = (recipe: string) => page.locator(`[data-recipe="${recipe}"] .recipe-toggle`);

    await toggle("stack").click();
    await expect(toggle("stack")).toHaveAccessibleName("Remove Frontend, Backend");
    await expect(toggle("stack")).toBeFocused();
    await expect(page.locator("#toast")).toContainText("Added Frontend, Backend");
    expect(await storedNames(background)).toEqual(["Frontend", "Backend"]);

    await toggle("docs").click();
    await expect.poll(() => storedNames(background)).toEqual(["Frontend", "Backend", "Docs"]);

    await toggle("stack").click();
    await expect.poll(() => storedNames(background)).toEqual(["Docs"]);
  });

  test("lets people try the real bar on a sample pull request", async ({ openExtensionPage }) => {
    const page = await openExtensionPage("welcome.html");
    const demo = page.getByRole("group", { name: "Sample pull request" });
    const files = demo.locator(".demo-file");
    const bar = demo.locator(".panel");
    const stats = async () =>
      (
        await bar.locator(".stats").evaluate((element) => {
          const hidden = (child: Element) =>
            getComputedStyle(child).visibility === "hidden" || child.closest('[aria-hidden="true"]');
          return [...element.querySelectorAll(".visually-hidden")]
            .filter((child) => !hidden(child))
            .map((child) => child.textContent)
            .join("");
        })
      )
        .replaceAll(/\s+/gu, " ")
        .trim();
    await expect(files).toHaveCount(12);
    await expect.poll(stats).toMatch(/^9 files left to review \+910 lines added, −443 lines removed/u);

    const layout = () =>
      demo.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return [
          box.height,
          ...[...element.querySelectorAll(".demo-file")].map((row) => row.getBoundingClientRect().top - box.top),
        ].join();
      });
    const before = await layout();
    await bar.getByRole("button", { name: /^Frontend/u }).click();
    expect(await layout()).toBe(before);
    const outside = demo.getByRole("button", { name: "Viewed api/orders/service.py" });
    await expect(outside).toHaveAttribute("aria-disabled", "true");
    await expect(outside).toHaveAccessibleDescription("Not in Frontend");
    await outside.dispatchEvent("click");
    await expect(outside).toHaveAttribute("aria-pressed", "false");
    await expect(demo.locator(".demo-file:not([data-out])")).toHaveText([/cart\.tsx/u, /use-cart\.ts/u, /cart\.css/u]);
    await expect.poll(stats).toMatch(/^2 files left to review \+150 lines added, −25 lines removed/u);
    await expect(bar.locator(".scoreboard.files-count .cell")).toHaveText(["", "2"]);
    await expect(bar.getByRole("status")).toContainText("Frontend: 3 of 12 files");
    await expect(files.first()).toHaveAttribute("aria-current", "true");
    const next = bar.locator(".next-file");
    await expect(next).toHaveAccessibleName("Next file to review, 2 left");
    await next.click();
    await expect(files.nth(2)).toHaveAttribute("aria-current", "true");
    await expect(bar.getByRole("status")).toHaveText("web/src/checkout/cart.css. 2 files left to review.");

    await demo.getByRole("button", { name: "Viewed web/src/checkout/cart.tsx" }).click();
    await demo.getByRole("button", { name: "Viewed web/src/checkout/cart.css" }).click();
    await expect(bar.locator(".done")).toBeVisible();
    await expect(bar.getByRole("status")).toHaveText("Every file in Frontend is reviewed.");
    await expect(next).toHaveAccessibleName(/Backend/u);
    await next.click();
    await expect(bar.getByRole("button", { name: /^Backend/u })).toHaveAttribute("aria-pressed", "true");
    expect(await layout()).toBe(before);
    await next.click();
    await expect(files.filter({ hasText: "api/orders/migrations" })).toHaveAttribute("aria-current", "true");
    await expect(demo.locator(".demo-file:not([data-out])")).toHaveCount(3);

    const checkAndClose = async (card: string) => {
      const dialog = bar.getByRole("dialog", { name: card });
      await expect(dialog).toHaveCSS("opacity", "1");
      expect(await accessibilityViolations(page, "#demo")).toEqual([]);
      await page.mouse.move(0, 0);
      await expect(demo.locator(".tip:not([hidden])")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
    };

    await bar.getByRole("button", { name: /^All/u }).click();
    await bar.getByRole("button", { name: "Breakdown by filter" }).click();
    await expect(bar.locator(".row")).toHaveText([
      /^All.*5\/12.*\+910.*−443/u,
      /^Frontend.*3\/3.*\+150.*−25/u,
      /^Backend.*1\/3.*\+118.*−23/u,
    ]);
    await checkAndClose("Breakdown by filter");

    await bar.getByRole("button", { name: /^Conversations,/u }).click();
    const talk = (path: string) => files.filter({ hasText: path }).locator(".demo-talk");
    await expect(talk("web/src/checkout/cart.tsx")).toHaveAttribute("data-current", "");
    await expect(files.first()).toHaveAttribute("aria-current", "true");
    await expect(bar.getByRole("status")).toHaveText("Conversation 1 of 3, in web/src/checkout/cart.tsx.");
    await bar.getByRole("button", { name: "Next conversation" }).click();
    await expect(talk("api/orders/service.py")).toHaveAttribute("data-current", "");
    await expect(talk("web/src/checkout/cart.tsx")).not.toHaveAttribute("data-current");
    await expect(bar.getByRole("status")).toHaveText("Conversation 2 of 3, in api/orders/service.py.");
    await checkAndClose("Conversations");
  });

  for (const [width, compact] of [
    [1280, false],
    [960, false],
    [390, true],
  ] as const)
    test(`keeps the demo's bar to one row at ${width}px${compact ? ", compact" : ""}`, async ({
      openExtensionPage,
    }) => {
      const page = await openExtensionPage("welcome.html");
      await page.setViewportSize({ width, height: 900 });
      const bar = page.getByRole("group", { name: "Sample pull request" }).locator(".panel");
      await expect(bar.getByRole("button", { name: /^All/u })).toBeVisible();
      await expect(bar.locator(".stats")).toBeVisible({ visible: !compact });
      const layout = await bar.evaluate((element) => {
        const items = [...element.children]
          .map((child) => child.getBoundingClientRect())
          .filter((box) => box.width > 1 && box.height > 1);
        const centres = items.map((box) => Math.round(box.top + box.height / 2));
        const style = getComputedStyle(element);
        const chrome =
          parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) * 2;
        return {
          centres: [...new Set(centres)],
          extra: element.getBoundingClientRect().height - chrome - Math.max(...items.map((box) => box.height)),
        };
      });
      expect(
        Math.max(...layout.centres) - Math.min(...layout.centres),
        `centres ${layout.centres.join(", ")}`,
      ).toBeLessThanOrEqual(1);
      expect(layout.extra).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    });

  for (const view of PAGE_VIEWS)
    test(`has no accessibility violations and no horizontal scroll (${view.join(", ")}px)`, async ({
      openExtensionPage,
    }) => {
      const page = await openExtensionPage("welcome.html");
      await expectSoundPage(page, view, page.locator("#recipes .recipe"));
    });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

test.describe("welcome page in Brazilian Portuguese", () => {
  test.use({ locale: "pt-BR" });
  test.skip(!CAN_SWITCH_LANGUAGE, "Chrome ignores --lang on macOS");

  test("speaks the browser language, including the filter names it adds", async ({
    openExtensionPage,
    seed,
    background,
  }) => {
    await seed({ global: [], repos: [] });
    const page = await openExtensionPage("welcome.html");
    await expect(page.locator("h1")).toHaveText("Boas-vindas ao Focus Diff");
    await page.locator('[data-recipe="tests"] .recipe-toggle').click();
    await expect.poll(() => storedNames(background)).toEqual(["Código", "Testes"]);
  });
});
