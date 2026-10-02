import { expect, test, VIRTUALIZED_PULL_REQUEST } from './fixtures';
import { PullRequestPage } from './pages/pull-request';

/** GitHub's newer diff view: the page embeds every file as JSON and only renders the files near the screen. */
test.describe('newer, virtualized diff view', () => {
  const regionTop = (pr: PullRequestPage, path: string) =>
    pr.page.evaluate((target) => {
      const heading = [...document.querySelectorAll('h3')].find((element) => element.textContent?.includes(target));
      return heading ? Math.round(heading.closest('[role="region"]')!.getBoundingClientRect().top) : null;
    }, path);

  test('counts every file from the embedded data, not only the rendered ones', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    expect(await pr.page.locator('[role="region"]').count()).toBeLessThan(8);
    await expect.poll(() => pr.statsText()).toMatch(/^8\/8 files/);
    await expect(pr.panel.locator('.pending')).not.toHaveClass(/active/);
    await expect(pr.panel.locator('.option-count')).toHaveText(['8', '1', '3', '1']);
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

  test('opens unrendered files to reach the next unviewed one', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    await pr.pick('Backend');
    const next = pr.panel.locator('.next-unviewed');
    await next.click();
    await expect(pr.status).toHaveText('api/books/service.py, 3 unviewed left.');
    await expect.poll(() => regionTop(pr, 'api/books/service.py')).toBeLessThan(120);
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
    await expect(pr.panel.locator('.comments')).toHaveAccessibleName('4 conversations');
    await next.click();
    await expect(pr.status).toHaveText('Conversation 1 of 4, in web/src/book-card.tsx.');
    await next.click();
    await next.click();
    await expect(pr.status).toHaveText('Conversation 3 of 4, in api/books/service.py.');
    const marker = pr.page.locator('[class*="CommentIndicator"][data-line="R40"]');
    await expect(marker).toBeInViewport();
    await expect(marker).toHaveCSS('outline-style', 'solid');
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});
