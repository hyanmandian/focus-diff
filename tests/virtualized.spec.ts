import type { Page } from '@playwright/test';
import { expect, test, VIRTUALIZED_PULL_REQUEST } from './fixtures';
import { PullRequestPage } from './pull-request-page';

/** GitHub's newer diff view: the page embeds every file as JSON and only renders the files near the screen. */
test.describe('newer, virtualized diff view', () => {
  test('counts every file from the embedded data, not only the rendered ones', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    expect(await pr.page.locator('[role="region"]').count()).toBeLessThan(8);
    // Eight files, one of them already viewed.
    await expect.poll(() => pr.statsText()).toMatch(/^7 files left to review/);
    await expect(pr.stats).not.toHaveAttribute('data-tip');
    await expect(pr.panel.locator('.option .option-count')).toHaveText(['8', '1', '3', '1']);
    await pr.pick('Backend');
    await expect.poll(() => pr.statsText()).toMatch(/^3 files left to review \+25.*−10/);
  });

  test('dims files outside the filter instead of leaving gaps', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    await pr.pick('Backend');
    // Picking scrolls to the first Backend file; the file before it is outside the filter.
    const stories = pr.page.locator('[role="region"]', { hasText: 'web/src/book-card.stories.tsx' }).locator('xpath=..');
    await expect(stories).toHaveCSS('opacity', '0.35');
    await expect(stories).toBeVisible();
  });

  test("lines a file picked in the tree up below GitHub's sticky bar", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    // Like GitHub, file headers stick below a 58px bar.
    await pr.page.addStyleTag({ content: '[data-diff-header-wrapper] { position: sticky; top: 58px; background: white; }' });
    // One GitHub hasn't drawn yet, then one it has.
    for (const path of ['web/src/book-card.stories.tsx', 'api/books/service.py']) {
      const name = path.slice(path.lastIndexOf('/') + 1);
      await pr.page.locator('[role="tree"] a', { hasText: new RegExp(`^${name.replaceAll('.', '\\.')}$`) }).click();
      const region = pr.page.locator('[role="region"]', { hasText: path });
      await expect.poll(() => region.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(58);
    }
    await expect(pr.page).toHaveURL(/#diff-/);
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
    // Centred, even though GitHub scrolls the comment to the top of the screen after it opens.
    await pr.page.waitForTimeout(600);
    const centre = await thread.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return Math.round(box.top + box.height / 2 - innerHeight / 2);
    });
    expect(Math.abs(centre)).toBeLessThan(40);
    expect(await thread.evaluate(flashed)).toBe(true);
    expect(await pr.page.evaluate(() => history.length)).toBe(historyLength);
    // Without a comment link, the file opens and the thread's marker is centred.
    await next.click();
    await expect(dialog).toContainText('books.md:1Waiting on you4/4');
    const marker = pr.page.locator('[class*="CommentIndicator"][data-line="R1"]');
    await expect(marker).toBeInViewport();
    expect(await marker.evaluate(flashed)).toBe(true);
  });

  test('lands on the last of several quick steps', async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    await pr.panel.locator('.comments').click();
    await expect(pr.status).toHaveText('Conversation 1 of 4, in web/src/book-card.tsx.');
    // Three steps in the same moment, before GitHub has drawn the first.
    await pr.panel.getByRole('button', { name: 'Next conversation' }).evaluate((next: HTMLElement) => {
      next.click();
      next.click();
      next.click();
    });
    await expect(pr.status).toHaveText('Conversation 4 of 4, in docs/books.md.');
    await expect(pr.page.locator('[class*="CommentIndicator"][data-line="R1"]')).toBeInViewport();
    await pr.page.waitForTimeout(1500);
    await expect(pr.status).toHaveText('Conversation 4 of 4, in docs/books.md.');
    await expect(pr.page.locator('[class*="CommentIndicator"][data-line="R1"]')).toBeInViewport();
  });

  /** The virtualized pull request, with its four conversations counted. */
  const withConversations = async (open: (url: string) => Promise<Page>) => {
    const pr = new PullRequestPage(await open(VIRTUALIZED_PULL_REQUEST));
    const comments = pr.panel.locator('.comments');
    await expect(comments).toHaveAccessibleName('Conversations, 4 conversations');
    return { pr, comments };
  };

  test('drops a conversation deleted after the page loaded', async ({ openPullRequest }) => {
    const { pr, comments } = await withConversations(openPullRequest);
    // Deleting its only comment takes the marker off the line; GitHub's embedded data still lists it.
    await pr.page.locator('[class*="CommentIndicator"][data-line="R12"]').evaluate((marker) => marker.remove());
    await expect(comments).toHaveAccessibleName('Conversations, 3 conversations');
  });

  test('picks up a conversation started after the page loaded', async ({ openPullRequest }) => {
    const { pr, comments } = await withConversations(openPullRequest);
    // GitHub draws the new conversation in the diff; its embedded data doesn't change.
    await pr.page.locator('[role="region"]', { hasText: 'web/src/book-card.tsx' }).evaluate((region) => {
      region.insertAdjacentHTML(
        'beforeend',
        `<table><tr><td data-line-number="5" data-diff-side="right"><div data-marker-id="999">
          <div id="r9990"><a data-hovercard-type="user" href="#">reviewer</a> Let's rename this.</div>
        </div></td></tr></table>`,
      );
    });
    await expect(comments).toHaveAccessibleName('Conversations, 5 conversations');
    await comments.click();
    await expect(pr.panel.getByRole('dialog', { name: 'Conversations' })).toContainText('book-card.tsx:5Answered1/5');
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});
