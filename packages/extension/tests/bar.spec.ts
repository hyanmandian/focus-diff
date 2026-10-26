import type { Worker } from "@playwright/test";

import {
  accessibilityViolations,
  DEFAULT_CONFIG,
  expect,
  PULL_REQUEST,
  test,
  VIRTUALIZED_PULL_REQUEST,
  type Config,
} from "./fixtures";
import { PullRequestPage } from "./pull-request-page";

/** Reloads the extension under the open tab, then changes the page so the old content script notices. */
const reloadExtension = async (pr: PullRequestPage, background: Worker) => {
  await background
    .evaluate(() => {
      chrome.runtime.reload();
    })
    .catch(() => {});
  await pr.page.evaluate(() => {
    document.body.append(document.createElement("div"));
  });
};

/** A keyboard shortcut, as the background passes it on to the tab. */
const press = (background: Worker, command: string) =>
  background.evaluate(async (name) => {
    const [tab] = await chrome.tabs.query({ url: "https://github.com/*" });
    if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: "command", command: name });
  }, command);

/** The default filters and one for Rust, which matches nothing on the pull request. */
const WITH_RUST: Config = {
  ...DEFAULT_CONFIG,
  filters: [...DEFAULT_CONFIG.filters, { id: "rust", name: "Rust", include: "\\.rs$", exclude: "", repos: [] }],
};

