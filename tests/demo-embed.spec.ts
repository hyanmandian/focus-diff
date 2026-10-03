import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { accessibilityViolations, expect, test } from './fixtures';

const script = () => readFileSync(path.resolve('.output/demo/focus-diff-demo.js'), 'utf8');
const SITE = 'https://site.test/';

// The site's embed: a plain page, no extension, the demo from `npm run build:demo`.
test('runs the demo on a plain web page, without the extension', async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ locale: 'en-US' })).newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route(`${SITE}**`, (route) =>
    route.request().url().endsWith('.js')
      ? route.fulfill({ contentType: 'text/javascript', body: script() })
      : route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html lang="en"><title>Site</title><main><h1>Focus Diff</h1><div data-focus-diff-demo data-settings="#install"></div></main><script type="module" src="focus-diff-demo.js"></script></html>',
        }),
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(SITE);
  const demo = page.getByRole('group', { name: 'Sample pull request' });
  const bar = demo.locator('.panel');
  await bar.getByRole('button', { name: /^Backend/ }).click();
  await expect(demo.locator('.demo-file:not([data-out])')).toHaveCount(3);
  await expect(bar.getByRole('status')).toContainText('Backend: 3 of 12 files');
  await bar.getByRole('button', { name: 'Focus Diff settings' }).click();
  await expect(page).toHaveURL(`${SITE}#install`);
  expect(await accessibilityViolations(page)).toEqual([]);
  expect(errors).toEqual([]);
  await browser.close();
});
