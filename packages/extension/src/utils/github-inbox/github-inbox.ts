import { asRecord, asText } from "@/utils/record/record";
import type { PullFile } from "@/utils/review-sessions/review-sessions";

const ORIGIN = "https://github.com";

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
  unread: boolean;
  headSha: string;
  again?: boolean;
  team?: boolean;
  stack?: { position: number; size: number };
}

type ActivityKind = "comment" | "review" | "other";

export interface Activity {
  thread: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  reason: string;
  kind: ActivityKind;
  anchor: string;
  updatedAt: string;
}

type ReviewState = "approved" | "changes-requested" | "commented";

export interface Detail {
  actor: string;
  bot: boolean;
  review: ReviewState | null;
  myReview: ReviewState | null;
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
    return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
  });
const textOf = (html: string) =>
  decode(html.replaceAll(/<[^>]*>/gu, " "))
    .replaceAll(/\s+/gu, " ")
    .trim();

const PULL_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/u;

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0);

const stackOf = (item: Record<string, unknown>) => {
  const position = count(item.stackPosition);
  const size = count(item.stackSize);
  return position && position <= size ? { stack: { position, size } } : {};
};

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
        ...stackOf(item),
      },
    ];
  });
};

const KINDS: Record<string, ActivityKind> = {
  IssueComment: "comment",
  PullRequestReviewComment: "comment",
  PullRequestReview: "review",
};

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

const EXCERPT = 140;

const excerptOf = (event: string) => {
  const body = event.match(/<td\b[^>]*\bjs-comment-body\b[^>]*>([\s\S]*?)<\/td>/u)?.[1] ?? "";
  const text = textOf(body.replaceAll(/<(blockquote|pre)\b[\s\S]*?<\/\1>/gu, " "));
  return text.length > EXCERPT ? `${text.slice(0, EXCERPT - 1).trimEnd()}…` : text;
};

export const parseDetail = (html: string, anchor: string, me: string): Detail => {
  const start = anchor ? html.indexOf(`id="${anchor}"`) : -1;
  const next =
    start === -1 ? -1 : html.slice(start + anchor.length + 5).search(/id="(issuecomment|pullrequestreview)-\d+"/u);
  const event = start === -1 ? "" : html.slice(start, next === -1 ? undefined : start + anchor.length + 5 + next);
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

export const parseLogin = (html: string): string => html.match(/<meta name="user-login" content="([^"]*)"/u)?.[1] ?? "";

const get = async (path: string, accept: "text/html" | "application/json", headers: Record<string, string> = {}) => {
  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, { credentials: "include", headers: { Accept: accept, ...headers } });
  } catch {
    throw new InboxError("offline");
  }
  if (response.status === 401 || new URL(response.url).pathname.startsWith("/login"))
    throw new InboxError("signed-out");
  if (!response.ok) throw new InboxError("unreadable");
  return response;
};

const PAGES = 4;

export const pageCount = (data: unknown): number => {
  const routes = Object.values(asRecord(asRecord(data).payload));
  const total = routes
    .map((route) => asRecord(asRecord(route).pageInfo).totalPages)
    .find((pages) => typeof pages === "number");
  return typeof total === "number" && total > 1 ? Math.floor(total) : 1;
};

export type PullList = "reviews" | "authored" | "direct" | "updates" | "merged";

const MERGED_DAYS = 7;

export const searchFor = (list: "updates" | "merged", now: number): string => {
  if (list === "updates") return "is:open is:pr involves:@me -author:@me archived:false sort:updated-desc";
  const since = new Date(now - MERGED_DAYS * 86_400_000).toISOString().slice(0, 10);
  return `is:merged is:pr merged:>=${since} review-requested:@me -author:@me archived:false sort:updated-desc`;
};

const search = (query: string) => `/pulls/search?q=${encodeURIComponent(query)}`;

const pathOf = (list: PullList): string => {
  if (list === "reviews") return "/pulls/reviews";
  if (list === "authored") return "/pulls/authored";
  if (list === "direct") return search("is:open is:pr user-review-requested:@me archived:false");
  return search(searchFor(list, Date.now()));
};

export const fetchPulls = async (list: PullList): Promise<PullRequest[]> => {
  const base = pathOf(list);
  const read = async (page: number): Promise<unknown> => {
    const path = page === 1 ? base : `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
    return (await get(path, "application/json")).json().catch(() => null);
  };
  const first = await read(1);
  const rest = await Promise.all(
    Array.from({ length: Math.min(pageCount(first), PAGES) - 1 }, (_, index) => read(index + 2)),
  );
  const pulls = new Map([first, ...rest].flatMap((each) => parsePulls(each)).map((pull) => [pull.url, pull]));
  return [...pulls.values()];
};

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

export interface PullBranches {
  head: string;
  base: string;
  fork: boolean;
}

const spanFrom = (html: string, from: number) => {
  const tags = /<(\/?)span\b[^>]*>/gu;
  tags.lastIndex = from;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[1] ? -1 : 1;
    if (depth === 0) return html.slice(from, tag.index);
  }
  return "";
};

const withoutTags = (html: string): string => {
  let text = html;
  for (let last = ""; last !== text;) {
    last = text;
    text = text.replaceAll(/<[^>]*>/gu, "");
  }
  return text;
};

export const parseHovercard = (html: string): PullBranches | null => {
  const refs = [...html.matchAll(/<span\b[^>]*\bclass="([^"]*\bcommit-ref\b[^"]*)"[^>]*>/gu)].map((match) => ({
    base: /\bbase-ref\b/u.test(String(match[1])),
    name: decode(withoutTags(spanFrom(html, match.index + match[0].length))).replaceAll(/\s+/gu, ""),
  }));
  const base = refs.find((ref) => ref.base)?.name;
  const head = refs.find((ref) => !ref.base)?.name;
  if (!base || !head) return null;
  const colon = head.indexOf(":");
  return colon === -1 ? { head, base, fork: false } : { head: head.slice(colon + 1), base, fork: true };
};

export const fetchBranches = async (repo: string, number: number): Promise<PullBranches | null> => {
  const response = await get(`/${repo}/pull/${number}/hovercard`, "text/html", {
    "X-Requested-With": "XMLHttpRequest",
  });
  return parseHovercard(await response.text());
};
