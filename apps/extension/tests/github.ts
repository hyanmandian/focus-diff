import type { BrowserContext, Page } from "@playwright/test";

/** GitHub's pull requests dashboard as it answers with `Accept: application/json`. */
export const dashboard = (results: unknown[]) =>
  JSON.stringify({ payload: { pullsDashboardSurfaceContentRoute: { results, pageInfo: {}, error: null } } });

/** The rest of GitHub the background and the popup read: authors' pictures, missing, sign-in, and an empty inbox. */
export const routeGitHubRest = async (context: BrowserContext) => {
  // Authors' pictures, which the popup does without when they don't load.
  await context.route(/^https:\/\/(github\.com\/[\w-]+\.png|avatars\.githubusercontent\.com\/)/, (route) =>
    route.fulfill({ status: 404 }),
  );
  await context.route(/^https:\/\/github\.com\/login/, (route) =>
    route.fulfill({ contentType: "text/html", body: "<title>Sign in</title>" }),
  );
  await context.route(/^https:\/\/github\.com\/notifications/, (route) =>
    route.fulfill({ contentType: "text/html", body: '<meta name="user-login" content="me-too"><ul></ul>' }),
  );
};

/** The browser's prompt for notifications can't be answered from a test, so it's answered for it. */
export const allowNotifications = (page: Page) =>
  page.addInitScript(() => {
    chrome.permissions.request = async () => true;
    chrome.permissions.contains = async () => true;
  });
