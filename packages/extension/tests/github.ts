import type { BrowserContext, Page } from "@playwright/test";

/** GitHub's pull requests dashboard as it answers with `Accept: application/json`. */
export const dashboard = (results: unknown[]) =>
  JSON.stringify({ payload: { pullsDashboardSurfaceContentRoute: { results, pageInfo: {}, error: null } } });

/** A pull request's hovercard as GitHub sends it to its own pages, trimmed to its two branches. */
export const hovercard = (base: string, head: string) => `
  <div class="Popover-message">
    <span class="commit-ref css-truncate user-select-contain expandable base-ref" title="octo/web:${base}">
      <a href="/octo/web/tree/${base}"><span class="css-truncate-target">${base}</span></a>
    </span>
    <span class="commit-ref css-truncate user-select-contain expandable head-ref" title="octo/web:${head}">
      <span class="css-truncate-target">${head}</span>
    </span>
  </div>`;

/**
 * The rest of GitHub the background and the popup read: authors' pictures, missing, sign-in, an empty inbox, and
 * hovercards that aren't there, unless a test routes its own after.
 */
export const routeGitHubRest = async (context: BrowserContext) => {
  await context.route(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/hovercard$/u, (route) =>
    route.fulfill({ status: 404 }),
  );
  // Authors' pictures, which the popup does without when they don't load.
  await context.route(/^https:\/\/(github\.com\/[\w-]+\.png|avatars\.githubusercontent\.com\/)/u, (route) =>
    route.fulfill({ status: 404 }),
  );
  await context.route(/^https:\/\/github\.com\/login/u, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Sign in</title>" }),
  );
  await context.route(/^https:\/\/github\.com\/notifications/u, (route) =>
    route.fulfill({ contentType: "text/html", body: '<meta name="user-login" content="me-too"><ul></ul>' }),
  );
};

/** The browser's prompt for notifications can't be answered from a test, so it's answered for it. */
export const allowNotifications = (page: Page) =>
  page.addInitScript(() => {
    chrome.permissions.request = () => Promise.resolve(true);
    chrome.permissions.contains = () => Promise.resolve(true);
  });
