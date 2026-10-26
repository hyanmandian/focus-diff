// First-run setup, signed in already on the sample data: GitHub, queues, notifications, AI, ready.

import { expect, test, type Page } from "@playwright/test";

import { callsOf, recordCalls, savedConfig } from "./ipc";

const step = (page: Page, name: string) => page.getByRole("list", { name: "Steps" }).getByRole("listitem", { name });
const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();

test.beforeEach(async ({ page }) => {
  await page.goto("/setup.html");
  await expect(page.getByRole("heading", { name: "Your reviews, without opening GitHub", level: 1 })).toBeVisible();
  await recordCalls(page);
});

test("starts on GitHub, connected", async ({ page }) => {
  await expect(step(page, "GitHub")).toHaveAttribute("aria-current", "step");
  await expect(page.getByText("Connected as @you")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back" })).toBeHidden();
});

test("walks every step, and back", async ({ page }) => {
  await next(page);
  await expect(step(page, "Queues")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "What should it watch?", level: 1 })).toBeVisible();

  await next(page);
  await expect(step(page, "Notifications")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "How should it tell you?", level: 1 })).toBeVisible();

  await next(page);
  await expect(step(page, "AI")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("radio", { name: /^Claude Code/u })).toBeChecked();

  await next(page);
  await expect(step(page, "Ready")).toHaveAttribute("aria-current", "step");
  await expect(page.getByRole("heading", { name: "You're set", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeHidden();

  await page.getByRole("button", { name: "Back" }).click();
  await expect(step(page, "AI")).toHaveAttribute("aria-current", "step");
});

test("needs at least one queue to go on", async ({ page }) => {
  await next(page);
  const queues = page.getByRole("checkbox");
  await expect(queues).toHaveCount(4);
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(4);
  await page.getByRole("checkbox", { name: /^Needs my review/u }).click();
  await page.getByRole("checkbox", { name: /^Updates/u }).click();
  await page.getByRole("checkbox", { name: /^My pull requests/u }).click();
  await page.getByRole("checkbox", { name: /^Merged without me/u }).click();
  await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

  await page.getByRole("checkbox", { name: /^Updates/u }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
});

test("saves the choices and opens the panel at the end", async ({ page }) => {
  await next(page);
  await page.getByRole("checkbox", { name: /^Merged without me/u }).click();
  await page.getByRole("textbox", { name: "Repositories" }).fill("acme/web");
  await page.getByRole("textbox", { name: "Repositories" }).press("Enter");
  await next(page);
  await page.getByRole("switch", { name: "Play a sound" }).click();
  await next(page);
  await page.getByRole("radio", { name: /^No AI/u }).click();
  await next(page);
  await page.getByRole("button", { name: "Open Focus Diff" }).click();

  await expect.poll(() => callsOf(page, "open_panel")).toHaveLength(1);
  expect(await savedConfig(page)).toMatchObject({
    sound: true,
    queues: [
      { kind: "review", repos: ["acme/web"] },
      { kind: "involved", repos: ["acme/web"] },
      { kind: "authored", repos: ["acme/web"] },
    ],
  });
});
