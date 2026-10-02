import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Route, Worker } from '@playwright/test';
import type { Guide } from '../../src/utils/guide';
import type { GuideEntry } from '../../src/utils/storage';
import { accessibilityViolations, CAN_SWITCH_LANGUAGE, expect, test } from './fixtures';
import { GuidePanel } from './pages/guide';
import { PullRequestPage } from './pages/pull-request';

const DIFF = readFileSync(path.resolve('tests/e2e/fixtures/pull-request.diff'), 'utf8');
const DIFF_HASH = createHash('sha256').update(DIFF).digest('hex');
const KEY = 'octo/web#1';
const SETTINGS = { provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant-test', model: 'claude-opus-5-5' };

const GUIDE: Guide = {
  summary: 'Adds a bookshelf: a service that stores books and a card that shows them.',
  chapters: [
    {
      title: 'Book service',
      kind: 'core',
      why: 'The service holds the new idea, so read it first.',
      files: ['api/books/service.py', 'api/books/__init__.py'],
      notes: [{ file: 'api/books/service.py', line: 'R3', text: 'An empty shelf returns nothing here.' }],
    },
    {
      title: 'Book card',
      kind: 'consequence',
      why: 'Shows the books from the service.',
      files: ['web/src/book-card.tsx', 'web/src/book-card.stories.tsx'],
      notes: [],
    },
    {
      title: 'Tests and docs',
      kind: 'supporting',
      why: '',
      files: ['web/src/book-card.test.tsx', 'api/tests/test_service.py', 'docs/books.md', 'api/legacy/routes.py'],
      notes: [],
    },
  ],
};

const entry = (patch: Partial<GuideEntry> = {}): GuideEntry => ({
  hash: DIFF_HASH,
  guide: GUIDE,
  model: 'claude-opus-5-5',
  host: 'api.anthropic.com',
  omitted: 0,
  createdAt: 1,
  open: true,
  chapter: 0,
  reviewed: [],
  ...patch,
});

/** Streams an answer the way the Messages API does. */
const anthropicStream = (text: string) =>
  [
    { type: 'message_start', message: {} },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    ...text.match(/.{1,60}/gs)!.map((chunk) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } })),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
    { type: 'message_stop' },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join('');

interface Network {
  requests: { url: string; headers: Record<string, string>; body: any }[];
}

const network = async (context: BrowserContext, provider: (route: Route) => Promise<void> | void, diff = DIFF): Promise<Network> => {
  const seen: Network = { requests: [] };
  await context.route('https://github.com/octo/web/pull/1.diff', (route) =>
    route.fulfill({ contentType: 'text/plain; charset=utf-8', body: diff }),
  );
  await context.route('https://api.anthropic.com/v1/messages', (route) => {
    const request = route.request();
    seen.requests.push({ url: request.url(), headers: request.headers(), body: request.postDataJSON() });
    return provider(route);
  });
  return seen;
};

const answerWithGuide = (route: Route) => route.fulfill({ contentType: 'text/event-stream', body: anthropicStream(JSON.stringify(GUIDE)) });

const store = (background: Worker, values: Record<string, unknown>) =>
  background.evaluate((items) => chrome.storage.local.set(items), values);

