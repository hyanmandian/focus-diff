/**
 * The reader's pull requests and their activity on GitHub, read with the session they're signed in with: the lists of
 * GitHub's pull requests dashboard, the notifications inbox, and a pull request's page for who did what. No token and no
 * API: these are GitHub's own pages, so the reading stays defensive and says so when a page no longer reads as expected.
 * It runs in the background service worker, which has no DOMParser, so the HTML is read with patterns.
 */

import type { PullFile } from '@/utils/review-time/sessions';

const ORIGIN = 'https://github.com';

/** A pull request on one of the reader's lists. */
export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string;
  draft: boolean;
  comments: number;
  createdAt: string;
  updatedAt: string;
  /** Changed since the reader last opened it. */
  unread: boolean;
  /** The latest commit, so its files are read again only after a push. */
  headSha: string;
  /**
   * Back on the review queue after leaving it: GitHub takes a pull request off once the reader reviews it, so it's back
   * because they were asked to review it again. Known from earlier looks, not from GitHub.
   */
  again?: boolean;
}

/** What the latest event on a notification thread was. */
type ActivityKind = 'comment' | 'review' | 'other';

/** A pull request's thread in the notifications inbox, as of its latest event. */
export interface Activity {
  thread: string;
  repo: string;
  number: number;
  title: string;
  /** Straight to the latest event, like `…/pull/12#issuecomment-34`. */
  url: string;
  /** Why the reader follows the thread: `author`, `review_requested`, `mention`, `assign`, and so on. */
  reason: string;
  kind: ActivityKind;
  /** The latest event's id on the pull request's page, like `issuecomment-34`, or empty. */
  anchor: string;
  updatedAt: string;
}

type ReviewState = 'approved' | 'changes-requested' | 'commented';

/** Who did the latest thing on a pull request, and where the reader's own review stands. */
export interface Detail {
  actor: string;
  bot: boolean;
  /** Set when the event is a review. */
  review: ReviewState | null;
  /** The reader's latest review on the pull request, or `null` when they haven't reviewed it. */
  myReview: ReviewState | null;
}

export type InboxProblem = 'signed-out' | 'unreadable' | 'offline';

export class InboxError extends Error {
  readonly problem: InboxProblem;
  constructor(problem: InboxProblem) {
    super(problem);
    this.problem = problem;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(point) ? String.fromCodePoint(point) : entity;
  });
const textOf = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const PULL_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/;

const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? (value as Record<string, unknown>) : {});

/** A dashboard list as GitHub sends it with `Accept: application/json`: its results, whatever route holds them. */
export const parsePulls = (data: unknown): PullRequest[] => {
  const routes = Object.values(record(record(data).payload));
  const results = routes.map((route) => record(route).results).find(Array.isArray);
  if (!results) throw new InboxError('unreadable');
  return results.flatMap((value) => {
    const item = record(value);
    const url = typeof item.permalink === 'string' ? item.permalink : '';
    const [, repo, number] = url.match(PULL_URL) ?? [];
    if (item.itemType !== 'pull_request' || !repo || !number) return [];
    return [
      {
        repo,
        number: Number(number),
        title: typeof item.title === 'string' ? item.title : '',
        url,
        author: String(record(item.author).displayLogin ?? ''),
        draft: item.isDraft === true,
        comments: typeof item.commentCount === 'number' ? item.commentCount : 0,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
        unread: item.isReadByCurrentUser === false,
        headSha: typeof item.headSha === 'string' ? item.headSha : '',
      },
    ];
  });
};

const KINDS: Record<string, ActivityKind> = {
  IssueComment: 'comment',
  PullRequestReviewComment: 'comment',
  PullRequestReview: 'review',
};

