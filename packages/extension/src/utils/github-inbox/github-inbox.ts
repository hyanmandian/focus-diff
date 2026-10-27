/**
 * The reader's pull requests and their activity on GitHub, read with the session they're signed in with: the lists of
 * GitHub's pull requests dashboard, the notifications inbox, and a pull request's page for who did what. No token and no
 * API: these are GitHub's own pages, so the reading stays defensive and says so when a page no longer reads as expected.
 * It runs in the background service worker, which has no DOMParser, so the HTML is read with patterns.
 */

import { asRecord, asText } from "@/utils/record/record";
import type { PullFile } from "@/utils/review-sessions/review-sessions";

const ORIGIN = "https://github.com";

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
  /**
   * Asked of one of the reader's teams, and not of them by name. Known only on the looks that tell the two apart, which
   * read one more list.
   */
  team?: boolean;
}

/** What the latest event on a notification thread was. */
type ActivityKind = "comment" | "review" | "other";

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

type ReviewState = "approved" | "changes-requested" | "commented";

/** Who did the latest thing on a pull request, and where the reader's own review stands. */
export interface Detail {
  actor: string;
  bot: boolean;
  /** Set when the event is a review. */
  review: ReviewState | null;
  /** The reader's latest review on the pull request, or `null` when they haven't reviewed it. */
  myReview: ReviewState | null;
  /** The start of what the event said, as plain text, or empty for one that said nothing, like a bare approval. */
  excerpt: string;
}

export type InboxProblem = "signed-out" | "unreadable" | "offline";