test.describe('guided review', () => {
  test('asks before sending the diff, then writes the guide', async ({ context, background, openPullRequest }) => {
    const seen = await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS });
    const page = await openPullRequest();
    const guide = new GuidePanel(page);

    await guide.start.click();
    await expect(guide.heading).toHaveText('Write a review guide?');
    expect(await guide.text()).toMatch(/8 files, about [\d,]+ tokens\) to api\.anthropic\.com/);
    await expect(guide.card).toContainText('Model: claude-opus-5-5');
    await expect(guide.primary).toBeFocused();
    expect(seen.requests).toHaveLength(0);

    await guide.card.getByRole('checkbox', { name: "Don't ask again for octo/web" }).check();
    await guide.primary.click();
    await expect(guide.heading).toHaveText('Review guide');
    await expect(guide.card).toContainText('Adds a bookshelf');

    const [request] = seen.requests;
    expect(request?.headers['x-api-key']).toBe('sk-ant-test');
    expect(request?.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(request?.body.model).toBe('claude-opus-5-5');
    expect(request?.body.output_config.format.type).toBe('json_schema');
    expect(request?.body.messages[0].content).toContain('Pull request #1: Add bookshelf');
    expect(request?.body.messages[0].content).toContain('File: api/books/service.py (+2 -1)\n@@\nR1   context line\nL2 - old line');
    expect(await background.evaluate(async () => (await chrome.storage.local.get('aiConsent')).aiConsent)).toEqual({ 'octo/web': true });
    expect(await new PullRequestPage(page).status.textContent()).toMatch(/^Review guide: 8 of 8 files/);
  });

  test('walks through a saved guide chapter by chapter', async ({ context, background, openPullRequest }) => {
    await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS, guides: { [KEY]: entry() } });
    const page = await openPullRequest();
    const pr = new PullRequestPage(page);
    const guide = new GuidePanel(page);

    await expect(guide.heading).toHaveText('Review guide');
    await expect(guide.chapterItem('Book service')).toHaveAccessibleName(
      'Chapter 1: Book service, Core change. 2 files, 25 lines added, 10 removed, ~5 min to review',
    );
    expect(await pr.visiblePaths()).toHaveLength(8);

    await guide.primary.click();
    await expect(guide.heading).toHaveText('Book service');
    await expect(guide.title).toHaveText('1/3Book service');
    const arrowX = Number.parseFloat(
      await guide.card.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--fd-arrow-x')),
    );
    const [card, title] = await Promise.all([guide.card.boundingBox(), guide.title.boundingBox()]);
    expect(
      Math.abs((card?.x ?? 0) + arrowX - ((title?.x ?? 0) + (title?.width ?? 0) / 2)),
      'the arrow points at the chapter title',
    ).toBeLessThan(2);
    await expect.poll(() => pr.visiblePaths()).toEqual(['api/books/service.py', 'api/books/__init__.py']);
    await expect(pr.filesCounter()).toHaveText('2/8');
    await expect(pr.status).toContainText('Book service: 2 of 8 files');

    await guide.reviewedCheckbox().check();
    await expect(guide.doneDots).toHaveCount(1);

    await guide.primary.click();
    await expect(guide.heading).toHaveText('Book card');
    await expect.poll(() => pr.visiblePaths()).toEqual(['web/src/book-card.tsx', 'web/src/book-card.stories.tsx']);

    await guide.exit.click();
    await expect(pr.options).toHaveText(['All', 'Frontend', 'Backend', 'Docs']);
    expect(await pr.visiblePaths()).toHaveLength(8);
    const saved = await background.evaluate(async () => (await chrome.storage.local.get('guides')).guides['octo/web#1']);
    expect(saved).toMatchObject({ open: false, chapter: 2, reviewed: [1] });
  });

  test('follows the keyboard shortcuts through chapters', async ({ context, background, openPullRequest }) => {
    await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS, guides: { [KEY]: entry() } });
    const guide = new GuidePanel(await openPullRequest());
    const send = (command: string) =>
      background.evaluate(async (name) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'command', command: name });
      }, command);
    await send('next-filter');
    await expect(guide.heading).toHaveText('Book service');
    await send('next-filter');
    await expect(guide.heading).toHaveText('Book card');
    await send('show-all');
    await expect(guide.heading).toHaveText('Review guide');
  });

  test('jumps to the line a note points at', async ({ context, background, openPullRequest }) => {
    await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS, guides: { [KEY]: entry({ chapter: 1 }) } });
    const page = await openPullRequest();
    await new GuidePanel(page).note('empty shelf').click();
    await expect(page.locator('#diff-3R3').locator('xpath=ancestor::tr')).toHaveCSS('outline-style', 'solid');
  });

  test('collapses the card without leaving the guide', async ({ context, background, openPullRequest }) => {
    await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS, guides: { [KEY]: entry({ chapter: 1 }) } });
    const guide = new GuidePanel(await openPullRequest());
    await guide.note('empty shelf').focus();
    await guide.page.keyboard.press('Escape');
    await expect(guide.card).toBeHidden();
    await expect(guide.title).toBeFocused();
    await guide.title.click();
    await expect(guide.card).toBeVisible();
  });

  test('flags a guide written for an older version of the pull request', async ({ context, background, openPullRequest }) => {
    await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS, guides: { [KEY]: entry({ hash: 'older' }) } });
    const guide = new GuidePanel(await openPullRequest());
    await expect(guide.card).toContainText('This pull request changed since the guide was written.');
    await guide.card.getByRole('button', { name: 'Write it again' }).click();
    await expect(guide.heading).toHaveText('Write a review guide?');
  });

  test('points to the settings when no provider is set up', async ({ context, openPullRequest }) => {
    const page = await openPullRequest();
    const guide = new GuidePanel(page);
    await guide.start.click();
    await expect(guide.heading).toHaveText('Guided review');
    const [settings] = await Promise.all([context.waitForEvent('page'), guide.primary.click()]);
    await expect(settings).toHaveURL(/\/options\.html#repo=octo%2Fweb&ai$/);
  });

  test('explains provider errors and tries again', async ({ context, background, openPullRequest }) => {
    await network(context, (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid x-api-key' } }) }),
    );
    await store(background, { ai: SETTINGS, aiConsent: { 'octo/web': true } });
    const guide = new GuidePanel(await openPullRequest());
    await guide.start.click();
    await expect(guide.heading).toHaveText("Couldn't write the guide");
    await expect(guide.card).toContainText("The provider didn't accept the API key.");
    await expect(guide.card).toContainText('invalid x-api-key');

    await context.unroute('https://api.anthropic.com/v1/messages');
    await context.route('https://api.anthropic.com/v1/messages', answerWithGuide);
    await guide.primary.click();
    await expect(guide.heading).toHaveText('Review guide');
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations in the ${colorScheme} theme`, async ({ context, background, openPullRequest }) => {
      await network(context, answerWithGuide);
      await store(background, { ai: SETTINGS, guides: { [KEY]: entry({ chapter: 1, reviewed: [1] }) } });
      const page = await openPullRequest();
      await page.emulateMedia({ colorScheme });
      const guide = new GuidePanel(page);
      await expect(guide.heading).toHaveText('Book service');
      expect(await accessibilityViolations(page, 'focus-diff-panel')).toEqual([]);
      await guide.title.click();
      await guide.title.click();
      await guide.panel.getByRole('button', { name: 'Previous chapter' }).click();
      await expect(guide.heading).toHaveText('Review guide');
      expect(await accessibilityViolations(page, 'focus-diff-panel')).toEqual([]);
    });
  }

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

test.describe('guided review in Brazilian Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test.skip(!CAN_SWITCH_LANGUAGE, 'Chrome ignores --lang on macOS');

  test('asks the model to write in the reader language', async ({ context, background, openPullRequest }) => {
    const seen = await network(context, answerWithGuide);
    await store(background, { ai: SETTINGS, aiConsent: { 'octo/web': true } });
    const guide = new GuidePanel(await openPullRequest());
    await guide.start.click();
    await expect(guide.heading).toHaveText('Guia de revisão');
    expect(seen.requests[0]?.body.system).toContain('Write in Brazilian Portuguese.');
  });
});
