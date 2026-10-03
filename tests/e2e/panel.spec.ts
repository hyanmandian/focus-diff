import { accessibilityViolations, CAN_SWITCH_LANGUAGE, DEFAULT_CONFIG, expect, LARGE_PULL_REQUEST, PULL_REQUEST, test } from './fixtures';
import { PullRequestPage } from './pages/pull-request';

test.describe('panel on a pull request', () => {
  test('shows every file with All selected', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await expect(pr.options).toHaveText(['All', 'Frontend', 'Backend', 'Docs']);
    await expect(pr.pressed).toHaveText(['All']);
    expect(await pr.visiblePaths()).toHaveLength(8);
    await expect.poll(() => pr.statsText()).toMatch(/8\/8 files/);
    await expect(pr.filesCounter()).toHaveText('8');
  });

  test('filters diffs, the file tree and the page counters', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Frontend');
    await expect.poll(() => pr.visiblePaths()).toEqual(['web/src/book-card.tsx']);
    expect(await pr.visibleTreeFiles()).toEqual(['book-card.tsx']);
    await expect(pr.filesCounter()).toHaveText('1/8');
    await expect(pr.lineCounters().additions).toHaveText('+40');
    await expect(pr.lineCounters().deletions).toHaveText('−10');
    await expect(pr.status).toHaveText('Frontend: 1 of 8 files, 40 lines added, 10 removed. About 3 min left to review.');
    await expect.poll(() => pr.statsText()).toMatch(/~3 min/);

    await pr.pick('Backend');
    await expect.poll(() => pr.visiblePaths()).toEqual(['api/books/service.py', 'api/books/__init__.py', 'api/legacy/routes.py']);
    expect(await pr.visibleTreeFiles()).toEqual(['__init__.py', 'service.py', 'routes.py']);
    await expect(pr.filesCounter()).toHaveText('3/8');
    await expect(pr.lineCounters().additions).toHaveText('+120');
    await expect(pr.status).toContainText("1 of them hasn't loaded yet");

    await pr.pick('All');
    await expect(pr.filesCounter()).toHaveText('8');
    await expect(pr.lineCounters().deletions).toHaveText('−30');
  });

  test('turns filters on and off, falling back to All', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await expect(pr.pressed).toHaveText(['All']);
    await pr.option('Frontend').click();
    await expect(pr.pressed).toHaveText(['Frontend']);
    await pr.option('Docs').click();
    await expect(pr.pressed).toHaveText(['Frontend', 'Docs']);
    await expect.poll(() => pr.visiblePaths()).toEqual(['web/src/book-card.tsx', 'docs/books.md']);
    await expect(pr.filesCounter()).toHaveText('2/8');
    await expect(pr.status).toContainText('Frontend + Docs: 2 of 8 files');

    await pr.option('Frontend').click();
    await expect(pr.pressed).toHaveText(['Docs']);
    await pr.option('Docs').click();
    await expect(pr.pressed).toHaveText(['All'], { timeout: 2000 });

    await pr.option('Backend').click();
    await pr.option('All').click();
    await expect(pr.pressed).toHaveText(['All']);
  });

  test('shows how the pull request splits across filters', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.breakdownToggle.click();
    await expect(pr.breakdownRows).toHaveCount(4);
    const breakdown = pr.panel.locator('.breakdown');
    const arrowX = Number.parseFloat(
      await breakdown.evaluate((element) => (element as HTMLElement).style.getPropertyValue('--fd-arrow-x')),
    );
    const [popover, toggle] = await Promise.all([breakdown.boundingBox(), pr.breakdownToggle.boundingBox()]);
    expect(
      Math.abs((popover?.x ?? 0) + arrowX - ((toggle?.x ?? 0) + (toggle?.width ?? 0) / 2)),
      'the arrow points at the button',
    ).toBeLessThan(2);
    await expect(pr.breakdownRows.first()).toHaveAttribute('aria-pressed', 'true');
    await expect(pr.breakdownRows.first()).toHaveAccessibleName(
      'All: 8 files, 0 viewed, 120 lines added, 30 removed. ~10 min left to review',
    );
    await expect(pr.breakdownRows.nth(1)).toHaveAccessibleName(
      'Frontend: 1 file, 0 viewed, 40 lines added, 10 removed. ~3 min left to review',
    );
    await expect(pr.breakdownRows.nth(1).locator('.row-time')).toHaveText('~3 min');
    await expect(pr.breakdownRows.first().locator('.diffstat .add')).toHaveCount(4);
    await expect(pr.breakdownRows.first().locator('.diffstat .del')).toHaveCount(1);

    await pr.panel.getByRole('button', { name: 'How review time is estimated' }).hover();
    await expect(pr.panel.locator('.tip')).toContainText('Review time assumes about 1,000 changed lines an hour');
    // The pointer can move onto it to read it.
    await pr.panel.locator('.tip').hover();
    await expect(pr.panel.locator('.tip')).toBeVisible();
    await expect(pr.panel.getByRole('button', { name: 'How review time is estimated' })).toHaveAccessibleDescription(
      /^Review time assumes about 1,000 changed lines an hour/,
    );

    await pr.breakdownRows.nth(1).click();
    await expect(pr.pressed).toHaveText(['Frontend']);
    expect(await accessibilityViolations(pr.page, 'focus-diff-panel')).toEqual([]);

    await pr.page.keyboard.press('Escape');
    await expect(pr.panel.locator('.breakdown')).toBeHidden();
  });

  test("tracks review progress from GitHub's Viewed toggles", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const viewedToggle = (path: string) =>
      pr.page.locator('[data-diff-header-wrapper]', { hasText: path }).getByRole('button', { name: 'Viewed' });

    await pr.pick('Frontend');
    await expect.poll(() => pr.statsText()).toMatch(/~3 min left to review$/);
    // Finishing the filter's last file is celebrated.
    await pr.page.emulateMedia({ reducedMotion: 'no-preference' });
    await viewedToggle('web/src/book-card.tsx').click();
    await expect.poll(() => pr.statsText()).toMatch(/1\/8 files.*Done$/);
    await expect(pr.status).toHaveText('Every file in Frontend is reviewed.');
    await expect(pr.panel.locator('canvas')).toHaveCount(1);
    await expect(pr.panel.locator('canvas')).toHaveCount(0, { timeout: 4000 });
    // Coming back to a finished filter isn't.
    await pr.pick('Backend');
    await pr.pick('Frontend');
    await expect(pr.status).toContainText('Frontend: 1 of 8 files');
    await expect(pr.panel.locator('canvas')).toHaveCount(0);

    await pr.breakdownToggle.click();
    await expect(pr.breakdownRows.nth(1).locator('.row-viewed')).toHaveText('1/1');
    await expect(pr.breakdownRows.nth(1).locator('.row-viewed')).toHaveClass(/complete/);
    await expect(pr.breakdownRows.nth(1).locator('.row-time')).toHaveText('');
    await expect(pr.breakdownRows.first().locator('.row-viewed')).toHaveText('1/8');
    await expect(pr.breakdownRows.first().locator('.row-time')).toHaveText('~7 min');
    await expect(pr.breakdownRows.nth(1)).toHaveAccessibleName('Frontend: 1 file, 1 viewed, 40 lines added, 10 removed. Done');
  });

  test('disables filters with nothing to review here, and says why', async ({ openPullRequest, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ ...DEFAULT_CONFIG, global: [...DEFAULT_CONFIG.global, { id: 'rust', name: 'Rust', include: '\\.rs$', exclude: '' }] });
    const rust = pr.option('Rust');
    await expect(rust).toHaveAttribute('aria-disabled', 'true');
    await rust.hover();
    await expect(pr.panel.locator('.tip')).toHaveText('No files in this pull request match Rust');
    await expect(rust).toHaveAccessibleDescription('No files in this pull request match Rust');
    await rust.click({ force: true });
    await expect(pr.pressed).toHaveText(['All']);
    await expect(pr.option('Docs')).toHaveAttribute('aria-disabled', 'false');
    await pr.breakdownToggle.click();
    const row = pr.breakdownRows.filter({ hasText: 'Rust' });
    await expect(row).toHaveAttribute('aria-disabled', 'true');
    await row.click({ force: true });
    await expect(pr.pressed).toHaveText(['All']);
  });

  test('leaves out remembered filters with nothing here, down to All', async ({ openPullRequest, seed, background }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ ...DEFAULT_CONFIG, global: [...DEFAULT_CONFIG.global, { id: 'rust', name: 'Rust', include: '\\.rs$', exclude: '' }] });
    const remember = (ids: string[]) => background.evaluate((value) => chrome.storage.local.set({ active: { 'octo/web': value } }), ids);
    await remember(['rust', 'docs']);
    await expect(pr.pressed).toHaveText(['Docs']);
    await remember(['rust']);
    await expect(pr.pressed).toHaveText(['All']);
    // What was remembered stays, for pull requests where Rust has files.
    expect(await background.evaluate(async () => (await chrome.storage.local.get('active')).active)).toEqual({ 'octo/web': ['rust'] });
    // Picking from here starts from what's shown.
    await pr.pick('Docs');
    await expect(pr.pressed).toHaveText(['Docs']);
  });

  test('goes to the first file left to review when the filter changes', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const top = (path: string) =>
      pr.page.locator('[data-diff-header-wrapper]', { hasText: path }).evaluate((header) => Math.round(header.getBoundingClientRect().top));
    await pr.page
      .locator('[data-diff-header-wrapper]', { hasText: 'api/books/service.py' })
      .getByRole('button', { name: 'Viewed' })
      .click();
    await pr.pick('Backend');
    // service.py is viewed, so the next Backend file comes to the top, under GitHub's sticky header.
    await expect.poll(() => top('api/tests/test_service.py')).toBeLessThan(120);
  });

  test('opens the page onto a new filter, leaving the panel out', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.emulateMedia({ reducedMotion: 'no-preference' });
    expect(await pr.page.locator('focus-diff-panel').evaluate((host) => getComputedStyle(host).viewTransitionName)).toBe(
      'focus-diff-panel',
    );
    const started = pr.page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          new MutationObserver(() => document.documentElement.hasAttribute('data-focus-diff-filtering') && resolve(true)).observe(
            document.documentElement,
            { attributes: true },
          );
          setTimeout(() => resolve(false), 3000);
        }),
    );
    await pr.pick('Docs');
    expect(await started).toBe(true);
    await expect(pr.page.locator('html')).not.toHaveAttribute('data-focus-diff-filtering');
    await expect(pr.pressed).toHaveText(['Docs']);
  });

  test('survives picking filters while one is still animating', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.emulateMedia({ reducedMotion: 'no-preference' });
    await pr.pick('Docs');
    await pr.page.waitForTimeout(150);
    await pr.pick('Backend');
    await pr.page.evaluate(() =>
      requestAnimationFrame(() => document.querySelector('focus-diff-panel')?.shadowRoot?.querySelector<HTMLElement>('.option')?.click()),
    );
    await expect(pr.pressed).toHaveText(['All']);
    // Once it settles, nothing of any transition is left on GitHub's page.
    await expect
      .poll(() =>
        pr.page.evaluate(() => ({
          active: document.documentElement.hasAttribute('data-focus-diff-filtering'),
          named: document.body.querySelectorAll('[style*="view-transition-name"]').length,
          animations: document.documentElement.getAnimations().length,
        })),
      )
      .toEqual({ active: false, named: 0, animations: 0 });
    // And a later pick doesn't jump back to the first file on its own.
    await pr.page.evaluate(() => scrollTo(0, 600));
    await pr.page.locator('[data-diff-header-wrapper]', { hasText: 'docs/books.md' }).getByRole('button', { name: 'Viewed' }).click();
    await pr.page.waitForTimeout(600);
    expect(await pr.page.evaluate(() => scrollY)).toBeGreaterThan(500);
  });

  test('lets a jump still waiting on GitHub go when the filter changes', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Backend');
    await pr.panel.locator('.comments').click();
    // Opening lands on the resolved thread, which GitHub is still loading; the reader moves on, and the late jump neither lands nor speaks.
    await pr.pick('All');
    await expect(pr.status).toHaveText(/^All: /);
    await pr.page.waitForTimeout(800);
    await expect(pr.status).toHaveText(/^All: /);
    await expect(pr.panel.locator('.comments')).toHaveAccessibleName('Conversations, 4 conversations');
  });

  test('keeps filters with no loaded files open while GitHub is still loading files', async ({ openPullRequest, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ ...DEFAULT_CONFIG, global: [...DEFAULT_CONFIG.global, { id: 'ruby', name: 'Ruby', include: '\\.rb$', exclude: '' }] });
    await expect(pr.option('Ruby')).toHaveAttribute('aria-disabled', 'true');
    // GitHub reports more files than it has drawn so far.
    await pr.page.evaluate(() => (document.querySelector('[aria-current="page"] .Counter')!.textContent = '12'));
    await pr.pick('Docs');
    await expect(pr.option('Ruby')).toHaveAttribute('aria-disabled', 'false');
  });

  test('speaks its own language and keeps focus on the page clear of the bar', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    expect(await pr.page.locator('focus-diff-panel').getAttribute('lang')).toMatch(/^en/);
    const padding = await pr.page.evaluate(() => Number.parseFloat(document.documentElement.style.scrollPaddingBottom));
    const height = (await pr.panel.locator('.panel').boundingBox())!.height;
    expect(padding).toBeGreaterThan(height);
  });

  test('opens the review time hint on click, for touch', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.breakdownToggle.click();
    const info = pr.panel.getByRole('button', { name: 'How review time is estimated' });
    await info.click();
    await expect(pr.panel.locator('.tip')).toBeVisible();
    await info.click();
    await expect(pr.panel.locator('.tip')).toBeHidden();
  });

  test('stays on one row and on screen at 400% zoom', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.setViewportSize({ width: 320, height: 256 });
    await expect(pr.stats).toBeHidden();
    expect((await pr.panel.locator('.panel').boundingBox())!.height).toBeLessThan(64);
    await pr.breakdownToggle.click();
    const popover = (await pr.panel.locator('.breakdown').boundingBox())!;
    expect(popover.y).toBeGreaterThanOrEqual(0);
    await pr.pick('Docs');
    await expect(pr.pressed).toHaveText(['Docs']);
  });

  test('goes to the next file to review, then on to the next filter with any', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const next = pr.panel.locator('.next-file');
    await expect(next).toHaveAccessibleName('Next file to review, 8 left');
    await next.hover();
    await expect(pr.panel.locator('.tip')).toHaveText('Next file to review, 8 left');
    // The first file is already on screen, so it's the one after it.
    await next.click();
    await expect(pr.status).toHaveText('web/src/book-card.test.tsx. 8 files left to review.');
    // Docs done: the button moves on to the next filter in the bar.
    await pr.pick('Docs');
    await pr.page.locator('[data-diff-header-wrapper]', { hasText: 'docs/books.md' }).getByRole('button', { name: 'Viewed' }).click();
    await expect(next).toHaveAccessibleName('Go to Frontend, 1 file to review');
    await next.click();
    await expect(pr.pressed).toHaveText(['Frontend']);
  });

  test('says when everything is viewed, and goes on with the keyboard shortcut', async ({ openPullRequest, background, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await background.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'command', command: 'next-unviewed' });
    });
    await expect(pr.status).toHaveText(/^web\/src\/book-card\.test\.tsx\./);
    // With Docs the only filter, finishing it leaves nothing to go on to.
    await seed({ ...DEFAULT_CONFIG, global: DEFAULT_CONFIG.global.filter((filter) => filter.id === 'docs') });
    await pr.pick('Docs');
    await pr.page.locator('[data-diff-header-wrapper]', { hasText: 'docs/books.md' }).getByRole('button', { name: 'Viewed' }).click();
    const next = pr.panel.locator('.next-file');
    await expect(next).toHaveAttribute('aria-disabled', 'true');
    await expect(next).toHaveAccessibleName('Every file here is viewed');
  });

  test("keeps popovers' arrows: they never scroll themselves", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.setViewportSize({ width: 1280, height: 420 });
    await pr.panel.locator('.comments').click();
    await pr.breakdownToggle.click();
    for (const popover of [pr.panel.locator('.breakdown'), pr.panel.locator('.conversations')])
      expect(await popover.evaluate((element) => getComputedStyle(element).overflowY)).toBe('visible');
  });

  test('shows how many files each filter holds', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await expect(pr.panel.locator('.option .option-count')).toHaveText(['8', '1', '3', '1']);
    await expect(pr.option('Backend')).toHaveAccessibleName('Backend 3 files');
  });

  test('steps through the conversations in the shown files', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const comments = pr.panel.locator('.comments');
    const next = pr.panel.getByRole('button', { name: 'Next conversation' });
    const previous = pr.panel.getByRole('button', { name: 'Previous conversation' });
    const centred = (text: string) =>
      pr.page.evaluate((needle) => {
        const thread = [...document.querySelectorAll('.js-resolvable-timeline-thread-container')].find((element) =>
          element.textContent?.includes(needle),
        )!;
        const box = thread.getBoundingClientRect();
        // Near the top of the page there's nothing to scroll; on screen is as centred as it gets.
        const centred =
          scrollY === 0 ? box.top >= 0 && box.bottom <= innerHeight : Math.abs(box.top + box.height / 2 - innerHeight / 2) < 80;
        return centred && thread.getAnimations().some((animation) => animation.id === 'focus-diff-flash');
      }, text);

    await expect(comments).toHaveAccessibleName('Conversations, 4 conversations');
    // Opening lands on the first conversation.
    await comments.click();
    const popover = pr.panel.getByRole('dialog', { name: 'Conversations' });
    await expect(pr.status).toHaveText('Conversation 1 of 4, in web/src/book-card.tsx.');
    await expect.poll(() => centred('missing cover')).toBe(true);
    await expect(popover).toContainText('book-card.tsx:12');
    await expect(popover).toContainText('Waiting on you1/4');
    // The card stays within the panel, even with its button near the panel's edge.
    const [card, bar] = await Promise.all([popover.boundingBox(), pr.panel.locator('.panel').boundingBox()]);
    expect(card!.x).toBeGreaterThanOrEqual(bar!.x - 0.5);
    expect(card!.x + card!.width).toBeLessThanOrEqual(bar!.x + bar!.width + 0.5);
    await expect(comments).toHaveAccessibleName('Conversations, 4 conversations');
    await next.click();
    await expect(pr.status).toHaveText('Conversation 2 of 4, in api/books/service.py.');
    // The resolved thread was collapsed; it opens so it can be read.
    await expect.poll(() => centred('Typo')).toBe(true);
    await expect(pr.page.getByText('Typo in the docstring.')).toBeVisible();
    await expect(popover).toContainText('Resolved2/4');
    await next.click();
    await expect(popover).toContainText('service.py:40');
    await expect(popover).toContainText('Answered3/4');
    await next.click();
    // A reaction to the last comment counts as an answer.
    await expect(popover).toContainText('Answered4/4');
    await previous.click();
    await previous.click();
    await expect(pr.status).toHaveText('Conversation 2 of 4, in api/books/service.py.');
    await expect(popover).toBeVisible();
    await pr.page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(comments).toBeFocused();

    await pr.pick('Backend');
    await expect(comments).toHaveAccessibleName('Conversations, 2 conversations');
    await pr.pick('Frontend');
    await pr.pick('Docs', { combine: true });
    await expect(comments).toHaveAccessibleName('Conversations, 2 conversations');
    await pr.pick('All');
  });

  test('keeps the conversations button, disabled, for files without any', async ({ openPullRequest, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ ...DEFAULT_CONFIG, global: [{ id: 'tests', name: 'Tests', include: '\\.test\\.', exclude: '' }] });
    await pr.pick('Tests');
    const comments = pr.panel.locator('.comments');
    await expect(comments).toHaveAttribute('aria-disabled', 'true');
    await expect(comments).toHaveAccessibleName('Conversations, No conversations in these files yet');
    // The disabled reason takes the place of the button's name in its tooltip.
    await comments.hover();
    await expect(pr.panel.locator('.tip')).toHaveText('No conversations in these files yet');
    await comments.click({ force: true });
    await expect(pr.panel.getByRole('dialog', { name: 'Conversations' })).toBeHidden();
    await pr.pick('All');
    await expect(comments).toHaveAttribute('aria-disabled', 'false');
  });

  test('names its icon buttons in a tooltip on hover and keyboard focus', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const tip = pr.panel.locator('.tip');
    await pr.breakdownToggle.hover();
    await expect(tip).toHaveText('Breakdown by filter');
    await pr.settings.hover();
    await expect(tip).toHaveText('Focus Diff settings');
    await pr.panel.locator('.comments').hover();
    await expect(tip).toHaveText('Conversations');
    await pr.page.mouse.move(0, 0);
    await expect(tip).toBeHidden();
    await pr.settings.focus();
    await pr.page.keyboard.press('Shift+Tab');
    await expect(tip).toBeVisible();
    await pr.page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
  });

  test('offers a single button for a single conversation', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Docs');
    await pr.panel.getByRole('button', { name: /^Conversations,/ }).click();
    const card = pr.panel.getByRole('dialog', { name: 'Conversations' });
    await expect(card).toContainText('books.md:7');
    await expect(card.getByRole('button', { name: 'Go to the conversation' })).toBeVisible();
    await expect(card.getByRole('button', { name: /(Next|Previous) conversation/ })).toHaveCount(0);
    await expect(card.locator('.conversation-position')).toBeHidden();
  });

  test('moves between filters with the keyboard', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.option('All').focus();
    await pr.page.keyboard.press('ArrowRight');
    await expect(pr.option('Frontend')).toBeFocused();
    await expect(pr.pressed).toHaveText(['All']);
    await pr.page.keyboard.press('Enter');
    await expect(pr.pressed).toHaveText(['Frontend']);
    await pr.page.keyboard.press('End');
    await expect(pr.option('Docs')).toBeFocused();
    await pr.page.keyboard.press('Space');
    await expect(pr.pressed).toHaveText(['Frontend', 'Docs']);
    await pr.page.keyboard.press('Home');
    await pr.page.keyboard.press('Enter');
    await expect(pr.pressed).toHaveText(['All']);
  });

  test('follows the keyboard shortcuts', async ({ openPullRequest, background, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    // A filter with nothing here is stepped over.
    await seed({ ...DEFAULT_CONFIG, global: [...DEFAULT_CONFIG.global, { id: 'rust', name: 'Rust', include: '\\.rs$', exclude: '' }] });
    await expect(pr.option('Rust')).toBeVisible();
    const send = (command: string) =>
      background.evaluate(async (name) => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'command', command: name });
      }, command);
    await send('next-filter');
    await expect(pr.pressed).toHaveText(['Frontend']);
    await send('previous-filter');
    await send('previous-filter');
    await expect(pr.pressed).toHaveText(['Docs']);
    await send('show-all');
    await expect(pr.pressed).toHaveText(['All']);
  });

  for (const [size, url] of [
    ['small', PULL_REQUEST],
    ['large', LARGE_PULL_REQUEST],
  ] as const) {
    test(`keeps every part of the bar the same width when switching filters, in a ${size} pull request`, async ({ openPullRequest }) => {
      const pr = new PullRequestPage(await openPullRequest(url));
      // Docs' only file is viewed, so switching to it swaps the clock for the Done badge too.
      await pr.page.locator('[data-diff-header-wrapper]', { hasText: 'docs/books.md' }).getByRole('button', { name: 'Viewed' }).click();
      const widths = () =>
        pr.panel.evaluate((host) =>
          ['.panel', '.next-file', '.option-count', '.stats', '.files', '.lines', '.time-wrap', '.scoreboard', '.cell']
            .flatMap((selector) => [...host.shadowRoot!.querySelectorAll(selector)])
            .map((element) => element.getBoundingClientRect().width.toFixed(2))
            .join(' '),
        );
      const first = await widths();
      for (const name of ['Frontend', 'Docs', 'Backend', 'All']) {
        await pr.pick(name);
        await expect(pr.pressed).toHaveText([name]);
        expect(await widths(), `after picking ${name}`).toBe(first);
      }
      await pr.pick('Docs');
      await expect.poll(() => pr.statsText()).toMatch(/Done$/);
      expect(await widths()).toBe(first);
    });
  }

  test('shows the numbers on scoreboards, and reads them out as text', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(LARGE_PULL_REQUEST));
    await pr.pick('Docs');
    const cells = (name: string) =>
      pr.panel.evaluate((host, selector) => {
        const board = host.shadowRoot!.querySelector(selector)!;
        return { hidden: board.getAttribute('aria-hidden'), cells: [...board.children].map((cell) => cell.textContent) };
      }, `.scoreboard.${name}`);
    // The cells are those of the widest number, the unused ones blank; the separators stay where they are.
    await expect.poll(() => cells('files-count')).toEqual({ hidden: 'true', cells: ['1', '/', '8'] });
    expect(await cells('additions')).toEqual({ hidden: 'true', cells: ['', '', '', '', '', '+', '5'] });
    expect(await cells('time')).toEqual({ hidden: 'true', cells: ['', '0', ':', '0', '1'] });
    await expect(pr.panel.locator('.clock svg')).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => pr.statsText()).toBe('1/8 files +5 lines added, −0 lines removed <1 min left to review');
  });

  test('survives GitHub replacing the page body', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Docs');
    await expect.poll(() => pr.visiblePaths()).toEqual(['docs/books.md']);
    await pr.page.evaluate(() => {
      const fresh = document.body.cloneNode(true) as HTMLElement;
      fresh.querySelectorAll('[style]').forEach((element) => element.removeAttribute('style'));
      document.body.replaceWith(fresh);
    });
    await expect(pr.panel).toBeVisible();
    await expect.poll(() => pr.visiblePaths()).toEqual(['docs/books.md']);
  });

  test('opens the settings for the current repository', async ({ openPullRequest, context }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const [settings] = await Promise.all([context.waitForEvent('page'), pr.settings.click()]);
    await expect(settings).toHaveURL(/\/options\.html#repo=octo%2Fweb$/);
    await expect(settings.locator('#try-repo')).toHaveValue('octo/web');
    // Opening it again, from another repository, reuses the tab.
    await pr.page.evaluate(() => history.pushState(null, '', '/octo/api/pull/1/files'));
    const pages = context.pages().length;
    await pr.settings.click();
    await expect(settings).toHaveURL(/\/options\.html#repo=octo%2Fapi$/);
    await expect(settings.locator('#try-repo')).toHaveValue('octo/api');
    expect(context.pages()).toHaveLength(pages);
  });

  test('sends people without filters to the examples', async ({ openPullRequest, seed, context }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ global: [], repos: [] });
    await expect(pr.options).toHaveText(['All']);
    await expect(pr.settings).toHaveText('Set up filters');
    const [welcome] = await Promise.all([context.waitForEvent('page'), pr.settings.click()]);
    await expect(welcome).toHaveURL(/\/welcome\.html$/);
  });

  test("points to what's new after an update until it's read or dismissed", async ({ openPullRequest, background, context }) => {
    await context.route('https://github.com/hyanmandian/focus-diff/releases/**', (route) => route.fulfill({ body: 'Notes' }));
    const pr = new PullRequestPage(await openPullRequest());
    const notice = pr.panel.getByRole('link', { name: 'New in 1.1' });
    await expect(notice).toBeHidden();
    await background.evaluate(() => chrome.storage.local.set({ update: '1.1.0' }));
    await expect(notice).toHaveAttribute('href', 'https://github.com/hyanmandian/focus-diff/releases/tag/v1.1.0');
    const [notes] = await Promise.all([context.waitForEvent('page'), notice.click()]);
    await expect(notes).toHaveURL(/\/releases\/tag\/v1\.1\.0$/);
    await expect(notice).toBeHidden();
    expect(await background.evaluate(async () => (await chrome.storage.local.get('update')).update ?? null)).toBeNull();
    await background.evaluate(() => chrome.storage.local.set({ update: '2.0.0' }));
    await pr.panel.getByRole('button', { name: "Dismiss what's new" }).click();
    await expect(pr.panel.getByRole('link', { name: 'New in 2.0' })).toBeHidden();
  });

  // GitHub's own colour tokens (Primer), which the panel picks up, so contrast is checked against the real themes.
  const PRIMER = {
    light: {
      fg: '#1f2328',
      muted: '#59636e',
      overlay: '#ffffff',
      accent: '#0969da',
      emphasis: '#0969da',
      success: '#1a7f37',
      danger: '#d1242f',
      attention: '#9a6700',
      neutral: '#818b981f',
      border: '#d1d9e0',
    },
    dark: {
      fg: '#f0f6fc',
      muted: '#9198a1',
      overlay: '#010409',
      accent: '#4493f8',
      emphasis: '#1f6feb',
      success: '#3fb950',
      danger: '#f85149',
      attention: '#d29922',
      neutral: '#656c7633',
      border: '#3d444d',
    },
  };
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations in the ${colorScheme} theme`, async ({ openPullRequest, background }) => {
      const page = await openPullRequest();
      await background.evaluate(() => chrome.storage.local.set({ update: '1.1.0' }));
      await page.emulateMedia({ colorScheme });
      const c = PRIMER[colorScheme];
      await page.addStyleTag({
        content: `:root { --fgColor-default: ${c.fg}; --fgColor-muted: ${c.muted}; --overlay-bgColor: ${c.overlay}; --fgColor-accent: ${c.accent}; --bgColor-accent-emphasis: ${c.emphasis}; --fgColor-success: ${c.success}; --fgColor-danger: ${c.danger}; --fgColor-attention: ${c.attention}; --bgColor-neutral-muted: ${c.neutral}; --borderColor-default: ${c.border}; } body { background: ${c.overlay}; color: ${c.fg}; }`,
      });
      const pr = new PullRequestPage(page);
      await pr.pick('Frontend');
      await expect(pr.pressed).toHaveText(['Frontend']);
      await expect(pr.panel.getByRole('link', { name: 'New in 1.1' })).toBeVisible();
      expect(await accessibilityViolations(page, 'focus-diff-panel')).toEqual([]);
      await pr.breakdownToggle.click();
      expect(await accessibilityViolations(page, 'focus-diff-panel')).toEqual([]);
      await pr.panel.getByRole('button', { name: /^Conversations,/ }).click();
      await expect(pr.panel.getByRole('dialog', { name: 'Conversations' })).toBeVisible();
      expect(await accessibilityViolations(page, 'focus-diff-panel')).toEqual([]);
    });
  }

  test('stays hidden outside pull request diffs', async ({ openPullRequest }) => {
    const page = await openPullRequest(PULL_REQUEST.replace('/changes', ''));
    await expect(page.locator('focus-diff-panel')).toBeHidden();
  });

  test('removes itself when the extension is reloaded and the tab is not', async ({ openPullRequest, background }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await expect(pr.panel).toBeVisible();
    await background.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await pr.page.evaluate(() => document.body.append(document.createElement('div')));
    await expect(pr.panel).toHaveCount(0);
  });

  test('puts every file back when the extension is reloaded mid-filter', async ({ openPullRequest, background }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Frontend');
    await expect.poll(() => pr.visiblePaths()).toEqual(['web/src/book-card.tsx']);
    await background.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await pr.page.evaluate(() => document.body.append(document.createElement('div')));
    await expect(pr.panel).toHaveCount(0);
    await expect.poll(() => pr.visiblePaths()).toHaveLength(8);
    await expect(pr.filesCounter()).toHaveText('8');
  });

  test('leaves GitHub its own counters to update', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Frontend');
    await expect(pr.filesCounter()).toHaveText('1/8');
    await pr.page.evaluate(() => (document.querySelector('[aria-current="page"] .Counter')!.textContent = '9'));
    await pr.pick('All');
    await expect(pr.filesCounter()).toHaveText('9');
  });

  test('counts files GitHub has not rendered yet', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.evaluate(() => (document.querySelector('[aria-current="page"] .Counter')!.textContent = '12'));
    await pr.pick('Frontend');
    await expect(pr.filesCounter()).toHaveText('1/12');
    await pr.pick('All');
    await expect.poll(() => pr.statsText()).toMatch(/12\/12 files/);
    await expect(pr.stats).toHaveAttribute('data-tip', /not loaded yet/);
    // Files not loaded yet might match the filter too, so it can't be done.
    await pr.pick('Docs');
    await pr.page.locator('[data-diff-header-wrapper]', { hasText: 'docs/books.md' }).getByRole('button', { name: 'Viewed' }).click();
    await expect.poll(() => pr.statsText()).toMatch(/^1\/12 files.*left to review$/);
    await expect(pr.stats).toHaveAttribute('data-tip', /not loaded yet/);
  });

  test('hides collapsed folders that hold no matching files', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.evaluate(() => {
      const docs = [...document.querySelectorAll('[role="treeitem"][aria-expanded]')].find(
        (item) => item.firstElementChild?.textContent === 'docs',
      )!;
      docs.setAttribute('aria-expanded', 'false');
      docs.querySelector('[role="group"]')!.remove();
    });
    const docsFolder = pr.page.locator('[role="treeitem"][aria-expanded="false"]');
    await pr.pick('Frontend');
    await expect(docsFolder).toBeHidden();
    await pr.pick('Docs');
    await expect(docsFolder).toBeVisible();
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

test.describe('in Brazilian Portuguese', () => {
  test.use({ locale: 'pt-BR' });
  test.skip(!CAN_SWITCH_LANGUAGE, 'Chrome ignores --lang on macOS');

  test('speaks the browser language', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await expect(pr.options.first()).toHaveText('Todos');
    await expect.poll(() => pr.statsText()).toMatch(/8\/8 arquivos/);
  });
});
