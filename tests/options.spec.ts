import { CAN_SWITCH_LANGUAGE, DEFAULT_CONFIG, expect, expectSoundPage, PAGE_VIEWS, test } from './fixtures';

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

  test('shows the version and where to find the project', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await expect(page.locator('#version')).toHaveText(/^Focus Diff \d+\.\d+\.\d+, open source under the MIT license$/);
    const links = page.getByRole('navigation', { name: 'Focus Diff project' }).getByRole('link');
    await expect(links).toHaveText(['Source code', 'Release notes', 'Report a bug', 'Suggest an idea', 'Privacy']);
    await expect(links.nth(2)).toHaveAttribute('href', /\/issues\/new\?template=bug_report\.yml$/);
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

  test("previews the bar's look as it's edited, and styles pull requests once saved", async ({ openExtensionPage, openPullRequest }) => {
    const accent = (host: import('@playwright/test').Locator) =>
      host.evaluate((element) => getComputedStyle(element).getPropertyValue('--fd-accent').trim());
    const page = await openExtensionPage('options.html');
    await expect(page.locator('#tagline')).toHaveText(/Works on GitHub\.$/);
    await expect(page.locator('#theme option')).toHaveText(['Match the site', 'GitHub']);
    const preview = page.locator('#preview .demo-bar');
    await expect(preview.locator('.panel')).toBeVisible();
    const themed = await accent(preview);
    expect(themed).not.toBe('');

    await page.locator('#css').fill(':host { --fd-accent: rgb(1, 2, 3); }');
    await expect.poll(() => accent(preview)).toBe('rgb(1, 2, 3)');
    await expect(page.locator('#status')).toHaveText('Unsaved changes');

    // The theme's colours come in above the reader's own CSS, which they then override.
    await page.locator('#css-start').click();
    await expect(page.locator('#css')).toHaveValue(/^:host \{\n {2}--fd-bg: [^;]+;[\s\S]+\n\n:host \{ --fd-accent: rgb\(1, 2, 3\); \}$/);
    await expect.poll(() => accent(preview)).toBe('rgb(1, 2, 3)');

    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Saved.');
    const pullRequest = await openPullRequest();
    await expect.poll(() => accent(pullRequest.locator('focus-diff-panel'))).toBe('rgb(1, 2, 3)');

    await page.bringToFront();
    await page.locator('#css-clear').click();
    await expect.poll(() => accent(preview)).toBe(themed);
    await page.locator('#save').click();
    await expect.poll(() => accent(pullRequest.locator('focus-diff-panel'))).not.toBe('rgb(1, 2, 3)');
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

  for (const view of PAGE_VIEWS)
    test(`has no accessibility violations and no horizontal scroll (${view.join(', ')}px)`, async ({ openExtensionPage }) => {
      const page = await openExtensionPage('options.html#repo=octo/web');
      await expectSoundPage(page, view, page.locator('#global .f-name'));
    });

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
