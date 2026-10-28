import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchBranches,
  fetchDetail,
  fetchFiles,
  fetchNotifications,
  fetchPulls,
  InboxError,
  pageCount,
  parseDetail,
  parseFiles,
  parseHovercard,
  parseLogin,
  parseNotifications,
  parsePulls,
  searchFor,
} from "./github-inbox";

const dashboard = (results: unknown[]) => ({
  payload: { pullsDashboardSurfaceContentRoute: { results, pageInfo: {}, error: null } },
});
const pull = {
  itemType: "pull_request",
  author: { displayLogin: "ada" },
  commentCount: 3,
  isDraft: false,
  number: 12,
  permalink: "https://github.com/octo/web/pull/12",
  repoNameWithOwner: "octo/web",
  title: "Cache the book covers",
  createdAt: "2026-10-07T09:00:00Z",
  updatedAt: "2026-10-08T12:00:00Z",
  isReadByCurrentUser: false,
  headSha: "311897b5",
};

const notification = ({
  id = "NT_1",
  href = "https://github.com/octo/web/pull/12#issuecomment-34",
  reason = "author",
  type = "IssueComment",
} = {}) => {
  const hydro = JSON.stringify({
    payload: { comment_type: type, metadata: { reason, last_updated_at: "2026-10-09T03:02:24Z" } },
  });
  return `<li class="notifications-list-item js-notifications-list-item notification-unread" data-notification-id="${id}">
    <a class="d-flex notification-list-item-link" href="${href.replace("#", "?notification_referrer_id=NT_1#")}"
      data-hydro-click="${hydro.replaceAll('"', "&quot;")}">
      <p class="m-0 f6">octo/web <span>#12</span></p>
      <p class="m-0 text-normal markdown-title"> Cache the <code>book</code> covers &amp; more </p>
    </a>
    <relative-time datetime="2026-10-09T03:02:24Z">Oct 9</relative-time>
  </li>`;
};

describe("parsePulls", () => {
  it("reads a dashboard list", () => {
    expect(parsePulls(dashboard([pull]))).toEqual([
      {
        repo: "octo/web",
        number: 12,
        title: "Cache the book covers",
        url: "https://github.com/octo/web/pull/12",
        author: "ada",
        draft: false,
        comments: 3,
        createdAt: "2026-10-07T09:00:00Z",
        updatedAt: "2026-10-08T12:00:00Z",
        unread: true,
        headSha: "311897b5",
      },
    ]);
  });

  it("leaves out anything that is not a pull request", () => {
    expect(
      parsePulls(
        dashboard([
          { ...pull, itemType: "issue" },
          { ...pull, permalink: "https://github.com/octo/web/issues/1" },
        ]),
      ),
    ).toEqual([]);
  });

  it("says so when the data no longer reads as a list", () => {
    expect(() => parsePulls({ payload: {} })).toThrow("unreadable");
    expect(() => parsePulls(null)).toThrow("unreadable");
  });

  it("reads where a pull request stands in a stack GitHub keeps, and nothing from a place that doesn't add up", () => {
    const stacks = parsePulls(
      dashboard([
        { ...pull, stackPosition: 2, stackSize: 3 },
        { ...pull, number: 13, permalink: "https://github.com/octo/web/pull/13", stackPosition: null, stackSize: null },
        { ...pull, number: 14, permalink: "https://github.com/octo/web/pull/14", stackPosition: 4, stackSize: 3 },
        { ...pull, number: 15, permalink: "https://github.com/octo/web/pull/15", stackPosition: 1.5, stackSize: 3 },
        { ...pull, number: 16, permalink: "https://github.com/octo/web/pull/16", stackPosition: "1", stackSize: 3 },
      ]),
    ).map((each) => each.stack);
    expect(stacks).toEqual([{ position: 2, size: 3 }, undefined, undefined, undefined, undefined]);
  });
});

describe("searchFor", () => {
  it("searches the open pull requests the reader took part in, not theirs", () => {
    expect(searchFor("updates", 0)).toBe("is:open is:pr involves:@me -author:@me archived:false sort:updated-desc");
  });

  it("searches the ones merged in the last week that still asked for the reader's review", () => {
    expect(searchFor("merged", Date.parse("2026-10-27T10:00:00Z"))).toBe(
      "is:merged is:pr merged:>=2026-10-20 review-requested:@me -author:@me archived:false sort:updated-desc",
    );
  });
});

const hovercard = (head: string) => `
  <div class="Popover-message">
    <a class="Link--primary" href="/octo/web/pull/12">Cache the book covers</a>
    <span class="commit-ref css-truncate user-select-contain expandable base-ref" title="octo/web:main">
      <a href="/octo/web/tree/main"><span class="css-truncate-target">main</span></a>
    </span>
    <span class="commit-ref css-truncate user-select-contain expandable head-ref" title="the head">
      ${head}
    </span>
  </div>`;