/** The pull requests in the notifications inbox, each as of its latest event. Issues, releases and the rest are left out. */
export const parseNotifications = (html: string): Activity[] =>
  html
    .split(/(?=<li\b[^>]*\bnotifications-list-item\b)/)
    .slice(1)
    .flatMap((item) => {
      const thread = item.match(/data-notification-id="([^"]+)"/)?.[1];
      const link = item.match(/<a\b[^>]*\bnotification-list-item-link\b[^>]*>/)?.[0] ?? '';
      const href = decode(link.match(/\bhref="([^"]+)"/)?.[1] ?? '');
      const [, repo, number] = href.match(PULL_URL) ?? [];
      const hydro = decode(link.match(/\bdata-hydro-click="([^"]+)"/)?.[1] ?? '');
      const field = (name: string) => hydro.match(new RegExp(`"${name}":"([^"]*)"`))?.[1] ?? '';
      const updatedAt = field('last_updated_at') || (item.match(/<relative-time[^>]*datetime="([^"]+)"/)?.[1] ?? '');
      if (!thread || !repo || !number || !updatedAt) return [];
      return [
        {
          thread,
          repo,
          number: Number(number),
          title: textOf(item.match(/<p\b[^>]*\bmarkdown-title\b[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? ''),
          url: href,
          reason: field('reason'),
          kind: KINDS[field('comment_type')] ?? 'other',
          anchor: new URL(href).hash.slice(1),
          updatedAt,
        },
      ];
    });

const reviewState = (text: string): ReviewState =>
  /approved these changes/.test(text) ? 'approved' : /requested changes/.test(text) ? 'changes-requested' : 'commented';

/** Reads a pull request's page for who wrote the event at `anchor`, and for the reader's own review in the sidebar. */
export const parseDetail = (html: string, anchor: string, me: string): Detail => {
  const start = anchor ? html.indexOf(`id="${anchor}"`) : -1;
  // The event's header: its author's link, a Bot label, and for a review, what it did. The header ends at its permalink.
  const header = start === -1 ? '' : html.slice(start, html.indexOf(`id="${anchor}-permalink"`, start) + 1 || start + 4000);
  const author = header.match(/<a\b[^>]*\bclass="author\b[^>]*\bhref="\/(apps\/)?([^"/]+)"/);
  const status = me ? html.indexOf(`id="review-status-${me}"`) : -1;
  const mine = status === -1 ? '' : textOf(html.slice(status, status + 3000));
  const said = new RegExp(`\\b${me}\\s+(approved these changes|requested changes|left review comments|reviewed)`).exec(mine)?.[1];
  return {
    actor: author?.[2] ?? '',
    bot: Boolean(author?.[1]) || /\bLabel\b[^>]*>\s*Bot\b/.test(header),
    review: anchor.startsWith('pullrequestreview-') && header ? reviewState(textOf(header)) : null,
    myReview: said ? reviewState(said) : null,
  };
};

/** The signed-in reader's login, from any of GitHub's pages. */
export const parseLogin = (html: string): string => html.match(/<meta name="user-login" content="([^"]*)"/)?.[1] ?? '';

const get = async (path: string, accept: 'text/html' | 'application/json') => {
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, { credentials: 'include', headers: { Accept: accept } });
  } catch {
    throw new InboxError('offline');
  }
  // Signed out, GitHub sends its sign-in page instead.
  if (response.status === 401 || new URL(response.url).pathname.startsWith('/login')) throw new InboxError('signed-out');
  if (!response.ok) throw new InboxError('unreadable');
  return response;
};

/** The pull requests waiting for the reader's review, or the open ones they wrote. */
export const fetchPulls = async (list: 'reviews' | 'authored'): Promise<PullRequest[]> => {
  const response = await get(`/pulls/${list}`, 'application/json');
  return parsePulls(await response.json().catch(() => null));
};

/** The notifications inbox, and who's signed in. */
export const fetchNotifications = async (): Promise<{ me: string; activity: Activity[] }> => {
  const html = await (await get('/notifications?query=', 'text/html')).text();
  const me = parseLogin(html);
  if (!me) throw new InboxError('signed-out');
  return { me, activity: parseNotifications(html) };
};

export const fetchDetail = async (repo: string, number: number, anchor: string, me: string): Promise<Detail> => {
  const html = await (await get(`/${repo}/pull/${number}`, 'text/html')).text();
  return parseDetail(html, anchor, me);
};

/**
 * A pull request's changed files, each with its line counts and whether the reader marked it viewed: the files page as
 * GitHub sends it with `Accept: application/json`, the same summaries the bar reads off the page, a tenth of the HTML.
 */
export const parseFiles = (data: unknown): PullFile[] => {
  const routes = Object.values(record(record(data).payload));
  const summaries = routes.map((route) => record(route).diffSummaries).find(Array.isArray);
  if (!summaries) throw new InboxError('unreadable');
  return summaries.flatMap((value) => {
    const summary = record(value);
    if (typeof summary.path !== 'string') return [];
    return [[summary.path, Number(summary.linesAdded) || 0, Number(summary.linesDeleted) || 0, summary.markedAsViewed === true]];
  });
};

export const fetchFiles = async (repo: string, number: number): Promise<PullFile[]> => {
  const response = await get(`/${repo}/pull/${number}/changes`, 'application/json');
  return parseFiles(await response.json().catch(() => null));
};
