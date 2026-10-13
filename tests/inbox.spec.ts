import type { BrowserContext } from '@playwright/test';
import { accessibilityViolations, expect, expectSoundPage, PAGE_VIEWS, test } from './fixtures';
import { allowNotifications, dashboard, routeGitHubRest } from './github';

const pull = (number: number, extra: Record<string, unknown> = {}) => ({
  itemType: 'pull_request',
  author: { displayLogin: 'ada' },
  commentCount: 2,
  isDraft: false,
  number,
  permalink: `https://github.com/octo/web/pull/${number}`,
  title: `Pull request ${number}`,
  updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
  ...extra,
});

/** GitHub's dashboard lists, as the background reads them with the reader's session. */
const routeGitHub = async (context: BrowserContext, { signedIn = true } = {}) => {
  await context.route(/^https:\/\/github\.com\/pulls\/(reviews|authored)$/, (route) => {
    if (!signedIn) return route.fulfill({ status: 302, headers: { location: 'https://github.com/login?return_to=%2Fpulls' } });
    const reviews = route.request().url().endsWith('/reviews');
    return route.fulfill({
      contentType: 'application/json',
      body: reviews
        ? dashboard([
            pull(12, { title: 'Cache the book covers', isReadByCurrentUser: false }),
            pull(13, { isDraft: true, title: 'Try a new reader' }),
          ])
        : dashboard([
            pull(20, { title: 'Sort books by rating', author: { displayLogin: 'me-too' } }),
            pull(21, {
              title: 'Return 404 for unknown authors',
              author: { displayLogin: 'me-too' },
              permalink: 'https://github.com/octo/api/pull/21',
            }),
          ]),
    });
  });
  await routeGitHubRest(context);
};