describe("parseHovercard", () => {
  it("reads a pull request's base and head branches", () => {
    expect(parseHovercard(hovercard('<span class="css-truncate-target">add-covers</span>'))).toEqual({
      head: "add-covers",
      base: "main",
      fork: false,
    });
  });

  it("reads a head on a fork, written with its owner", () => {
    expect(
      parseHovercard(
        hovercard('<span class="user">ana</span>:<span class="css-truncate-target">fix&#47;covers</span>'),
      ),
    ).toEqual({ head: "fix/covers", base: "main", fork: true });
  });

  it("reads nothing from a card without both branches", () => {
    expect(parseHovercard("")).toBeNull();
    expect(parseHovercard('<span class="commit-ref base-ref">main</span>')).toBeNull();
    expect(parseHovercard('<span class="commit-ref head-ref">add-covers</span>')).toBeNull();
    expect(parseHovercard('<span class="commit-ref base-ref">main</span><span class="commit-ref">add')).toBeNull();
  });
});

describe("parseNotifications", () => {
  it("reads each pull request thread as of its latest event", () => {
    const html = `<ul>${notification()}${notification({ id: "NT_2", href: "https://github.com/octo/api/pull/7#pullrequestreview-9", reason: "review_requested", type: "PullRequestReview" })}</ul>`;
    expect(parseNotifications(html)).toEqual([
      {
        thread: "NT_1",
        repo: "octo/web",
        number: 12,
        title: "Cache the book covers & more",
        url: "https://github.com/octo/web/pull/12?notification_referrer_id=NT_1#issuecomment-34",
        reason: "author",
        kind: "comment",
        anchor: "issuecomment-34",
        updatedAt: "2026-10-09T03:02:24Z",
      },
      expect.objectContaining({
        thread: "NT_2",
        repo: "octo/api",
        number: 7,
        reason: "review_requested",
        kind: "review",
        anchor: "pullrequestreview-9",
      }),
    ]);
  });

  it("leaves out issues, and events that are not comments or reviews read as other", () => {
    const html = `<ul>${notification({ href: "https://github.com/octo/web/issues/3#issuecomment-1" })}${notification({ id: "NT_3", type: "IssueEventNotification" })}</ul>`;
    expect(parseNotifications(html)).toEqual([expect.objectContaining({ thread: "NT_3", kind: "other" })]);
  });
});

describe("parseDetail", () => {
  const page = `
    <div id="issuecomment-34"><strong><a class="author Link--primary" href="/apps/review-bot">review-bot</a>
      <span class="Label Label--secondary">Bot</span></strong> commented
      <a href="#issuecomment-34" id="issuecomment-34-permalink">Oct 9</a>
      <table><tr><td class="d-block comment-body markdown-body js-comment-body">
        <blockquote><p>An earlier comment</p></blockquote>
        <p>Coverage went <strong>down</strong> by 2%&nbsp;here.</p>
      </td></tr></table></div>
    <div id="pullrequestreview-9"><strong><a class="author Link--primary" data-hovercard-type="user" href="/grace">grace</a></strong>
      approved these changes <a href="#pullrequestreview-9" id="pullrequestreview-9-permalink">Oct 9</a></div>
    <div id="pullrequestreview-10"><strong><a class="author Link--primary" href="/linus">linus</a></strong>
      reviewed <a id="pullrequestreview-10-permalink">Oct 9</a></div>
    <span class="assignee">me-too</span>
    <a id="review-status-me-too" href="/octo/web/pull/12/changes"></a>
    <span>me-too approved these changes</span>`;

  it("reads who wrote a comment, and whether they are a bot", () => {
    expect(parseDetail(page, "issuecomment-34", "me-too")).toEqual({
      actor: "review-bot",
      bot: true,
      review: null,
      myReview: "approved",
      excerpt: "Coverage went down by 2% here.",
    });
  });

  it("reads what a review did", () => {
    expect(parseDetail(page, "pullrequestreview-9", "")).toEqual({
      actor: "grace",
      bot: false,
      review: "approved",
      myReview: null,
      excerpt: "",
    });
    expect(parseDetail(page, "pullrequestreview-10", "")).toMatchObject({ actor: "linus", review: "commented" });
  });

  it("reads only the reader’s review without an event to look at", () => {
    expect(parseDetail(page, "", "me-too")).toEqual({
      actor: "",
      bot: false,
      review: null,
      myReview: "approved",
      excerpt: "",
    });
    expect(
      parseDetail(page.replace("approved these changes</span>", "requested changes</span>"), "", "me-too").myReview,
    ).toBe("changes-requested");
  });
});