test.describe("the bar on a pull request", () => {
  test("shows every file with All chosen, and each filter's count", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    expect(await pr.names()).toEqual(["All", "Frontend", "Backend", "Docs"]);
    await expect(pr.chips).toHaveText(["All8", "Frontend1", "Backend3", "Docs1"]);
    expect(await pr.names(pr.pressed)).toEqual(["All"]);
    expect(await pr.visiblePaths()).toHaveLength(8);
    await expect(pr.filesCounter()).toHaveText("8");
    await expect.poll(() => pr.stats()).toContain("8 files");
  });

  test("filters diffs, the file tree and the page counters", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick("Frontend");
    await expect.poll(() => pr.visiblePaths()).toEqual(["web/src/book-card.tsx"]);
    expect(await pr.visibleTreeFiles()).toEqual(["book-card.tsx"]);
    await expect(pr.filesCounter()).toHaveText("1/8");
    await expect(pr.lineCounters().additions).toHaveText("+40");
    await expect(pr.lineCounters().deletions).toHaveText("−10");
    await expect
      .poll(() => pr.stats())
      .toEqual(["1 file", "Lines in view: 40 added, 10 removed", "About 3 min left to review"]);

    await pr.pick("Backend");
    await expect
      .poll(() => pr.visiblePaths())
      .toEqual(["api/books/service.py", "api/books/__init__.py", "api/legacy/routes.py"]);
    expect(await pr.visibleTreeFiles()).toEqual(["__init__.py", "service.py", "routes.py"]);
    await expect(pr.filesCounter()).toHaveText("3/8");
    // One of them hasn't loaded its lines yet: GitHub's own line counts stay.
    await expect(pr.lineCounters().additions).toHaveText("+120");

    await pr.pick("All");
    await expect(pr.filesCounter()).toHaveText("8");
    await expect(pr.lineCounters().deletions).toHaveText("−30");
  });

  test("turns filters on and off together, falling back to All", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.chip("Frontend").click();
    await pr.chip("Docs").click();
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Frontend", "Docs"]);
    await expect.poll(() => pr.visiblePaths()).toEqual(["web/src/book-card.tsx", "docs/books.md"]);
    await expect(pr.filesCounter()).toHaveText("2/8");
    await pr.chip("Frontend").click();
    await pr.chip("Docs").click();
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["All"]);
    await expect.poll(() => pr.visiblePaths()).toHaveLength(8);
  });

  test("shows how the pull request splits across filters", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.breakdownToggle.click();
    await expect(pr.breakdown).toBeVisible();
    const rows = pr.breakdown.locator("button[aria-pressed]");
    await expect(rows.first()).toHaveAccessibleName(/^All: 8 files, 0 viewed, 120 lines added, 30 removed\./u);
    await expect(rows.nth(1)).toHaveAccessibleName(/^Frontend: 1 file, 0 viewed, 40 lines added, 10 removed\./u);
    expect(await accessibilityViolations(pr.page, "focus-diff-bar")).toEqual([]);
    await rows.nth(1).click();
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Frontend"]);
    await pr.page.keyboard.press("Escape");
    await expect(pr.breakdown).toBeHidden();
  });

  test("tracks review progress from GitHub's Viewed toggles, down to Done", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick("Frontend");
    await expect.poll(() => pr.stats()).toContain("About 3 min left to review");
    await pr.viewedToggle("web/src/book-card.tsx").click();
    await expect.poll(() => pr.stats()).toContain("Done: every file here is viewed");
    await expect.poll(() => pr.stats()).toContain("0 files");
  });

  test("leaves out remembered filters with nothing here, down to All", async ({
    openPullRequest,
    seed,
    background,
  }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed(WITH_RUST);
    await expect(pr.chip("Rust")).toHaveText("Rust0");
    const remember = (ids: string[]) =>
      background.evaluate((value) => chrome.storage.local.set({ active: { "octo/web": value } }), ids);
    await remember(["rust", "docs"]);
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Docs"]);
    await remember(["rust"]);
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["All"]);
    // What was remembered stays, for pull requests where Rust has files.
    expect(await background.evaluate(async () => (await chrome.storage.local.get("active")).active)).toEqual({
      "octo/web": ["rust"],
    });
  });

  test("offers a repository's own filters only there", async ({ openPullRequest, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({
      filters: [
        { id: "mine", name: "Mine", include: "\\.md$", exclude: "", repos: ["octo/*"] },
        { id: "theirs", name: "Theirs", include: "\\.md$", exclude: "", repos: ["acme/web"] },
      ],
    });
    await expect.poll(() => pr.names()).toEqual(["All", "Mine"]);
  });

  test("goes to the first file left to review when the filter changes", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.viewedToggle("api/books/service.py").click();
    await pr.pick("Backend");
    // service.py is viewed, so the page goes on to the next Backend file, past it.
    await expect.poll(() => pr.top("api/books/service.py")).toBeLessThan(0);
    await expect.poll(() => pr.top("api/books/__init__.py")).toBeGreaterThan(0);
  });

  test("goes to the next file to review, then on to the next filter with any", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await expect(pr.next).toHaveAccessibleName("Next file to review, 8 left");
    // The first file is already on screen, so it's the one after it.
    await pr.next.click();
    await expect.poll(() => pr.top("web/src/book-card.test.tsx")).toBeLessThan(120);
    await pr.pick("Docs");
    await pr.viewedToggle("docs/books.md").click();
    await expect(pr.next).toHaveAccessibleName("Next: Frontend, 1 file to review");
    await pr.next.click();
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Frontend"]);
  });

  test("says when every file is viewed, with nothing to go on to", async ({ openPullRequest, seed }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ filters: DEFAULT_CONFIG.filters.filter((filter) => filter.id === "docs") });
    await pr.pick("Docs");
    await pr.viewedToggle("docs/books.md").click();
    await expect(pr.next).toHaveAttribute("aria-disabled", "true");
    await expect(pr.next).toHaveAccessibleName("Every file here is viewed");
  });

  test("follows the keyboard shortcuts", async ({ openPullRequest, background }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await press(background, "next-filter");
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Frontend"]);
    await press(background, "next-filter");
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Backend"]);
    await press(background, "previous-filter");
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["Frontend"]);
    await press(background, "show-all");
    await expect.poll(() => pr.names(pr.pressed)).toEqual(["All"]);
    await press(background, "next-unviewed");
    await expect.poll(() => pr.top("web/src/book-card.test.tsx")).toBeLessThan(120);
  });

  test("speaks the language and wears the theme picked in Settings, leaving GitHub's page alone", async ({
    openPullRequest,
    seed,
  }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await seed({ ...DEFAULT_CONFIG, language: "pt-BR", theme: "dark" });
    await expect(pr.bar.getByRole("group", { name: "Revisar uma parte" })).toBeVisible();
    await expect(pr.bar).toHaveAttribute("lang", "pt-BR");
    await expect(pr.page.locator("html")).toHaveAttribute("lang", "en");
    await expect(pr.page.locator("html")).not.toHaveAttribute("data-platform");
    const background = () =>
      pr.bar.locator("[role=group]").evaluate((group) => getComputedStyle(group).backgroundColor);
    const dark = await background();
    await seed({ ...DEFAULT_CONFIG, theme: "light" });
    await expect.poll(background).not.toBe(dark);
    await expect(pr.bar).toHaveAttribute("lang", "en");
    // With the system's, the bar follows GitHub's own appearance.
    await seed({ ...DEFAULT_CONFIG, theme: "system" });
    await pr.page.evaluate(() => (document.documentElement.dataset.colorMode = "dark"));
    await expect.poll(background).toBe(dark);
  });

  test("floats over the bottom of the screen, and passes an accessibility check light and dark", async ({
    openPullRequest,
    seed,
  }) => {
    const pr = new PullRequestPage(await openPullRequest());
    const box = await pr.group.boundingBox();
    const height = await pr.page.evaluate(() => innerHeight);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(height - 16);
    expect(await accessibilityViolations(pr.page, "focus-diff-bar")).toEqual([]);
    await seed({ ...DEFAULT_CONFIG, theme: "dark" });
    await expect(pr.bar.locator(".dark")).toHaveCount(1);
    expect(await accessibilityViolations(pr.page, "focus-diff-bar")).toEqual([]);
  });

  test("names its icon buttons in a tooltip", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.breakdownToggle.hover();
    await expect(pr.bar.getByText("Breakdown by Filter")).toBeVisible();
  });

  test("stays hidden outside pull request diffs", async ({ openPullRequest }) => {
    const page = await openPullRequest(PULL_REQUEST.replace("/changes", ""));
    await expect(page.locator("focus-diff-bar [role=group]")).toHaveCount(0);
  });

  test("puts every file back when the extension is reloaded mid-filter", async ({ openPullRequest, background }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick("Frontend");
    await expect.poll(() => pr.visiblePaths()).toEqual(["web/src/book-card.tsx"]);
    await reloadExtension(pr, background);
    await expect(pr.bar).toHaveCount(0);
    await expect.poll(() => pr.visiblePaths()).toHaveLength(8);
    await expect(pr.filesCounter()).toHaveText("8");
  });

  test("leaves GitHub its own counters to update", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.pick("Frontend");
    await expect(pr.filesCounter()).toHaveText("1/8");
    await pr.page.evaluate(() => (document.querySelector('[aria-current="page"] .Counter')!.textContent = "12"));
    await pr.pick("Docs");
    await expect(pr.filesCounter()).toHaveText("1/12");
    await pr.pick("All");
    await expect(pr.filesCounter()).toHaveText("12");
  });

  test("hides collapsed folders that hold no matching files", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest());
    await pr.page.evaluate(() => {
      const docs = [...document.querySelectorAll('[role="treeitem"][aria-expanded]')].find(
        (item) => item.firstElementChild?.textContent === "docs",
      )!;
      docs.setAttribute("aria-expanded", "false");
      docs.querySelector('[role="group"]')!.remove();
    });
    const docsFolder = pr.page.locator('[role="treeitem"][aria-expanded="false"]');
    await pr.pick("Frontend");
    await expect(docsFolder).toBeHidden();
    await pr.pick("Docs");
    await expect(docsFolder).toBeVisible();
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});

