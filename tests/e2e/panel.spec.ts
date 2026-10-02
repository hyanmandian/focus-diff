import { accessibilityViolations, CAN_SWITCH_LANGUAGE, expect, PULL_REQUEST, test } from './fixtures';
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
    await expect(pr.status).toHaveText('Frontend: 1 of 8 files, 40 lines added, 10 removed. About ~7 min to review.');
    await expect.poll(() => pr.statsText()).toMatch(/~7 min/);

    await pr.pick('Backend');
    await expect.poll(() => pr.visiblePaths()).toEqual(['api/books/service.py', 'api/books/__init__.py', 'api/legacy/routes.py']);
    expect(await pr.visibleTreeFiles()).toEqual(['__init__.py', 'service.py', 'routes.py']);
    await expect(pr.filesCounter()).toHaveText('3/8');
    await expect(pr.lineCounters().additions).toHaveText('+120');
    await expect(pr.status).toContainText("haven't loaded yet");

    await pr.pick('All');
    await expect(pr.filesCounter()).toHaveText('8');
    await expect(pr.lineCounters().deletions).toHaveText('−30');
  });

  test('combines filters with shift-click', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick('Frontend');
    await pr.pick('Docs', { combine: true });
    await expect(pr.pressed).toHaveText(['Frontend', 'Docs']);
    await expect.poll(() => pr.visiblePaths()).toEqual(['web/src/book-card.tsx', 'docs/books.md']);
    await expect(pr.filesCounter()).toHaveText('2/8');
    await expect(pr.status).toContainText('Frontend + Docs: 2 of 8 files');

    await pr.pick('Frontend', { combine: true });
    await expect(pr.pressed).toHaveText(['Docs']);
    await pr.pick('Docs', { combine: true });
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
    await expect(pr.breakdownRows.first()).toHaveAccessibleName('All: 8 files, 120 lines added, 30 removed, ~23 min to review');
    await expect(pr.breakdownRows.nth(1)).toHaveAccessibleName('Frontend: 1 file, 40 lines added, 10 removed, ~7 min to review');
    await expect(pr.breakdownRows.nth(1).locator('.row-time')).toHaveText('~7 min');
    await expect(pr.breakdownRows.first().locator('.diffstat .add')).toHaveCount(4);
    await expect(pr.breakdownRows.first().locator('.diffstat .del')).toHaveCount(1);

    await pr.breakdownRows.nth(1).click();
    await expect(pr.pressed).toHaveText(['Frontend']);
    expect(await accessibilityViolations(pr.page, 'focus-diff-panel')).toEqual([]);

    await pr.page.keyboard.press('Escape');
    await expect(pr.panel.locator('.breakdown')).toBeHidden();
  });

  test('moves between filters with the keyboard', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.option('All').focus();
    await pr.page.keyboard.press('ArrowRight');
    await expect(pr.pressed).toHaveText(['Frontend']);
    await expect(pr.option('Frontend')).toBeFocused();
    await pr.page.keyboard.press('End');
    await expect(pr.pressed).toHaveText(['Docs']);
    await pr.page.keyboard.press('ArrowRight');
    await expect(pr.pressed).toHaveText(['All']);
  });

  test('follows the keyboard shortcuts', async ({ openPullRequest, background }) => {
    const pr = new PullRequestPage(await openPullRequest());
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

  test('keeps the panel the same width when switching filters', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const width = async () => Math.round((await pr.panel.locator('.panel').boundingBox())?.width ?? 0);
    const widths = [await width()];
    for (const name of ['Frontend', 'Docs', 'Backend', 'All']) {
      await pr.pick(name);
      await expect(pr.pressed).toHaveText([name]);
      widths.push(await width());
    }
    expect(new Set(widths).size, `widths changed: ${widths.join(', ')}`).toBe(1);
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
  });

  test('sends people without filters to the examples', async ({ openPullRequest, seed, context }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ global: [], repos: [] });
    await expect(pr.options).toHaveText(['All']);
    await expect(pr.settings).toHaveText('Set up filters');
    const [welcome] = await Promise.all([context.waitForEvent('page'), pr.settings.click()]);
    await expect(welcome).toHaveURL(/\/welcome\.html$/);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`has no accessibility violations in the ${colorScheme} theme`, async ({ openPullRequest }) => {
      const page = await openPullRequest();
      await page.emulateMedia({ colorScheme });
      const pr = new PullRequestPage(page);
      await pr.pick('Frontend');
      await expect(pr.pressed).toHaveText(['Frontend']);
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
    await expect(pr.panel.locator('.pending')).toHaveClass(/active/);
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
