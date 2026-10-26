import type { BrowserContext, Worker } from "@playwright/test";

import { accessibilityViolations, expect, test } from "./fixtures";
import { allowNotifications, dashboard, routeGitHubRest } from "./github";

/** Review time on, with these sessions. */
const turnOnReviewTime = (background: Worker, sessions: Record<string, unknown>[]) =>
  background.evaluate((value) => chrome.storage.sync.set({ reviewTime: { enabled: true, sessions: value } }), sessions);

const pull = (number: number, hoursOld: number, extra: Record<string, unknown> = {}) => ({
  itemType: "pull_request",
  author: { displayLogin: "ada" },
  commentCount: 0,
  isDraft: false,
  number,
  permalink: `https://github.com/octo/web/pull/${number}`,
  title: `Pull request ${number}`,
  createdAt: new Date(Date.now() - hoursOld * 3600_000).toISOString(),
  updatedAt: new Date(Date.now() - 3600_000).toISOString(),
  headSha: `sha${number}`,
  ...extra,
});

/** Lines changed in each pull request's files: at the starting pace, a thousand lines take an hour. */
const FILES: Record<number, [string, number][]> = {
  12: [
    ["web/src/covers.ts", 300],
    ["web/src/covers.test.ts", 200],
  ],
  13: [["web/src/reader.ts", 100]],
  14: [["docs/reading.md", 1200]],
};

/** GitHub as review time reads it: the review queue, and each pull request's files. */
const routeGitHub = async (context: BrowserContext) => {
  await context.route(/^https:\/\/github\.com\/pulls\/(reviews|authored)$/, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: route.request().url().endsWith("/reviews")
        ? dashboard([
            pull(12, 48, { title: "Cache the book covers" }),
            pull(13, 5, { title: "Fix the reader" }),
            pull(14, 2, { title: "Write the docs" }),
          ])
        : dashboard([]),
    }),
  );
  await context.route(/^https:\/\/github\.com\/octo\/web\/pull\/(\d+)\/changes$/, (route) => {
    const number = Number(
      route
        .request()
        .url()
        .match(/pull\/(\d+)/)?.[1],
    );
    const diffSummaries = (FILES[number] ?? []).map(([path, linesAdded]) => ({
      path,
      linesAdded,
      linesDeleted: 0,
      markedAsViewed: false,
    }));
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ payload: { pullRequestsChangesRoute: { diffSummaries } } }),
    });
  });
  await routeGitHubRest(context);
};

const heldEvent = (number: number, heldAt: number, until = "review") => ({
  kind: "comment-mine",
  repo: "octo/web",
  number,
  title: `Update ${number}`,
  url: `https://github.com/octo/web/pull/${number}#issuecomment-1`,
  actor: "grace",
  bot: false,
  draft: false,
  approvedByMe: false,
  until,
  heldAt,
});

const run = (background: Worker) =>
  background.evaluate(async () => (await chrome.storage.local.get("reviewRun")).reviewRun ?? null);

