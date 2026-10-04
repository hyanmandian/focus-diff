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

  test('makes a theme from picked colours, previews it, and styles pull requests once saved', async ({
    openExtensionPage,
    openPullRequest,
    background,
  }) => {
    const accent = (host: import('@playwright/test').Locator) =>
      host.evaluate((element) => getComputedStyle(element).getPropertyValue('--fd-accent').trim());
    const page = await openExtensionPage('options.html');
    await expect(page.locator('#tagline')).toHaveText(/Works on GitHub\.$/);
    await expect(page.locator('#theme option')).toHaveText(['Match the site', 'GitHub']);
    const preview = page.locator('#preview .demo-bar');
    await expect(preview.locator('.panel')).toBeVisible();
    const themed = await accent(preview);
    expect(themed).toMatch(/^#[\da-f]{6}$/);

    await page.getByRole('button', { name: 'New theme' }).click();
    await expect(page.locator('#theme')).toHaveValue(/.+/);
    await expect(page.locator('#theme option:checked')).toHaveText('My theme 1');
    await page.getByLabel('Theme name').fill('Pink');
    await expect(page.locator('#theme option:checked')).toHaveText('Pink');
    // An empty colour shows what the site's theme gives it.
    const accentField = page.getByRole('textbox', { name: 'Accent', exact: true });
    await expect(accentField).toHaveAttribute('placeholder', themed);
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(accentField).not.toHaveAttribute('placeholder', themed);
    await expect.poll(() => accent(preview)).toBe(await accentField.getAttribute('placeholder'));
    await page.emulateMedia({ colorScheme: 'light' });
    await expect(accentField).toHaveAttribute('placeholder', themed);

    await accentField.fill('#bf3989');
    await expect.poll(() => accent(preview)).toBe('#bf3989');
    await expect(page.getByLabel('Pick Accent')).toHaveValue('#bf3989');
    await expect(page.locator('#status')).toHaveText('Unsaved changes');

    // A typo is caught, keeps the preview as it was, and blocks saving.
    const textField = page.getByRole('textbox', { name: 'Text', exact: true });
    await textField.fill('#12');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toHaveText("Check the theme's name and colours before saving.");
    await expect(textField).toBeFocused();
    await expect(textField).toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: "Use the site's Text" }).click();

    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Saved.');
    const saved = await background.evaluate(async () => (await chrome.storage.sync.get('appearance')).appearance);
    expect(saved).toEqual({ theme: expect.any(String), themes: [{ id: saved.theme, name: 'Pink', colors: { accent: '#bf3989' } }] });
    const pullRequest = await openPullRequest();
    await expect.poll(() => accent(pullRequest.locator('focus-diff-panel'))).toBe('#bf3989');

    await page.bringToFront();
    await page.locator('#theme').selectOption({ label: 'Match the site' });
    await page.locator('#save').click();
    await expect.poll(() => accent(pullRequest.locator('focus-diff-panel'))).not.toBe('#bf3989');
  });

  test('shares a theme the way filters are shared', async ({ openExtensionPage, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await openExtensionPage('options.html');
    await expect(page.locator('#preview .demo-bar .panel')).toBeVisible();
    await page.getByRole('button', { name: 'New theme' }).click();
    await page.getByLabel('Theme name').fill('Pink');
    await page.getByRole('textbox', { name: 'Accent', exact: true }).fill('#bf3989');
    await page.getByRole('button', { name: 'Copy theme' }).click();
    await expect(page.locator('#toast')).toHaveText('Copied Pink to the clipboard');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(copied)).toEqual({ name: 'Pink', colors: { accent: '#bf3989' } });

    await page.getByRole('button', { name: 'Delete theme' }).click();
    await expect(page.locator('#theme option')).toHaveText(['Match the site', 'GitHub']);
    await page.getByLabel("Import a teammate's theme").fill('not a theme');
    await page.getByRole('button', { name: 'Import theme' }).click();
    await expect(page.locator('#theme-json-error')).toContainText("isn't a copied theme");
    await page.getByLabel("Import a teammate's theme").fill(copied);
    await page.getByRole('button', { name: 'Import theme' }).click();
    await expect(page.locator('#toast')).toHaveText('Imported 1 theme. Review it, then save.');
    await expect(page.locator('#theme option:checked')).toHaveText('Pink');
    await expect(page.getByRole('textbox', { name: 'Accent', exact: true })).toHaveValue('#bf3989');
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

  for (const view of PAGE_VIEWS)
    test(`edits a theme without accessibility violations or horizontal scroll (${view.join(', ')}px)`, async ({ openExtensionPage }) => {
      const page = await openExtensionPage('options.html');
      await page.getByRole('button', { name: 'New theme' }).click();
      await page.getByRole('textbox', { name: 'Accent', exact: true }).fill('#bf3989');
      await expectSoundPage(page, view, page.locator('#colors .color'));
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