export class InboxError extends Error {
  readonly problem: InboxProblem;
  constructor(problem: InboxProblem) {
    super(problem);
    this.problem = problem;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (text: string) =>
  text.replaceAll(/&(#x[\da-f]+|#\d+|\w+);/giu, (entity, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? entity;
    const point = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    // Past the last code point there's no character: left as it was written, rather than failing the whole read.
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
const textOf = (html: string) =>
  decode(html.replaceAll(/<[^>]*>/gu, " "))
    .replaceAll(/\s+/gu, " ")
    .trim();

const PULL_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/u;

/** A dashboard list as GitHub sends it with `Accept: application/json`: its results, whatever route holds them. */
export const parsePulls = (data: unknown): PullRequest[] => {
  const routes = Object.values(asRecord(asRecord(data).payload));
  const results = routes.map((route) => asRecord(route).results).find((each) => Array.isArray(each));
  if (!results) throw new InboxError("unreadable");
  return results.flatMap((value) => {
    const item = asRecord(value);
    const url = typeof item.permalink === "string" ? item.permalink : "";
    const [, repo, number] = url.match(PULL_URL) ?? [];
    if (item.itemType !== "pull_request" || !repo || !number) return [];
    return [
      {
        repo,
        number: Number(number),
        title: typeof item.title === "string" ? item.title : "",
        url,
        author: asText(asRecord(item.author).displayLogin),
        draft: item.isDraft === true,
        comments: typeof item.commentCount === "number" ? item.commentCount : 0,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : "",
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : "",
        unread: item.isReadByCurrentUser === false,
        headSha: typeof item.headSha === "string" ? item.headSha : "",
      },
    ];
  });
};

const KINDS: Record<string, ActivityKind> = {
  IssueComment: "comment",
  PullRequestReviewComment: "comment",
  PullRequestReview: "review",
};

/** The pull requests in the notifications inbox, each as of its latest event. Issues, releases and the rest are left out. */
export const parseNotifications = (html: string): Activity[] =>
  html
    .split(/(?=<li\b[^>]*\bnotifications-list-item\b)/u)
    .slice(1)
    .flatMap((item) => {
      const thread = item.match(/data-notification-id="([^"]+)"/u)?.[1];
      const link = item.match(/<a\b[^>]*\bnotification-list-item-link\b[^>]*>/u)?.[0] ?? "";
      const href = decode(link.match(/\bhref="([^"]+)"/u)?.[1] ?? "");
      const [, repo, number] = href.match(PULL_URL) ?? [];
      const hydro = decode(link.match(/\bdata-hydro-click="([^"]+)"/u)?.[1] ?? "");
      const field = (name: string) => hydro.match(new RegExp(`"${name}":"([^"]*)"`, "u"))?.[1] ?? "";
      const updatedAt = field("last_updated_at") || (item.match(/<relative-time[^>]*datetime="([^"]+)"/u)?.[1] ?? "");
      if (!thread || !repo || !number || !updatedAt) return [];
      return [
        {
          thread,
          repo,
          number: Number(number),
          title: textOf(item.match(/<p\b[^>]*\bmarkdown-title\b[^>]*>([\s\S]*?)<\/p>/u)?.[1] ?? ""),
          url: href,
          reason: field("reason"),
          kind: KINDS[field("comment_type")] ?? "other",
          anchor: new URL(href).hash.slice(1),
          updatedAt,
        },
      ];
    });

const reviewState = (text: string): ReviewState =>
  text.includes("approved these changes")
    ? "approved"
    : text.includes("requested changes")
      ? "changes-requested"
      : "commented";

/** How much of a comment a notification quotes. */
const EXCERPT = 140;

/** The text of the first comment body in an event's part of the page, cut short to fit a notification. */
const excerptOf = (event: string) => {
  const body = event.match(/<td\b[^>]*\bjs-comment-body\b[^>]*>([\s\S]*?)<\/td>/u)?.[1] ?? "";
  // A quote of an earlier comment, or a block of code, says less than the words around it.
  const text = textOf(body.replaceAll(/<(blockquote|pre)\b[\s\S]*?<\/\1>/gu, " "));
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1).trimEnd()}…` : text;
};

/** Reads a pull request's page for who wrote the event at `anchor`, what it said, and the reader's own review in the sidebar. */
export const parseDetail = (html: string, anchor: string, me: string): Detail => {
  const start = anchor ? html.indexOf(`id="${anchor}"`) : -1;
  // The event's part of the page, up to the next event's.
  const next =
    start === -1 ? -1 : html.slice(start + anchor.length + 5).search(/id="(issuecomment|pullrequestreview)-\d+"/u);
  const event = start === -1 ? "" : html.slice(start, next === -1 ? undefined : start + anchor.length + 5 + next);
  // The event's header: its author's link, a Bot label, and for a review, what it did. The header ends at its permalink.
  const header =
    start === -1 ? "" : html.slice(start, html.indexOf(`id="${anchor}-permalink"`, start) + 1 || start + 4000);
  const author = header.match(/<a\b[^>]*\bclass="author\b[^>]*\bhref="\/(apps\/)?([^"/]+)"/u);
  const status = me ? html.indexOf(`id="review-status-${me}"`) : -1;
  const mine = status === -1 ? "" : textOf(html.slice(status, status + 3000));
  const said = new RegExp(
    `\\b${me}\\s+(approved these changes|requested changes|left review comments|reviewed)`,
    "u",
  ).exec(mine)?.[1];
  return {
    actor: author?.[2] ?? "",
    bot: Boolean(author?.[1]) || /\bLabel\b[^>]*>\s*Bot\b/u.test(header),
    review: anchor.startsWith("pullrequestreview-") && header ? reviewState(textOf(header)) : null,
    myReview: said ? reviewState(said) : null,
    excerpt: excerptOf(event),
  };
};

/** The signed-in reader's login, from any of GitHub's pages. */
export const parseLogin = (html: string): string => html.match(/<meta name="user-login" content="([^"]*)"/u)?.[1] ?? "";

const get = async (path: string, accept: "text/html" | "application/json") => {
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, { credentials: "include", headers: { Accept: accept } });
  } catch {
    throw new InboxError("offline");
  }
  // Signed out, GitHub sends its sign-in page instead.
  if (response.status === 401 || new URL(response.url).pathname.startsWith("/login"))
    throw new InboxError("signed-out");
  if (!response.ok) throw new InboxError("unreadable");
  return response;
};

/** How many pages of a list it reads at most, 25 pull requests each. */
const PAGES = 4;

/** The number of pages a dashboard list has, or 1 when it doesn't say. */
export const pageCount = (data: unknown): number => {
  const routes = Object.values(asRecord(asRecord(data).payload));
  const total = routes
    .map((route) => asRecord(asRecord(route).pageInfo).totalPages)
    .find((pages) => typeof pages === "number");
  return typeof total === "number" && total > 1 ? Math.floor(total) : 1;
};

export type PullList = "reviews" | "authored" | "direct";

const LISTS: Record<PullList, string> = {
  reviews: "/pulls/reviews",
  authored: "/pulls/authored",
  // The review requests made of the reader by name, leaving out the ones made of their teams.
  direct: `/pulls/search?q=${encodeURIComponent("is:open is:pr user-review-requested:@me archived:false")}`,
};

/** The pull requests waiting for the reader's review, the ones asked of them by name, or the open ones they wrote. */
export const fetchPulls = async (list: PullList): Promise<PullRequest[]> => {
  const read = async (page: number): Promise<unknown> => {
    const path = page === 1 ? LISTS[list] : `${LISTS[list]}${LISTS[list].includes("?") ? "&" : "?"}page=${page}`;
    return (await get(path, "application/json")).json().catch(() => null);
  };
  const first = await read(1);
  const rest = await Promise.all(
    Array.from({ length: Math.min(pageCount(first), PAGES) - 1 }, (_, index) => read(index + 2)),
  );
  // A pull request updated between two pages' reads moves up a page, and would be read twice.
  const pulls = new Map([first, ...rest].flatMap((each) => parsePulls(each)).map((pull) => [pull.url, pull]));
  return [...pulls.values()];
};

/** The notifications inbox, and who's signed in. */
export const fetchNotifications = async (): Promise<{ me: string; activity: Activity[] }> => {
  const html = await (await get("/notifications?query=", "text/html")).text();
  const me = parseLogin(html);
  if (!me) throw new InboxError("signed-out");
  return { me, activity: parseNotifications(html) };
};

export const fetchDetail = async (repo: string, number: number, anchor: string, me: string): Promise<Detail> => {
  const html = await (await get(`/${repo}/pull/${number}`, "text/html")).text();
  return parseDetail(html, anchor, me);
};

/**
 * A pull request's changed files, each with its line counts and whether the reader marked it viewed: the files page as
 * GitHub sends it with `Accept: application/json`, the same summaries the bar reads off the page, a tenth of the HTML.
 */
export const parseFiles = (data: unknown): PullFile[] => {
  const routes = Object.values(asRecord(asRecord(data).payload));
  const summaries = routes.map((route) => asRecord(route).diffSummaries).find((each) => Array.isArray(each));
  if (!summaries) throw new InboxError("unreadable");
  return summaries.flatMap((value) => {
    const summary = asRecord(value);
    if (typeof summary.path !== "string") return [];
    return [
      [
        summary.path,
        Number(summary.linesAdded) || 0,
        Number(summary.linesDeleted) || 0,
        summary.markedAsViewed === true,
      ],
    ];
  });
};

export const fetchFiles = async (repo: string, number: number): Promise<PullFile[]> => {
  const response = await get(`/${repo}/pull/${number}/changes`, "application/json");
  return parseFiles(await response.json().catch(() => null));
};
