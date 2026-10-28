import type { BrowserContext, Page } from "@playwright/test";

export const dashboard = (results: unknown[]) =>
  JSON.stringify({ payload: { pullsDashboardSurfaceContentRoute: { results, pageInfo: {}, error: null } } });

export const hovercard = (base: string, head: string) => `
  <div class="Popover-message">
    <span class="commit-ref css-truncate user-select-contain expandable base-ref" title="octo/web:${base}">
      <a href="/octo/web/tree/${base}"><span class="css-truncate-target">${base}</span></a>
    </span>
    <span class="commit-ref css-truncate user-select-contain expandable head-ref" title="octo/web:${head}">
      <span class="css-truncate-target">${head}</span>
    </span>
  </div>`;

export const routeGitHubRest = async (context: BrowserContext) => {
  await context.route(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/hovercard$/u, (route) =>
    route.fulfill({ status: 404 }),
  );
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

export const allowNotifications = (page: Page) =>
  page.addInitScript(() => {
    chrome.permissions.request = () => Promise.resolve(true);
    chrome.permissions.contains = () => Promise.resolve(true);
  });
