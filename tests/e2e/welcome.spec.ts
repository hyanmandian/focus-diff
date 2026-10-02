import type { Worker } from '@playwright/test';
import { accessibilityViolations, CAN_SWITCH_LANGUAGE, expect, test } from './fixtures';

const storedNames = (background: Worker) =>
  background.evaluate(async () =>
    ((await chrome.storage.sync.get('config')).config?.global ?? []).map((filter: { name: string }) => filter.name),
  );

test.describe('welcome page', () => {
  test.beforeEach(async ({ seed }) => seed({ global: [], repos: [] }));

  test('opens right after installing', async ({ context, extensionId }) => {
    await expect.poll(() => context.pages().map((page) => page.url())).toContain(`chrome-extension://${extensionId}/welcome.html`);
  });

  test('explains the extension and lists the examples', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('welcome.html');
    await expect(page.locator('h1')).toHaveText('Welcome to Focus Diff');
    await expect(page.locator('.steps li')).toHaveCount(3);
    await expect(page.locator('.recipe')).toHaveCount(7);
    await expect(page.locator('#shortcuts kbd')).toHaveCount(3);
  });

  test('adds and removes an example', async ({ openExtensionPage, background }) => {
    const page = await openExtensionPage('welcome.html');
    const toggle = (recipe: string) => page.locator(`[data-recipe="${recipe}"] .recipe-toggle`);

    await toggle('stack').click();
    await expect(toggle('stack')).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle('stack')).toBeFocused();
    await expect(page.locator('#toast')).toContainText('Added Frontend, Backend');
    expect(await storedNames(background)).toEqual(['Frontend', 'Backend']);

    await toggle('docs').click();
    await expect.poll(() => storedNames(background)).toEqual(['Frontend', 'Backend', 'Docs']);

    await toggle('stack').click();
    await expect.poll(() => storedNames(background)).toEqual(['Docs']);
  });

  for (const [colorScheme, width] of [
    ['light', 1280],
    ['dark', 390],
  ] as const) {
    test(`has no accessibility violations and no horizontal scroll (${colorScheme}, ${width}px)`, async ({ openExtensionPage }) => {
      const page = await openExtensionPage('welcome.html');
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('.recipe')).toHaveCount(7);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await accessibilityViolations(page)).toEqual([]);
    });
  }

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

test.describe('welcome page in Brazilian Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test.skip(!CAN_SWITCH_LANGUAGE, 'Chrome ignores --lang on macOS');

  test('speaks the browser language, including the filter names it adds', async ({ openExtensionPage, seed, background }) => {
    await seed({ global: [], repos: [] });
    const page = await openExtensionPage('welcome.html');
    await expect(page.locator('h1')).toHaveText('Boas-vindas ao Focus Diff');
    await page.locator('[data-recipe="tests"] .recipe-toggle').click();
    await expect.poll(() => storedNames(background)).toEqual(['Código', 'Testes']);
  });
});