test.describe("review time settings", () => {
  test("sets up a review time, with what to count and how notifications wait for it", async ({
    context,
    openExtensionPage,
    background,
  }) => {
    await routeGitHub(context);
    await background.evaluate(() =>
      chrome.storage.sync.set({
        config: { global: [{ id: "tests", name: "Tests", include: "\\.test\\.", exclude: "" }], repos: [] },
      }),
    );
    const page = await openExtensionPage("options.html#review-time");
    await allowNotifications(page);
    await page.reload();

    // Turned on, it starts with one review time, open to fill in.
    await page.getByRole("switch", { name: "Remind me when it’s review time" }).click();
    const card = page.locator(".session");
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Edit “Review time”" })).toHaveAttribute("aria-expanded", "true");
    await card.getByRole("textbox", { name: "Name" }).fill("Afternoon review");
    await card.getByRole("group", { name: "Days" }).getByRole("button", { name: "Saturday" }).click();
    await card.getByRole("button", { name: "Remove 3:00 PM" }).click();
    await card.getByLabel("Add a time").fill("16:30");
    await card.getByRole("button", { name: "Add", exact: true }).click();
    await card.getByRole("group", { name: "How long" }).getByRole("button", { name: "45 min" }).click();
    await card.getByRole("radio", { name: "Fill the time" }).check();
    await card.getByRole("group", { name: "Count time for" }).getByRole("button", { name: "Tests" }).click();
    await expect(card.locator(".session-summary")).toHaveText("Mon, Tue, Wed, Thu, Fri, and Sat at 4:30 PM · 45 min");
    await page.getByRole("switch", { name: "Hold every notification while I review" }).click();
    await page.getByLabel("Sound").first().selectOption("marimba");
    expect(await accessibilityViolations(page, "#review-time")).toEqual([]);

    // With review times, an event can wait for the next one.
    await page.getByRole("switch", { name: "Notify me" }).click();
    const comments = page.getByRole("radiogroup", {
      name: "When to tell me about “Someone comments on my pull request”",
    });
    await expect(comments.getByRole("radio", { name: "Right away" })).toBeChecked();
    await comments.getByRole("radio", { name: "At review time" }).check();
    expect(await accessibilityViolations(page, "#notifications")).toEqual([]);

    await page.locator("#save").click();
    await expect(page.locator("#status")).toContainText("Saved.");
    const saved = await background.evaluate(
      async () => (await chrome.storage.sync.get(["reviewTime", "notifications"])) as Record<string, any>,
    );
    expect(saved.reviewTime).toMatchObject({ enabled: true, holdWhileReviewing: true, sound: { id: "marimba" } });
    expect(saved.reviewTime.sessions[0]).toMatchObject({
      name: "Afternoon review",
      days: [1, 2, 3, 4, 5, 6],
      times: ["16:30"],
      minutes: 45,
      order: "fill",
      filters: ["tests"],
    });
    expect(saved.notifications.events["comment-mine"].when).toBe("review");
    // The next one has its alarm, at 16:30 on a day it's on.
    const alarm = await background.evaluate(
      async () =>
        (await chrome.alarms.getAll()).find((each: { name: string }) => each.name.startsWith("review-time:next:"))
          ?.scheduledTime ?? 0,
    );
    expect(new Date(alarm).getHours() * 60 + new Date(alarm).getMinutes()).toBe(16 * 60 + 30);
  });

  test("won’t save a review time with no time to start at", async ({ openExtensionPage }) => {
    const page = await openExtensionPage("options.html#review-time");
    await allowNotifications(page);
    await page.reload();
    await page.getByRole("switch", { name: "Remind me when it’s review time" }).click();
    await page.getByRole("button", { name: "Remove 3:00 PM" }).click();
    await page.locator("#save").click();
    await expect(page.locator("#status")).toContainText("Check the review times");
    await expect(page.locator(".session-times .error")).toHaveText("Add at least one time.");
    await expect(page.getByLabel("Add a time")).toBeFocused();
  });
});