describe("parseDetail, a long comment", () => {
  it("cuts what it says short", () => {
    const words = "word ".repeat(60);
    const html = `<div id="issuecomment-1"><td class="comment-body js-comment-body">${words}</td></div>`;
    const { excerpt } = parseDetail(html, "issuecomment-1", "");
    expect(excerpt).toHaveLength(140);
    expect(excerpt.endsWith("…")).toBe(true);
  });
});

describe("pageCount", () => {
  it("reads how many pages a list has, or one when it doesn’t say", () => {
    expect(pageCount({ payload: { route: { results: [], pageInfo: { totalPages: 3 } } } })).toBe(3);
    expect(pageCount({ payload: { route: { results: [], pageInfo: {} } } })).toBe(1);
    expect(pageCount(null)).toBe(1);
  });
});

describe("parseLogin", () => {
  it("reads the signed-in login, or nothing when signed out", () => {
    expect(parseLogin('<meta name="user-login" content="ada">')).toBe("ada");
    expect(parseLogin('<meta name="user-login" content="">')).toBe("");
  });
});

describe("parseFiles", () => {
  it("reads each changed file with its line counts and whether it was viewed", () => {
    const route = {
      diffSummaries: [
        { path: "src/app.ts", linesAdded: 20, linesDeleted: 2, markedAsViewed: false },
        { path: "yarn.lock", linesAdded: 400, linesDeleted: 380, markedAsViewed: true },
        { pathDigest: "no-path" },
      ],
    };
    expect(parseFiles({ payload: { pullRequestsChangesRoute: route } })).toEqual([
      ["src/app.ts", 20, 2, false],
      ["yarn.lock", 400, 380, true],
    ]);
  });

  it("says so when the page no longer reads as expected", () => {
    expect(() => parseFiles({ payload: {} })).toThrow(InboxError);
  });
});

