import { expect, test, VIRTUALIZED_PULL_REQUEST } from './fixtures';
import { PullRequestPage } from './pages/pull-request';

/** GitHub's newer diff view: the page embeds every file as JSON and only renders the files near the screen. */
test.describe('newer, virtualized diff view', () => {
  test('counts every file from the embedded data, not only the rendered ones', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    expect(await pr.page.locator('[role="region"]').count()).toBeLessThan(8);
    await expect.poll(() => pr.statsText()).toMatch(/^8\/8 files/);
    await expect(pr.panel.locator('.pending')).not.toHaveClass(/active/);
    await expect(pr.panel.locator('.option .option-count')).toHaveText(['8', '1', '3', '1']);
    await pr.pick('Backend');
    await expect.poll(() => pr.statsText()).toMatch(/^3\/8 files\+25.*−10/);
  });

  test('dims files outside the filter instead of leaving gaps', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    await pr.pick('Backend');
    const frontend = pr.page.locator('[role="region"]', { hasText: 'web/src/book-card.tsx' }).locator('xpath=..');
    await expect(frontend).toHaveCSS('opacity', '0.35');
    await expect(frontend).toBeVisible();
  });

  test('takes viewed files from the embedded data and the toggles', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    await pr.breakdownToggle.click();
    await expect(pr.breakdownRows.first().locator('.row-viewed')).toHaveText('1/8');
    await expect(pr.breakdownRows.nth(3).locator('.row-viewed')).toHaveText('1/1');
    await pr.page.keyboard.press('Escape');
    await pr.page.locator('[role="region"]', { hasText: 'web/src/book-card.tsx' }).getByRole('button', { name: 'Not Viewed' }).click();
    await pr.breakdownToggle.click();
    await expect(pr.breakdownRows.first().locator('.row-viewed')).toHaveText('2/8');
  });

  test('reaches conversations in files GitHub has not rendered', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    const next = pr.panel.getByRole('button', { name: 'Next conversation' });
    const historyLength = await pr.page.evaluate(() => history.length);
    await expect(pr.panel.locator('.comments')).toHaveAccessibleName('Conversations, 4 conversations');
    await pr.panel.locator('.comments').click();
    await expect(pr.status).toHaveText('Conversation 1 of 4, in web/src/book-card.tsx.');
    await next.click();
    await expect(pr.status).toHaveText('Conversation 2 of 4, in api/books/service.py.');
    await next.click();
    await expect(pr.status).toHaveText('Conversation 3 of 4, in api/books/service.py.');
    const dialog = pr.panel.getByRole('dialog', { name: 'Conversations' });
    await expect(dialog).toContainText('service.py:40Answered3/4');
    const flashed = (element: Element) => element.getAnimations().some((animation) => animation.id === 'focus-diff-flash');
    const thread = pr.page.locator('[data-marker-id="103"]');
    await expect(thread).toBeInViewport();
    expect(await thread.evaluate(flashed)).toBe(true);
    expect(await pr.page.evaluate(() => history.length)).toBe(historyLength);
    // Without a comment link, the file opens and the thread's marker is centred.
    await next.click();
    await expect(dialog).toContainText('books.md:1Waiting on you4/4');
    const marker = pr.page.locator('[class*="CommentIndicator"][data-line="R1"]');
    await expect(marker).toBeInViewport();
    expect(await marker.evaluate(flashed)).toBe(true);
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});
