import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, test as base, type BrowserContext, type Locator, type Page, type Worker } from '@playwright/test';
import type { Config } from '../../src/utils/filters';

const extensionPath = path.resolve('.output/chrome-mv3');
const pullRequestHtml = readFileSync(path.resolve('tests/e2e/fixtures/pull-request.html'), 'utf8');
const virtualizedHtml = readFileSync(path.resolve('tests/e2e/fixtures/pull-request-virtualized.html'), 'utf8');

export const PULL_REQUEST = 'https://github.com/octo/web/pull/1/changes';
/** GitHub's newer, virtualized diff view with its embedded data. */
export const VIRTUALIZED_PULL_REQUEST = 'https://github.com/octo/web/pull/2/changes';

export const DEFAULT_CONFIG: Config = {
  global: [
    { id: 'frontend', name: 'Frontend', include: '\\.(ts|tsx|js|jsx)$', exclude: '\\.(test|spec|stories)\\.' },
    { id: 'backend', name: 'Backend', include: '\\.py$', exclude: '(^|/)tests/' },
    { id: 'docs', name: 'Docs', include: '\\.mdx?$', exclude: '' },
  ],
  repos: [],
};

/** Chrome picks its UI language, and so the extension's, from `--lang` everywhere but macOS. */
export const CAN_SWITCH_LANGUAGE = process.platform !== 'darwin';

interface Fixtures {
  context: BrowserContext;
  background: Worker;
  extensionId: string;
  seed: (config: Config) => Promise<void>;
  openPullRequest: (url?: string) => Promise<Page>;
  openExtensionPage: (file: string) => Promise<Page>;
  pageErrors: string[];
}

export const test = base.extend<Fixtures>({
  context: async ({ locale }, use) => {
    const language = locale ?? 'en-US';
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      locale: language,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`, `--lang=${language}`],
      env: { ...process.env, LANGUAGE: language.replace('-', '_') },
    });
    await context.route(/^https:\/\/github\.com\/octo\/web\/pull\/\d+\/(changes|files)$/, (route) =>
      route.fulfill({ contentType: 'text/html', body: route.request().url().includes('/pull/2/') ? virtualizedHtml : pullRequestHtml }),
    );
    await context.route(/^https:\/\/github\.com\/octo\/web\/pull\/\d+$/, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Conversation</title>' }),
    );
    await use(context);
    await context.close();
  },

  background: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    await use(worker);
  },

  extensionId: async ({ background }, use) => {
    await use(new URL(background.url()).host);
  },

  seed: async ({ background }, use) => {
    await use(async (config) => {
      await background.evaluate((value) => chrome.storage.sync.set({ config: value }), config);
    });
  },

  pageErrors: async ({}, use) => {
    await use([]);
  },

  openPullRequest: async ({ context, pageErrors, seed }, use) => {
    await use(async (url = PULL_REQUEST) => {
      await seed(DEFAULT_CONFIG);
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(url);
      await page.locator('focus-diff-panel .panel').waitFor({ state: url.endsWith('/changes') ? 'visible' : 'attached' });
      return page;
    });
  },

  openExtensionPage: async ({ context, extensionId, pageErrors }, use) => {
    await use(async (file) => {
      const page = await context.newPage();
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`chrome-extension://${extensionId}/${file}`);
      return page;
    });
  },
});

export const expect = test.expect;

export const accessibilityViolations = async (page: Page, include?: string) => {
  const builder = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice']);
  if (include) builder.include(include);
  const { violations } = await builder.analyze();
  return violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
};

/** Extension pages are checked in both themes, wide and at phone width. */
export const PAGE_VIEWS = [
  ['light', 1280],
  ['dark', 390],
] as const;

/** A page in a theme and width has no accessibility violations and doesn't scroll sideways, once `ready` is there. */
export const expectSoundPage = async (page: Page, [colorScheme, width]: (typeof PAGE_VIEWS)[number], ready: Locator) => {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ colorScheme });
  await expect(ready).not.toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(await accessibilityViolations(page)).toEqual([]);
};