describe("reading what GitHub sends defensively", () => {
  it("takes missing or odd fields of a list item as empty", () => {
    expect(
      parsePulls(
        dashboard([
          { itemType: "pull_request", permalink: "https://github.com/octo/web/pull/5", isReadByCurrentUser: true },
          { ...pull, permalink: 5 },
        ]),
      ),
    ).toEqual([
      {
        repo: "octo/web",
        number: 5,
        title: "",
        url: "https://github.com/octo/web/pull/5",
        author: "",
        draft: false,
        comments: 0,
        createdAt: "",
        updatedAt: "",
        unread: false,
        headSha: "",
      },
    ]);
  });

  it("decodes the entities in a title, and leaves alone the ones it can't", () => {
    const huge = "9".repeat(400);
    const html = `<ul>${notification()}</ul>`.replace(
      "Cache the <code>book</code> covers &amp; more",
      `&#x41;&#66; &LT; &unknown; &#${huge}; &#9999999; &#x110000;`,
    );
    expect(parseNotifications(html)[0]?.title).toBe(`AB < &unknown; &#${huge}; &#9999999; &#x110000;`);
  });

  it("reads a thread's time off the page when its link doesn't say, and leaves out one without either", () => {
    const bare = `<li class="notifications-list-item" data-notification-id="NT_9">
      <a class="notification-list-item-link" href="https://github.com/octo/web/pull/4">
      <relative-time datetime="2026-10-01T00:00:00Z"></relative-time></li>`;
    expect(parseNotifications(`<ul>${bare}</ul>`)).toEqual([
      {
        thread: "NT_9",
        repo: "octo/web",
        number: 4,
        title: "",
        url: "https://github.com/octo/web/pull/4",
        reason: "",
        kind: "other",
        anchor: "",
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ]);
    const timeless =
      '<li class="notifications-list-item" data-notification-id="NT_8"><a class="notification-list-item-link" href="https://github.com/octo/web/pull/4"></li>';
    const linkless =
      '<li class="notifications-list-item" data-notification-id="NT_7"><a href="https://github.com/octo/web/pull/4"></li>';
    const hrefless =
      '<li class="notifications-list-item" data-notification-id="NT_6"><a class="notification-list-item-link"></li>';
    expect(parseNotifications(`<ul>${timeless}${linkless}${hrefless}</ul>`)).toEqual([]);
  });

  it("reads no login from a page without one", () => {
    expect(parseLogin("<html></html>")).toBe("");
  });

  it("takes line counts that aren't numbers as none", () => {
    expect(
      parseFiles({ payload: { route: { diffSummaries: [{ path: "a.ts", linesAdded: "x", markedAsViewed: "yes" }] } } }),
    ).toEqual([["a.ts", 0, 0, false]]);
  });
});

describe("fetching from GitHub", () => {
  const respond = (body: string, { status = 200, url = "https://github.com/pulls" } = {}) => {
    const response = new Response(body, { status });
    Object.defineProperty(response, "url", { value: url });
    return response;
  };
  const stubFetch = (handler: (url: string, init?: RequestInit) => Response | Promise<Response>) => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>((url, init) =>
      Promise.resolve(handler(url, init)),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const listPage = (page: number, totalPages: number) =>
    JSON.stringify({
      payload: {
        route: {
          results: [{ ...pull, permalink: `https://github.com/octo/web/pull/${page}`, number: page }, pull],
          pageInfo: { totalPages },
        },
      },
    });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads every page of a list, up to four, with the reader's session, once per pull request", async () => {
    const fetchMock = stubFetch((url) => respond(listPage(Number(new URL(url).searchParams.get("page") ?? 1), 9)));
    const pulls = await fetchPulls("reviews");
    expect(pulls.map((each) => each.number)).toEqual([1, 12, 2, 3, 4]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://github.com/pulls/reviews",
      "https://github.com/pulls/reviews?page=2",
      "https://github.com/pulls/reviews?page=3",
      "https://github.com/pulls/reviews?page=4",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("adds the page to a search list's query", async () => {
    const fetchMock = stubFetch((url) => respond(listPage(url.includes("page=2") ? 2 : 1, 2)));
    await fetchPulls("direct");
    expect(fetchMock.mock.calls[1]?.[0]).toMatch(/^https:\/\/github\.com\/pulls\/search\?q=.+&page=2$/u);
    stubFetch(() => respond(listPage(1, 1)));
    expect(await fetchPulls("authored")).toHaveLength(2);
  });

  it("reads the lists the popup can add as GitHub searches", async () => {
    const fetchMock = stubFetch(() => respond(listPage(1, 1)));
    await fetchPulls("updates");
    await fetchPulls("merged");
    const queries = fetchMock.mock.calls.map(([url]) => new URL(url).searchParams.get("q"));
    expect(queries[0]).toContain("involves:@me");
    expect(queries[1]).toContain("is:merged");
  });

  it("says when a list doesn't read as JSON", async () => {
    stubFetch(() => respond("<html>"));
    await expect(fetchPulls("reviews")).rejects.toMatchObject({ problem: "unreadable" });
  });

  it("tells being offline, signed out and a page that failed apart", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchPulls("reviews")).rejects.toMatchObject({ problem: "offline" });
    stubFetch(() => respond("", { status: 401 }));
    await expect(fetchPulls("reviews")).rejects.toMatchObject({ problem: "signed-out" });
    stubFetch(() => respond("<html>", { url: "https://github.com/login?return_to=%2Fpulls" }));
    await expect(fetchNotifications()).rejects.toMatchObject({ problem: "signed-out" });
    stubFetch(() => respond("", { status: 500 }));
    await expect(fetchFiles("octo/web", 1)).rejects.toBeInstanceOf(InboxError);
  });

  it("reads the notifications inbox and who's signed in, and takes a page without a login as signed out", async () => {
    const fetchMock = stubFetch(() =>
      respond(`<meta name="user-login" content="ada"><ul>${notification()}</ul>`, {
        url: "https://github.com/notifications",
      }),
    );
    expect(await fetchNotifications()).toEqual({
      me: "ada",
      activity: [expect.objectContaining({ thread: "NT_1" })],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://github.com/notifications?query=");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ headers: { Accept: "text/html" } });

    stubFetch(() => respond("<ul></ul>"));
    await expect(fetchNotifications()).rejects.toMatchObject({ problem: "signed-out" });
  });

  it("reads a pull request's page for an event, and its files", async () => {
    const fetchMock = stubFetch((url) =>
      url.endsWith("/changes")
        ? respond(JSON.stringify({ payload: { route: { diffSummaries: [{ path: "a.ts", linesAdded: 1 }] } } }))
        : respond('<div id="issuecomment-1"><a class="author" href="/ada">ada</a></div>'),
    );
    expect(await fetchDetail("octo/web", 7, "issuecomment-1", "")).toMatchObject({ actor: "ada" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://github.com/octo/web/pull/7");
    expect(await fetchFiles("octo/web", 7)).toEqual([["a.ts", 1, 0, false]]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://github.com/octo/web/pull/7/changes");

    stubFetch(() => respond("not json"));
    await expect(fetchFiles("octo/web", 7)).rejects.toMatchObject({ problem: "unreadable" });
  });

  it("reads a pull request's branches from its hovercard, as GitHub sends it to its own pages", async () => {
    const fetchMock = stubFetch(() => respond(hovercard("add-covers")));
    expect(await fetchBranches("octo/web", 7)).toEqual({ head: "add-covers", base: "main", fork: false });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://github.com/octo/web/pull/7/hovercard");
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({
      credentials: "include",
      headers: { Accept: "text/html", "X-Requested-With": "XMLHttpRequest" },
    });
    stubFetch(() => respond("<p>Something else</p>"));
    expect(await fetchBranches("octo/web", 7)).toBeNull();
  });
});