/** GitHub's newer diff view: the page embeds every file as JSON and only renders the files near the screen. */
test.describe("the bar on the newer, virtualized diff view", () => {
  test("counts every file from the embedded data, not only the rendered ones", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    expect(await pr.page.locator('[role="region"]').count()).toBeLessThan(8);
    await expect(pr.chips).toHaveText(["All8", "Frontend1", "Backend3", "Docs1"]);
    // Eight files, one of them already viewed.
    await expect.poll(() => pr.stats()).toContain("7 files");
    await pr.pick("Backend");
    await expect.poll(() => pr.stats()).toContain("Lines in view: 25 added, 10 removed");
  });

  test("hides files outside the filter, and the list closes up around them", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    const region = (path: string) => pr.page.locator('[role="region"]', { hasText: path });
    // Where the list places a file, from the sizes it measured or estimated above it, with its 16px gap after each.
    const top = (index: number) =>
      pr.page.evaluate((at) => (window as unknown as { topOf: (index: number) => number }).topOf(at), index);
    expect(await top(3)).toBe(3 * (560 + 16));
    await pr.pick("Backend");
    await expect(region("api/books/service.py")).toBeVisible();
    await expect.poll(() => top(3)).toBe(0);
    await expect.poll(() => top(6)).toBe(560 + 16);
    await pr.pick("All");
    await pr.page.evaluate(() => {
      scrollTo({ top: 0, behavior: "instant" });
    });
    await expect(region("web/src/book-card.tsx")).toBeVisible();
    await expect.poll(() => top(3)).toBe(3 * (560 + 16));
  });

  test("lines a file picked in the tree up below GitHub's sticky bar", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    // Like GitHub, file headers stick below a 58px bar.
    await pr.page.addStyleTag({
      content: "[data-diff-header-wrapper] { position: sticky; top: 58px; background: white; }",
    });
    // One GitHub hasn't drawn yet, then one it has.
    for (const path of ["web/src/book-card.stories.tsx", "api/books/service.py"]) {
      const name = path.slice(path.lastIndexOf("/") + 1);
      await pr.page
        .locator('[role="tree"] a', { hasText: new RegExp(`^${name.replaceAll(".", "\\.")}$`, "u") })
        .click();
      const region = pr.page.locator('[role="region"]', { hasText: path });
      await expect.poll(() => region.evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBe(58);
    }
    await expect(pr.page).toHaveURL(/#diff-/u);
  });

  test("takes viewed files from the embedded data and the toggles", async ({ openPullRequest }) => {
    const pr = new PullRequestPage(await openPullRequest(VIRTUALIZED_PULL_REQUEST));
    await expect.poll(() => pr.stats()).toContain("7 files");
    await pr.page
      .locator('[role="region"]', { hasText: "web/src/book-card.tsx" })
      .getByRole("button", { name: "Not Viewed" })
      .click();
    await expect.poll(() => pr.stats()).toContain("6 files");
  });

  test.afterEach(({ pageErrors }) => {
    expect(pageErrors).toEqual([]);
  });
});
