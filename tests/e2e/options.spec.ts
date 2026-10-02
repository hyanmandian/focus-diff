import { accessibilityViolations, CAN_SWITCH_LANGUAGE, DEFAULT_CONFIG, expect, test } from './fixtures';

test.describe('settings page', () => {
  test.beforeEach(async ({ seed }) => seed(DEFAULT_CONFIG));

  const stored = (background: import('@playwright/test').Worker) =>
    background.evaluate(async () => (await chrome.storage.sync.get('config')).config);

  test('renders the saved filters with every string translated', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await expect
      .poll(() => page.locator('#global .f-name').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
      .toEqual(['Frontend', 'Backend', 'Docs']);
    const untranslated = await page.evaluate(
      () => [...document.querySelectorAll('[data-i18n], [data-i18n-html]')].filter((element) => !element.textContent?.trim()).length,
    );
    expect(untranslated).toBe(0);
    await expect(page).toHaveTitle('Focus Diff settings');
  });

  test('blocks saving an invalid regex and focuses it', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await page.locator('#global .filter').first().locator('.f-exclude').fill('(');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('need fixing');
    await expect(page.locator('#global .filter').first().locator('.f-exclude')).toBeFocused();
    await expect(page.locator('#global .filter').first().locator('.error')).toContainText("isn't a valid regex");
  });

  test('saves repository filters', async ({ openExtensionPage, background }) => {
    const page = await openExtensionPage('options.html#repo=octo/web');
    await expect(page.locator('#add-repo')).toContainText('octo/web');
    await page.locator('#add-repo').click();
    await page.locator('.repo .add-filter').click();
    await page.locator('.repo .f-name').fill('API');
    await page.locator('.repo .f-include').fill('^api/');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Saved.');
    const config = await stored(background);
    expect(
      config.repos.map((entry: { repo: string; filters: { name: string }[] }) => [entry.repo, entry.filters.map((filter) => filter.name)]),
    ).toEqual([['octo/web', ['API']]]);
  });

  test('checks a path against the filters', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await page.locator('#try-path').fill('web/src/book-card.tsx');
    await expect(page.locator('#try-result')).toHaveText('Shown by All and Frontend.');
    await page.locator('#try-path').fill('web/src/book-card.test.tsx');
    await expect(page.locator('#try-result')).toContainText('Only All shows this file');
  });

  test('imports a teammate setup and rejects garbage', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await page.locator('#json').fill('not json');
    await page.locator('#import').click();
    await expect(page.locator('#json-error')).toContainText("isn't a copied set of filters");
    await page.locator('#json').fill(JSON.stringify({ global: [{ name: 'Only', include: 'x' }] }));
    await page.locator('#import').click();
    await expect
      .poll(() => page.locator('#global .f-name').evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)))
      .toEqual(['Only']);
    await expect(page.locator('#toast')).toHaveText('Imported 1 filter. Review it, then save.');
  });

  for (const [colorScheme, width] of [
    ['light', 1280],
    ['dark', 390],
  ] as const) {
    test(`has no accessibility violations and no horizontal scroll (${colorScheme}, ${width}px)`, async ({ openExtensionPage }) => {
      const page = await openExtensionPage('options.html#repo=octo/web');
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await expect(page.locator('#global .f-name')).toHaveCount(3);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
      expect(await accessibilityViolations(page)).toEqual([]);
    });
  }

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

test.describe('settings page in Brazilian Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test.skip(!CAN_SWITCH_LANGUAGE, 'Chrome ignores --lang on macOS');

  test('speaks the browser language', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await expect(page.locator('#save')).toHaveText('Salvar');
    await expect(page.locator('#global-h')).toHaveText('Todos os repositórios');
  });
});