test.describe("review time in the popup", () => {
  test("starts one now with what fits, then ends it", async ({ context, openExtensionPage, background }) => {
    await routeGitHub(context);
    const page = await openExtensionPage("popup.html");
    // Set up once, review time keeps out of the way; the clock asks for one now.
    const panel = page.getByRole("region", { name: "Review time", exact: true });
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "Review now" }).click();
    await panel.getByRole("group", { name: "How long do you have?" }).getByRole("button", { name: "45 min" }).click();
    await panel.getByRole("button", { name: "Start" }).click();

    // Waiting longest first, the ones that fit: 12 takes 33 minutes, 13 eight, 14 seventy-four.
    const rows = panel.getByRole("link");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAccessibleName(/^Cache the book covers\s*web#12\s*ada\s*~33 min\s*2 files$/);
    await expect(rows.last()).toHaveAccessibleName(/^Fix the reader/);
    await expect(panel).toContainText("45 min left");
    await expect(panel).toContainText("0 of 2 reviewed · about 41 min planned. 1 more didn’t fit.");
    await expect(page.getByRole("button", { name: "Review now" })).toBeHidden();
    expect((await run(background)).pulls).toHaveLength(2);
    await expect.poll(() => background.evaluate(() => chrome.action.getBadgeText({}))).toBe("45m");
    expect(await accessibilityViolations(page)).toEqual([]);

    await panel.getByRole("button", { name: "End now" }).click();
    await expect.poll(() => run(background)).toBeNull();
    await expect(panel).toBeHidden();
  });

  test("says how long each pull request in the queue takes, and which are back for a re-review", async ({
    context,
    openExtensionPage,
    background,
  }) => {
    await routeGitHub(context);
    // 14 left the queue after the reader reviewed it; back on it, they were asked again.
    await background.evaluate(async (url) => {
      await chrome.storage.local.set({ reviewQueueHistory: { [url]: { left: Date.now() - 3600_000 } } });
    }, "https://github.com/octo/web/pull/14");
    const page = await openExtensionPage("popup.html");
    const rows = page.getByRole("tabpanel", { name: /Review queue/ }).getByRole("link");
    await expect(rows.first()).toHaveAccessibleName(
      /^Write the docs\s*#14\s*ada\s*About 1 h 15 min to review\s*Re-review/,
    );
    await expect(rows.nth(1)).toHaveAccessibleName(/^Cache the book covers\s*#12\s*ada\s*About 33 min to review/);
    await expect(rows.nth(2)).toContainText("~8 min");
    expect(await accessibilityViolations(page)).toEqual([]);

    // Turned off, the queue reads no files and says nothing of time.
    await background.evaluate(async () => {
      const { reviewTime } = await chrome.storage.sync.get("reviewTime");
      await chrome.storage.sync.set({ reviewTime: { ...reviewTime, queueEstimates: false } });
    });
    await expect(rows.nth(1)).toHaveAccessibleName(/^Cache the book covers\s*#12\s*ada\s*\d+h ago$/);
  });

  test("offers one that runs over, saying so, with what was kept for it", async ({
    context,
    openExtensionPage,
    background,
  }) => {
    await routeGitHub(context);
    await turnOnReviewTime(background, [
      { id: "quick", name: "Quick look", days: [0, 1, 2, 3, 4, 5, 6], times: ["03:00"], minutes: 5, order: "quickest" },
    ]);
    // Scheduled first: with no review time to come, what's kept would show at once instead.
    await expect
      .poll(() =>
        background.evaluate(async () =>
          (await chrome.alarms.getAll()).some((alarm: { name: string }) => alarm.name === "review-time:next:quick"),
        ),
      )
      .toBe(true);
    await background.evaluate(() =>
      chrome.storage.local.set({
        heldNotifications: [
          {
            kind: "comment-mine",
            repo: "octo/web",
            number: 20,
            title: "Sort books by rating",
            url: "https://github.com/octo/web/pull/20#issuecomment-1",
            actor: "grace",
            bot: false,
            draft: false,
            approvedByMe: false,
            until: "review",
          },
        ],
      }),
    );
    // Put off earlier, its time comes again.
    await background.evaluate(() => chrome.alarms.create("review-time:snooze:quick", { when: Date.now() + 50 }));
    await expect.poll(() => run(background).then((value) => value?.name)).toBe("Quick look");

    const page = await openExtensionPage("popup.html");
    // Offered, it's over the lists as the popup opens.
    const panel = page.getByRole("region", { name: "Review time", exact: true });
    await expect(panel).toContainText("5 min set aside");
    await expect(panel.getByRole("note")).toHaveText(
      "The one picked takes about 8 min, 3 min more than the 5 min set aside.",
    );
    await expect(panel.getByRole("link", { name: /^Fix the reader/ })).toBeVisible();
    await expect(panel.getByRole("region", { name: /Kept for review time/ }).getByRole("link")).toHaveAccessibleName(
      /Sort books by rating/,
    );
    expect(await accessibilityViolations(page)).toEqual([]);

    await panel.getByRole("button", { name: "Start" }).click();
    await expect.poll(() => run(background).then((value) => Boolean(value?.startedAt))).toBe(true);
    await expect(panel).toContainText("5 min left");
  });
});

test.describe("review time on the welcome page", () => {
  test("starts from a preset, which asks for notifications, and takes it back", async ({
    openExtensionPage,
    background,
  }) => {
    const page = await openExtensionPage("welcome.html");
    await allowNotifications(page);
    await page.reload();
    const twice = page.locator('[data-preset="twice"]');
    await expect(twice.getByRole("listitem")).toHaveText([
      "Weekdays at 10:00 AM and 3:00 PM · 30 min",
      "Waiting longest",
    ]);
    await twice.getByRole("button", { name: "Use “Twice a day”" }).click();
    await expect(twice.getByRole("button", { name: "Stop using “Twice a day”" })).toBeFocused();
    const saved = () => background.evaluate(async () => (await chrome.storage.sync.get("reviewTime")).reviewTime);
    await expect.poll(saved).toMatchObject({
      enabled: true,
      sessions: [{ id: "preset-twice", name: "Twice a day", times: ["10:00", "15:00"] }],
    });
    expect(await accessibilityViolations(page)).toEqual([]);

    await twice.getByRole("button", { name: "Stop using “Twice a day”" }).click();
    await expect.poll(saved).toMatchObject({ enabled: false, sessions: [] });
  });
});

test.describe("review time, when things go sideways", () => {
  test("ends a review time whose alarm was lost over a restart", async ({ context, openExtensionPage, background }) => {
    await routeGitHub(context);
    await background.evaluate(() =>
      chrome.storage.local.set({
        reviewRun: {
          session: "",
          name: "Review time",
          minutes: 30,
          offeredAt: Date.now() - 60 * 60_000,
          startedAt: Date.now() - 60 * 60_000,
          pulls: [],
          left: 0,
          overBy: 0,
          filters: [],
        },
      }),
    );
    await openExtensionPage("popup.html");
    await expect.poll(() => run(background)).toBeNull();
    await expect.poll(() => background.evaluate(() => chrome.action.getBadgeText({}))).not.toBe("0m");
  });

  test("keeps what arrived during a review time for the next one", async ({
    context,
    openExtensionPage,
    background,
  }) => {
    await routeGitHub(context);
    const offeredAt = Date.now() - 60_000;
    await background.evaluate(
      ({ offeredAt, heldNotifications }) =>
        chrome.storage.local.set({
          reviewRun: {
            session: "",
            name: "Review time",
            minutes: 30,
            offeredAt,
            startedAt: null,
            pulls: [
              {
                url: "https://github.com/octo/web/pull/13",
                repo: "octo/web",
                number: 13,
                title: "Fix the reader",
                author: "ada",
                minutes: 8,
                files: 1,
              },
            ],
            left: 0,
            overBy: 0,
            filters: [],
          },
          heldNotifications,
        }),
      { offeredAt, heldNotifications: [heldEvent(20, offeredAt - 1000), heldEvent(21, offeredAt + 1000)] },
    );
    const page = await openExtensionPage("popup.html");
    await page.getByRole("region", { name: "Review time", exact: true }).getByRole("button", { name: "Skip" }).click();
    await expect.poll(() => run(background)).toBeNull();
    // The one offered with it was seen; the one that came after waits for the next.
    const left = () =>
      background.evaluate(async () =>
        ((await chrome.storage.local.get("heldNotifications")).heldNotifications ?? []).map(
          (event: { number: number }) => event.number,
        ),
      );
    await expect.poll(left).toEqual([21]);
  });

  test("says when there’s nothing to review, rather than starting an empty one", async ({
    context,
    openExtensionPage,
    background,
  }) => {
    await context.route(/^https:\/\/github\.com\/pulls\/(reviews|authored)$/, (route) =>
      route.fulfill({ contentType: "application/json", body: dashboard([]) }),
    );
    await routeGitHubRest(context);
    const page = await openExtensionPage("popup.html");
    await page.getByRole("button", { name: "Review now" }).click();
    const panel = page.getByRole("region", { name: "Review time", exact: true });
    await panel.getByRole("button", { name: "Start" }).click();
    await expect(panel).toContainText("Nothing’s waiting for your review.");
    expect(await run(background)).toBeNull();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(page.getByRole("button", { name: "Review now" })).toBeFocused();
  });

  test("skips the next review time from the popup, and takes it back", async ({
    context,
    openExtensionPage,
    background,
  }) => {
    await routeGitHub(context);
    await turnOnReviewTime(background, [
      { id: "daily", name: "Daily", days: [0, 1, 2, 3, 4, 5, 6], times: ["09:00"], minutes: 30 },
    ]);
    const next = () =>
      background.evaluate(async () => (await chrome.alarms.get("review-time:next:daily"))?.scheduledTime ?? 0);
    await expect.poll(next).toBeGreaterThan(0);
    const first = await next();
    const page = await openExtensionPage("popup.html");
    await page.getByRole("button", { name: "Review now" }).click();
    const panel = page.getByRole("region", { name: "Review time", exact: true });
    await panel.getByRole("button", { name: "Skip it" }).click();
    await expect.poll(next).toBe(first + 24 * 3600_000);
    await expect(panel).toContainText("Skipping until");
    await panel.getByRole("button", { name: "Resume" }).click();
    await expect.poll(next).toBe(first);
  });
});