test.describe('popup', () => {
  test('lists the review queue and the reader’s own pull requests, each opening where it should', async ({
    context,
    openExtensionPage,
  }) => {
    await routeGitHub(context);
    const page = await openExtensionPage('popup.html');
    const reviews = page.getByRole('tabpanel', { name: /Review queue/ });
    // By repository, what changed since the reader last looked first. Drafts aren't ready for review: they wait folded
    // at the end, and nothing counts them, so the tab says what the icon does.
    // One repository needs no heading, nor chips to narrow it.
    await expect(reviews.getByRole('heading')).toHaveCount(0);
    const web = reviews.getByRole('list').first().getByRole('link');
    await expect(web).toHaveCount(1);
    const fresh = web.first();
    await expect(fresh).toHaveAccessibleName(/^Cache the book covers\s*#12\s*ada\s*New activity\s*3h ago\s*2 comments$/);
    await expect(fresh).toHaveAttribute('href', 'https://github.com/octo/web/pull/12/changes');
    const draft = reviews.getByRole('link', { name: /^Try a new reader/ });
    await expect(draft).toBeHidden();
    await reviews.getByText('Drafts', { exact: true }).click();
    await expect(draft).toHaveAccessibleName(/^Try a new reader\s*#13\s*ada\s*3h ago/);
    await expect(reviews.getByRole('group', { name: 'Repositories' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Review queue 1' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#updated')).toHaveText('Updated now');

    // Up and down move between the pull requests.
    await fresh.focus();
    await page.keyboard.press('ArrowDown');
    await expect(draft).toBeFocused();

    // The tabs take the arrow keys.
    await page.getByRole('tab', { name: /Review queue/ }).focus();
    await page.keyboard.press('ArrowRight');
    const mine = page.getByRole('tabpanel', { name: /My PRs/ });
    await expect(page.getByRole('tab', { name: 'My PRs 2' })).toBeFocused();
    await expect(mine.getByRole('link', { name: /Sort books by rating/ })).toHaveAttribute('href', 'https://github.com/octo/web/pull/20');
    await expect(mine.getByRole('link', { name: /See them on GitHub/ })).toHaveAttribute('href', 'https://github.com/pulls');
    await expect(mine.getByRole('heading')).toHaveText([/octo\/web\s*1/, /octo\/api\s*1/]);

    // With more than one repository, chips narrow the list to one.
    const repos = mine.getByRole('group', { name: 'Repositories' });
    await expect(repos.getByRole('button')).toHaveText([/All\s*2/, /web\s*1/, /api\s*1/]);
    await repos.getByRole('button', { name: /api/ }).click();
    await expect(repos.getByRole('button', { name: /api/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(mine.getByRole('link', { name: /#\d+/ })).toHaveAccessibleName(/^Return 404 for unknown authors/);
    // Narrowed to one, the chip says which; the heading goes.
    await expect(mine.getByRole('heading')).toHaveCount(0);
    await expect(reviews).toBeHidden();
  });

  test('marks pull requests done until something new happens, with a way back', async ({ context, openExtensionPage, background }) => {
    await routeGitHub(context);
    const page = await openExtensionPage('popup.html');
    const reviews = page.getByRole('tabpanel', { name: /Review queue/ });
    const cache = reviews.getByRole('link', { name: /^Cache the book covers/ });

    // A row is picked with `x`, or its checkbox, and the footer offers to mark it done.
    await cache.focus();
    await page.keyboard.press('x');
    await expect(reviews.getByRole('checkbox', { name: 'Select “Cache the book covers”' })).toBeChecked();
    await expect(page.locator('#selection-text')).toHaveText('1 selected');
    await page.getByRole('button', { name: 'Mark as done' }).click();
    await expect(cache).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Review queue 0' })).toBeVisible();
    await expect(page.locator('#selection-text')).toHaveText('1 marked as done');
    const marks = () => background.evaluate(async () => (await chrome.storage.sync.get('inboxDone')).inboxDone ?? {});
    expect(Object.keys(await marks())).toEqual(['https://github.com/octo/web/pull/12']);

    // Undo takes it back at once.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(cache).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Review queue 1' })).toBeVisible();

    // Done again, it waits folded at the end, with a way back.
    await cache.focus();
    await page.keyboard.press('x');
    await page.getByRole('button', { name: 'Mark as done' }).click();
    await reviews.getByText('Done', { exact: true }).click();
    expect(await accessibilityViolations(page)).toEqual([]);
    await reviews.getByRole('button', { name: 'Not done: “Cache the book covers”' }).click();
    await expect(cache).toBeVisible();
    expect(await marks()).toEqual({});
  });

  test('opens a pull request behind the popup, which stays open', async ({ context, openExtensionPage, background }) => {
    await routeGitHub(context);
    await context.route('https://github.com/octo/web/pull/12/changes', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>#12</title>' }),
    );
    const page = await openExtensionPage('popup.html');
    const popupUrl = page.url();
    type Tab = { id: number; active: boolean };
    const tabs = (): Promise<Tab[]> =>
      background.evaluate(async () => (await chrome.tabs.query({})).map((tab: Tab) => ({ id: tab.id, active: tab.active })));
    const before = new Set((await tabs()).map((tab) => tab.id));
    await page.getByRole('link', { name: /^Cache the book covers/ }).click();
    // One new tab, behind; the test's driver can be slow to catch up with where it went, so its address is checked after.
    await expect.poll(async () => (await tabs()).filter((tab) => !before.has(tab.id))).toEqual([{ id: expect.any(Number), active: false }]);
    await expect
      .poll(() => context.pages().map((each) => each.url()), { timeout: 15_000 })
      .toContain('https://github.com/octo/web/pull/12/changes');
    expect(page.url()).toBe(popupUrl);
  });

  test('says when the reader is signed out of GitHub', async ({ context, openExtensionPage }) => {
    await routeGitHub(context, { signedIn: false });
    const page = await openExtensionPage('popup.html');
    await expect(page.locator('#problem')).toContainText('Sign in to GitHub in this browser');
    await expect(page.getByRole('link', { name: 'Sign in to GitHub' })).toHaveAttribute('href', 'https://github.com/login');
  });

  for (const view of PAGE_VIEWS) {
    test(`has no accessibility violations, ${view[0]}`, async ({ context, openExtensionPage }) => {
      await routeGitHub(context);
      const page = await openExtensionPage('popup.html');
      await expectSoundPage(page, view, page.locator('.pull'));
    });
  }
});

test.describe('popup settings', () => {
  test('lists only the repositories picked, and counts only those on the icon', async ({ context, openExtensionPage, background }) => {
    await routeGitHub(context);
    const page = await openExtensionPage('options.html#popup');
    const only = page.getByRole('combobox', { name: 'Only from' });
    await only.fill('octo/api');
    await only.press('Enter');
    // A wrong path holds the save, at its field.
    const never = page.getByRole('combobox', { name: 'Never from' });
    await never.fill('octo');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Check the review queue’s repositories');
    await expect(never).toBeFocused();
    await never.fill('');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Saved.');
    expect(await background.evaluate(async () => (await chrome.storage.sync.get('popup')).popup)).toEqual({
      repos: ['octo/api'],
      excludeRepos: [],
    });
    expect(await accessibilityViolations(page, '#popup')).toEqual([]);

    const popup = await openExtensionPage('popup.html');
    await expect(popup.getByRole('tab', { name: 'My PRs 1' })).toBeVisible();
    await expect(popup.getByRole('tab', { name: 'Review queue 0' })).toBeVisible();
  });
});

test.describe('notification settings', () => {
  const stored = (background: import('@playwright/test').Worker) =>
    background.evaluate(async () => (await chrome.storage.sync.get('notifications')).notifications);

  test('turning them on shows what to be told about, which saves with the rest', async ({ context, openExtensionPage, background }) => {
    await routeGitHub(context);
    const page = await openExtensionPage('options.html#notifications');
    await allowNotifications(page);
    await page.reload();
    const notifyMe = page.getByRole('switch', { name: 'Notify me' });
    await expect(notifyMe).not.toBeChecked();
    await expect(page.getByRole('group', { name: 'Pull requests I review' })).toBeHidden();

    await notifyMe.click();
    const reviewing = page.getByRole('group', { name: 'Pull requests I review' });
    const mine = page.getByRole('group', { name: 'My pull requests' });
    await expect(reviewing.getByRole('switch', { name: 'Someone asks for my review' })).toBeChecked();
    const asks = reviewing.getByRole('group', { name: 'Exceptions to “Someone asks for my review”' });
    await expect(asks.getByRole('button', { name: 'drafts' })).toHaveAttribute('aria-pressed', 'true');
    await expect(mine.getByRole('switch', { name: 'Someone comments on my pull request' })).toBeChecked();
    expect(await accessibilityViolations(page, '#notifications')).toEqual([]);

    // Comments on pull requests I review, skipping drafts too, in a repository of its own.
    const comments = reviewing.getByRole('switch', { name: 'Someone comments on a pull request I review' });
    await expect(comments).not.toBeChecked();
    await comments.click();
    const except = page.getByRole('group', { name: 'Exceptions to “Someone comments on a pull request I review”' });
    await expect(except.getByRole('button')).toHaveCount(3);
    await expect(except.getByRole('button', { name: 'bots' })).toHaveAttribute('aria-pressed', 'true');
    await except.getByRole('button', { name: 'drafts' }).click();
    await reviewing.getByRole('button', { name: 'Repositories: the ones above' }).nth(2).click();
    const own = page.getByRole('combobox', { name: 'Repositories for “Someone comments on a pull request I review”' });
    await expect(own).toBeFocused();
    await own.fill('octo/web');
    await own.press('Enter');
    await expect(reviewing.getByRole('button', { name: 'Only in 1 repository' })).toBeVisible();

    // The general repositories, and one never: a wrong path holds the save, at its field.
    const only = page.getByRole('combobox', { name: 'Only in' });
    await only.fill('octo');
    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Check the notification repositories');
    await expect(page.locator('#notify-repos-error')).toHaveText(
      '“octo” isn’t a repository path. Use owner/name, or owner/* for all of an owner’s.',
    );
    await expect(only).toBeFocused();
    await only.fill('octo/*');
    await only.press('Enter');
    await expect(page.getByRole('button', { name: 'Remove octo/*' })).toBeVisible();
    const never = page.getByRole('combobox', { name: 'Never in' });
    await never.fill('octo/legacy');
    await never.press('Enter');

    // How often, when to keep quiet, and how they show.
    await page.getByLabel('Check every').selectOption('5');
    await page.getByRole('switch', { name: 'Quiet hours' }).click();
    await expect(page.locator('#notifications').getByLabel('From')).toHaveValue('19:00');
    await page.getByRole('switch', { name: 'Sum several up in one notification' }).click();
    expect(await accessibilityViolations(page, '#notifications')).toEqual([]);

    await page.locator('#save').click();
    await expect(page.locator('#status')).toContainText('Saved.');
    const settings = await stored(background);
    expect(settings).toMatchObject({
      enabled: true,
      repos: ['octo/*'],
      excludeRepos: ['octo/legacy'],
      interval: 5,
      quiet: { on: true, from: '19:00', to: '09:00', weekends: true },
      delivery: { grouped: true, sticky: false, sound: { id: 'chime', volume: 60 } },
    });
    expect(settings.events['comment-reviewing']).toEqual({ on: true, except: ['bots', 'drafts'], repos: ['octo/web'], when: 'now' });
    await expect.poll(() => background.evaluate(async () => (await chrome.alarms.get('inbox'))?.periodInMinutes)).toBe(5);

    // On, the icon counts what's waiting for review, leaving drafts out.
    await expect.poll(() => background.evaluate(() => chrome.action.getBadgeText({}))).toBe('1');
  });

  test('stays off when the browser doesn’t allow notifications', async ({ openExtensionPage }) => {
    const page = await openExtensionPage('options.html');
    await page.addInitScript(() => {
      chrome.permissions.request = async () => false;
    });
    await page.reload();
    await page.getByRole('switch', { name: 'Notify me' }).click();
    await expect(page.getByRole('switch', { name: 'Notify me' })).not.toBeChecked();
    await expect(page.locator('#status')).toContainText('didn’t allow notifications');
  });
});
