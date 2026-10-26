// A stand-in for GitHub's API, which the extension's background calls (src/utils/github-api): who's signed in, the
// queues' searches and pull requests, and everything a review reads, from the app's own sample data
// (packages/app's utils/mock, the pages' development stand-in). Each request is kept, so a test can say what was sent.
import type { BrowserContext, Request } from "@playwright/test";
import { Window } from "happy-dom";

// The sample's conversations are read through the DOM's parser, which Node doesn't have.
Object.assign(globalThis, { DOMParser: new Window().DOMParser });
const { mockPlatform } = await import("@focus-diff/app/utils/mock");

export const ME = "you";

const actor = (login: string, name: string) => ({
  __typename: "User",
  login,
  name,
  avatarUrl: `https://avatars.githubusercontent.com/${login}`,
});
const none = { nodes: [] };
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

/** A pull request as the queues read it (core's queue-engine fragment), waiting on the person's review or theirs. */
const pull = (number: number, title: string, author: ReturnType<typeof actor>, review: boolean) => ({
  id: `PR_${number}`,
  number,
  title,
  url: `https://github.com/acme/web/pull/${number}`,
  isDraft: false,
  state: "OPEN",
  createdAt: hoursAgo(30),
  updatedAt: hoursAgo(2),
  mergedAt: null,
  headRefOid: `sha${number}`,
  mergeable: "MERGEABLE",
  additions: 120,
  deletions: 30,
  changedFiles: 6,
  repository: { nameWithOwner: "acme/web" },
  author,
  mergedBy: null,
  labels: none,
  reviewRequests: { nodes: review ? [{ requestedReviewer: { __typename: "User", login: ME } }] : [] },
  latestOpinionatedReviews: none,
  mine: none,
  reviewComments: none,
  comments: none,
  reviewThreads: none,
  commits: { nodes: [{ commit: { committedDate: hoursAgo(2), statusCheckRollup: { state: "SUCCESS" } } }] },
  participants: { nodes: [{ login: author.login }, ...(review ? [{ login: ME }] : [])] },
  removed: none,
  ready: none,
  commentCount: { totalCount: 0 },
  threadCount: { totalCount: 0 },
  files: { nodes: [{ path: "src/checkout/cart.ts" }] },
  requested: {
    nodes: review ? [{ createdAt: hoursAgo(3), requestedReviewer: { __typename: "User", login: ME } }] : [],
  },
});

/** The queues' pull requests: two waiting on the person's review, one of their own. */
export const PULLS = [
  pull(1807, "Checkout: keep the promo code when the cart changes", actor("ana", "Ana Lima"), true),
  pull(1814, "Search: debounce the suggestions", actor("bruno", "Bruno Costa"), true),
  pull(1821, "Docs: how to run the app locally", actor(ME, "You"), false),
];

/** Which pull requests a queue's search finds (core's searchFor). */
const found = (q: string) =>
  q.includes("review-requested:")
    ? PULLS.slice(0, 2)
    : q.includes(`author:${ME}`) && !q.includes(`-author:`)
      ? PULLS.slice(2)
      : [];

const json = (status: number, body: unknown) => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});

/** What GitHub's API answers a request, from the queues' pull requests above or the app's sample data. */
const answer = async (request: Request, login: string | null) => {
  const url = new URL(request.url());
  const path = `${url.pathname}${url.search}`;
  if (login === null) return json(401, { message: "Bad credentials" });
  if (path === "/user") return json(200, { login });
  const body = request.postData();
  const parsed = body ? (JSON.parse(body) as { query?: string; variables?: Record<string, unknown> }) : {};
  const query = parsed.query ?? "";
  if (query.includes("organizations(first: 100)")) return json(200, { data: { viewer: { organizations: none } } });
  if (query.includes("search(type: ISSUE")) {
    const nodes = found(String(parsed.variables?.q)).map(({ id, updatedAt }) => ({ id, updatedAt }));
    return json(200, { data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
  }
  if (query.includes("nodes(ids: $ids)")) {
    const ids = parsed.variables?.ids as string[];
    return json(200, { data: { nodes: PULLS.filter((pr) => ids.includes(pr.id)) } });
  }
  if (/(?:mark|unmark)FileAsViewed/u.test(query))
    return json(200, { data: { markFileAsViewed: { clientMutationId: null } } });
  // A file at a commit, as bytes.
  const contents = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)\?ref=(\w+)$/u.exec(path);
  if (contents) {
    try {
      const bytes = await mockPlatform.invoke<Uint8Array>("github_file", {
        repo: contents[1],
        path: decodeURIComponent(contents[2]!),
        sha: contents[3],
      });
      return { status: 200, contentType: "application/octet-stream", body: Buffer.from(bytes) };
    } catch {
      return json(404, { message: "Not Found" });
    }
  }
  const reply = await mockPlatform.invoke<{ status: number; body: string }>("github", {
    method: request.method(),
    path,
    body: body ?? null,
    accept: request.headers().accept ?? null,
  });
  return { status: reply.status, contentType: "application/json", body: reply.body };
};

/**
 * Answers GitHub's API in `context` as the person `login` (null: GitHub refuses the token) would get it, and people's
 * pictures with nothing. Returns the requests sent, by method and path, with their GraphQL query or body.
 */
export const fakeGitHub = async (context: BrowserContext, login: string | null = ME) => {
  const sent: Array<{ method: string; path: string; body: string }> = [];
  await context.route(/^https:\/\/avatars\.githubusercontent\.com\//u, (route) => route.fulfill({ status: 404 }));
  await context.route(/^https:\/\/api\.github\.com\//u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    sent.push({ method: request.method(), path: `${url.pathname}${url.search}`, body: request.postData() ?? "" });
    await route.fulfill(await answer(request, login));
  });
  return sent;
};
