import { describe, expect, it } from 'vitest';
import { InboxError, parseDetail, parseFiles, parseLogin, parseNotifications, parsePulls } from './inbox';

const dashboard = (results: unknown[]) => ({ payload: { pullsDashboardSurfaceContentRoute: { results, pageInfo: {}, error: null } } });
const pull = {
  itemType: 'pull_request',
  author: { displayLogin: 'ada' },
  commentCount: 3,
  isDraft: false,
  number: 12,
  permalink: 'https://github.com/octo/web/pull/12',
  repoNameWithOwner: 'octo/web',
  title: 'Cache the book covers',
  createdAt: '2026-10-07T09:00:00Z',
  updatedAt: '2026-10-08T12:00:00Z',
  isReadByCurrentUser: false,
  headSha: '311897b5',
};

/** A notifications inbox item as GitHub draws it, trimmed to what's read. */
const notification = ({
  id = 'NT_1',
  href = 'https://github.com/octo/web/pull/12#issuecomment-34',
  reason = 'author',
  type = 'IssueComment',
} = {}) => {
  const hydro = JSON.stringify({ payload: { comment_type: type, metadata: { reason, last_updated_at: '2026-10-09T03:02:24Z' } } });
  return `<li class="notifications-list-item js-notifications-list-item notification-unread" data-notification-id="${id}">
    <a class="d-flex notification-list-item-link" href="${href.replace('#', '?notification_referrer_id=NT_1#')}"
      data-hydro-click="${hydro.replaceAll('"', '&quot;')}">
      <p class="m-0 f6">octo/web <span>#12</span></p>
      <p class="m-0 text-normal markdown-title"> Cache the <code>book</code> covers &amp; more </p>
    </a>
    <relative-time datetime="2026-10-09T03:02:24Z">Oct 9</relative-time>
  </li>`;
};

describe('parsePulls', () => {
  it('reads a dashboard list', () => {
    expect(parsePulls(dashboard([pull]))).toEqual([
      {
        repo: 'octo/web',
        number: 12,
        title: 'Cache the book covers',
        url: 'https://github.com/octo/web/pull/12',
        author: 'ada',
        draft: false,
        comments: 3,
        createdAt: '2026-10-07T09:00:00Z',
        updatedAt: '2026-10-08T12:00:00Z',
        unread: true,
        headSha: '311897b5',
      },
    ]);
  });

  it('leaves out anything that is not a pull request', () => {
    expect(
      parsePulls(
        dashboard([
          { ...pull, itemType: 'issue' },
          { ...pull, permalink: 'https://github.com/octo/web/issues/1' },
        ]),
      ),
    ).toEqual([]);
  });

  it('says so when the data no longer reads as a list', () => {
    expect(() => parsePulls({ payload: {} })).toThrow('unreadable');
    expect(() => parsePulls(null)).toThrow('unreadable');
  });
});

describe('parseNotifications', () => {
  it('reads each pull request thread as of its latest event', () => {
    const html = `<ul>${notification()}${notification({ id: 'NT_2', href: 'https://github.com/octo/api/pull/7#pullrequestreview-9', reason: 'review_requested', type: 'PullRequestReview' })}</ul>`;
    expect(parseNotifications(html)).toEqual([
      {
        thread: 'NT_1',
        repo: 'octo/web',
        number: 12,
        title: 'Cache the book covers & more',
        url: 'https://github.com/octo/web/pull/12?notification_referrer_id=NT_1#issuecomment-34',
        reason: 'author',
        kind: 'comment',
        anchor: 'issuecomment-34',
        updatedAt: '2026-10-09T03:02:24Z',
      },
      expect.objectContaining({
        thread: 'NT_2',
        repo: 'octo/api',
        number: 7,
        reason: 'review_requested',
        kind: 'review',
        anchor: 'pullrequestreview-9',
      }),
    ]);
  });

  it('leaves out issues, and events that are not comments or reviews read as other', () => {
    const html = `<ul>${notification({ href: 'https://github.com/octo/web/issues/3#issuecomment-1' })}${notification({ id: 'NT_3', type: 'IssueEventNotification' })}</ul>`;
    expect(parseNotifications(html)).toEqual([expect.objectContaining({ thread: 'NT_3', kind: 'other' })]);
  });
});

describe('parseDetail', () => {
  const page = `
    <div id="issuecomment-34"><strong><a class="author Link--primary" href="/apps/review-bot">review-bot</a>
      <span class="Label Label--secondary">Bot</span></strong> commented
      <a href="#issuecomment-34" id="issuecomment-34-permalink">Oct 9</a></div>
    <div id="pullrequestreview-9"><strong><a class="author Link--primary" data-hovercard-type="user" href="/grace">grace</a></strong>
      approved these changes <a href="#pullrequestreview-9" id="pullrequestreview-9-permalink">Oct 9</a></div>
    <div id="pullrequestreview-10"><strong><a class="author Link--primary" href="/linus">linus</a></strong>
      reviewed <a id="pullrequestreview-10-permalink">Oct 9</a></div>
    <span class="assignee">me-too</span>
    <a id="review-status-me-too" href="/octo/web/pull/12/changes"></a>
    <span>me-too approved these changes</span>`;

  it('reads who wrote a comment, and whether they are a bot', () => {
    expect(parseDetail(page, 'issuecomment-34', 'me-too')).toEqual({ actor: 'review-bot', bot: true, review: null, myReview: 'approved' });
  });

  it('reads what a review did', () => {
    expect(parseDetail(page, 'pullrequestreview-9', '')).toEqual({ actor: 'grace', bot: false, review: 'approved', myReview: null });
    expect(parseDetail(page, 'pullrequestreview-10', '')).toMatchObject({ actor: 'linus', review: 'commented' });
  });

  it('reads only the reader’s review without an event to look at', () => {
    expect(parseDetail(page, '', 'me-too')).toEqual({ actor: '', bot: false, review: null, myReview: 'approved' });
    expect(parseDetail(page.replace('approved these changes</span>', 'requested changes</span>'), '', 'me-too').myReview).toBe(
      'changes-requested',
    );
  });
});

describe('parseLogin', () => {
  it('reads the signed-in login, or nothing when signed out', () => {
    expect(parseLogin('<meta name="user-login" content="ada">')).toBe('ada');
    expect(parseLogin('<meta name="user-login" content="">')).toBe('');
  });
});

describe('parseFiles', () => {
  it('reads each changed file with its line counts and whether it was viewed', () => {
    const route = {
      diffSummaries: [
        { path: 'src/app.ts', linesAdded: 20, linesDeleted: 2, markedAsViewed: false },
        { path: 'yarn.lock', linesAdded: 400, linesDeleted: 380, markedAsViewed: true },
        { pathDigest: 'no-path' },
      ],
    };
    expect(parseFiles({ payload: { pullRequestsChangesRoute: route } })).toEqual([
      ['src/app.ts', 20, 2, false],
      ['yarn.lock', 400, 380, true],
    ]);
  });

  it('says so when the page no longer reads as expected', () => {
    expect(() => parseFiles({ payload: {} })).toThrow(InboxError);
  });
});
