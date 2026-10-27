// @vitest-environment happy-dom
import { normalize } from "@focus-diff/desktop/utils/config";
import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { storage } from "#imports";
import { readAppFile, writeAppFile } from "@/utils/app-files/app-files";

import {
  configFrom,
  LEGACY_DONE,
  legacyDismissals,
  migrate,
  MIGRATED,
  OLD_KEYS,
  takeLegacyDone,
  type OldSettings,
} from "./migration";

/** A reviewer as the old extension kept them: filters everywhere and for one repository, notifications with
 *  exceptions, popup lists, a review time every two hours, done marks and a learned pace. */
const ANA = {
  "sync:config": {
    global: [
      { id: "frontend", name: "Frontend", include: "\\.(ts|tsx)$", exclude: "\\.test\\." },
      { id: "backend", name: "Backend", include: "\\.py$", exclude: "" },
    ],
    repos: [
      { repo: "acme/web", filters: [{ id: "styles", name: "Styles", include: "\\.css$", exclude: "" }] },
      { repo: "acme/*", filters: [{ id: "frontend", name: "Docs", include: "\\.md$", exclude: "" }] },
    ],
  },
  "sync:appearance": { theme: "provider", themes: [] },
  "sync:notifications": {
    enabled: true,
    repos: ["acme/web"],
    excludeRepos: [],
    events: {
      "review-requested": { on: true, except: ["drafts"], repos: [], when: "review" },
      "ready-for-review": { on: true, except: ["approved"], repos: [], when: "review" },
      "comment-reviewing": { on: false, except: ["bots"], repos: [], when: "now" },
      "comment-mine": { on: true, except: ["bots"], repos: ["acme/api"], when: "now" },
      approved: { on: true, except: [], repos: ["acme/api", "acme/*"], when: "now" },
      "changes-requested": { on: true, except: [], repos: [], when: "now" },
      mention: { on: true, except: ["bots"], repos: ["acme/docs"], when: "now" },
    },
    interval: 5,
    quiet: { on: false, from: "19:00", to: "09:00", weekends: true },
    delivery: { grouped: false, sticky: false, sound: { id: "marimba", volume: 60 } },
  },
  "sync:popup": { repos: ["acme/web", "acme/api"], excludeRepos: [], teams: false },
  "sync:inboxDone": { "https://github.com/acme/web/pull/7": "2026-03-02T10:00:00Z" },
  "sync:reviewTime": {
    enabled: true,
    sessions: [
      {
        id: "morning",
        name: " Mornings ",
        on: true,
        days: [5, 1, 1, 3],
        repeat: "every",
        times: ["15:00"],
        every: 2,
        from: "09:00",
        to: "14:00",
        minutes: 45,
        order: "fill",
        filters: [],
        repos: [],
        excludeRepos: [],
        drafts: true,
      },
      {
        id: "late",
        name: "",
        on: false,
        days: [1, 2, 3, 4, 5],
        repeat: "times",
        times: ["17:30", "16:00", "nope"],
        every: 2,
        from: "09:00",
        to: "18:00",
        minutes: 500,
        order: "quickest",
        filters: ["frontend"],
        repos: ["acme/web"],
        excludeRepos: [],
        drafts: false,
      },
    ],
    pace: "careful",
    learn: true,
    perPull: 2,
    unviewedOnly: true,
    againFirst: false,
    queueEstimates: true,
    opens: "first",
    applyFilters: true,
    snooze: 10,
    remindEnd: true,
    skipEmpty: false,
    holdWhileReviewing: true,
    sound: { id: "bowl", volume: 70 },
  },
  "local:learnedPace": {
    all: { actual: 30, expected: 20, files: 12 },
    kinds: { tests: { actual: 4, expected: 6, files: 3 } },
  },
  "local:inbox": { me: "ana", reviews: [], mine: [], checkedAt: 1, problem: null },
  "local:update": "1.2.0",
} satisfies OldSettings;

/** Stores old values by their keys ("sync:config", "local:inbox"), as the old extension did. */
const seed = (values: Record<string, unknown>) =>
  Promise.all(
    (["local", "sync"] as const).map((area) =>
      fakeBrowser.storage[area].set(
        Object.fromEntries(
          Object.entries(values)
            .filter(([key]) => key.startsWith(`${area}:`))
            .map(([key, value]) => [key.slice(area.length + 1), value]),
        ),
      ),
    ),
  );

describe("moving the old settings", () => {
  it("keeps a reviewer's filters, notifications, lists and review times, as the app reads them", () => {
    const { config, dropped } = configFrom(ANA);
    expect(config.filters).toMatchObject([
      { id: "frontend", name: "Frontend", include: "\\.(ts|tsx)$", exclude: "\\.test\\.", repos: [] },
      { id: "backend", name: "Backend", include: "\\.py$", exclude: "", repos: [] },
      { id: "styles", name: "Styles", include: "\\.css$", exclude: "", repos: ["acme/web"] },
      // Two with one id would be one filter: the second gets its own.
      { name: "Docs", include: "\\.md$", exclude: "", repos: ["acme/*"] },
    ]);
    expect(config.filters?.[3]?.id).not.toBe("frontend");
    const [review, involved, authored] = config.queues;
    expect(review).toMatchObject({
      kind: "review",
      name: "Review",
      notify: ["new", "rerequest", "ready"],
      notifyAt: "review",
      notifyLeaveOut: ["drafts", "approved"],
      notifyRepos: ["acme/web"],
      repos: ["acme/web", "acme/api"],
      directOnly: true,
    });
    expect(involved).toMatchObject({
      kind: "involved",
      notify: ["mention"],
      notifyAt: "now",
      notifyLeaveOut: ["bots"],
      notifyRepos: ["acme/docs"],
    });
    // Approved and changes requested don't pick repositories of their own: the general ones.
    expect(authored).toMatchObject({
      kind: "authored",
      notify: ["comment", "reply", "approved", "changes", "mention"],
      notifyLeaveOut: ["bots"],
      notifyRepos: ["acme/web"],
    });
    expect(config).toMatchObject({ pollSeconds: 300, sound: true, theme: "system", language: "system" });
    expect(config.reviewTime).toEqual({
      enabled: true,
      sessions: [
        {
          id: "morning",
          name: "Mornings",
          on: true,
          days: [1, 3, 5],
          times: ["09:00", "11:00", "13:00"],
          minutes: 45,
          order: "fill",
          queues: [],
          drafts: true,
        },
        {
          id: "late",
          name: "",
          on: false,
          days: [1, 2, 3, 4, 5],
          times: ["16:00", "17:30"],
          minutes: 240,
          order: "quickest",
          queues: [],
          drafts: false,
        },
      ],
      againFirst: false,
      remindEnd: true,
      skipEmpty: false,
      holdWhileReviewing: true,
    });
    expect(dropped.toSorted()).toEqual(["reviewFilters", "reviewPace", "reviewRepos"]);
    // The app reads it as it is.
    const read = normalize(config);
    expect(read.queues).toEqual(config.queues);
    expect(read.filters).toEqual(config.filters);
    expect(read.reviewTime).toEqual(config.reviewTime);
    expect(read).toMatchObject({ pollSeconds: 300, sound: true, actions: [] });
  });

  it("leaves notifications off, and the app's own filters, for a reader who changed nothing", () => {
    const { config, dropped } = configFrom({ "sync:popup": { repos: [], excludeRepos: [], teams: true } });
    expect(config.filters).toBeUndefined();
    expect(config.queues.map((q) => q.notify)).toEqual([[], [], []]);
    expect(config.queues[0]).toMatchObject({ directOnly: false, notifyAt: "review", repos: [] });
    expect(config).toMatchObject({ pollSeconds: 120, sound: false });
    expect(config.reviewTime).toMatchObject({ enabled: false, sessions: [], againFirst: true, skipEmpty: true });
    expect(dropped).toEqual([]);
    expect(normalize(config).filters.length).toBeGreaterThan(0);
  });

  it("takes the old defaults for events never changed, and names what had nowhere to go", () => {
    const { config, dropped } = configFrom({
      "sync:config": {
        global: [{ name: "  " }, "nope", { id: "bad id!", name: "Code" }],
        repos: [{ repo: "group/sub/name", filters: [{ name: "Deep" }] }, { repo: "a/b", filters: [] }, "x"],
      },
      "sync:appearance": { theme: "mine", themes: [{ id: "mine", name: "Mine", colors: {} }] },
      "sync:notifications": {
        enabled: true,
        excludeRepos: ["acme/legacy"],
        events: { "review-requested": "broken" },
        interval: 30,
        quiet: { on: true },
        delivery: { grouped: true, sound: { id: "none" } },
      },
      "sync:popup": { repos: ["acme/web, acme/api group/sub/x"], excludeRepos: ["acme/old"] },
      "sync:reviewTime": {
        enabled: true,
        sessions: [
          {
            id: "a",
            repeat: "every",
            every: 9,
            from: "bad",
            to: "bad",
            minutes: "x",
            order: "random",
            excludeRepos: ["acme/x"],
          },
          { id: "a", days: "weekdays", times: ["08:00"], minutes: 1 },
        ],
        opens: "all",
        sound: { id: "none" },
      },
    });
    expect(config.filters).toMatchObject([{ name: "Code", include: "", exclude: "", repos: [] }]);
    expect(config.filters?.[0]?.id).toMatch(/^[\w-]+$/u);
    // Events the reader never changed: the old defaults (asked to review, ready, on yours, approved, changes).
    expect(config.queues.map((q) => q.notify)).toEqual([
      ["new", "rerequest", "ready"],
      [],
      ["comment", "reply", "approved", "changes"],
    ]);
    expect(config.queues[0]?.repos).toEqual(["acme/web", "acme/api"]);
    expect(config).toMatchObject({ pollSeconds: 900, sound: false });
    const [every, other] = config.reviewTime.sessions;
    expect(every).toMatchObject({
      id: "a",
      times: ["09:00", "11:00", "13:00", "15:00", "17:00"],
      minutes: 30,
      order: "oldest",
      days: [1, 2, 3, 4, 5],
    });
    expect(other).toMatchObject({ times: ["08:00"], minutes: 5 });
    expect(other?.id).not.toBe("a");
    expect(dropped.toSorted()).toEqual([
      "delivery",
      "excludeRepos",
      "quietHours",
      "repoFilters",
      "reviewOpens",
      "reviewRepos",
      "themes",
    ]);
  });

  it("makes no notifications of events turned on while notifications were off, and reads nothing from broken values", () => {
    const { config } = configFrom({
      "sync:notifications": { enabled: false, events: { mention: { on: true } } },
      "sync:config": "broken",
      "sync:reviewTime": { sessions: "broken", pace: "steady", perPull: 0, opens: "first" },
    });
    expect(config.queues.map((q) => q.notify)).toEqual([[], [], []]);
    expect(config.filters).toBeUndefined();
    expect(config.reviewTime).toMatchObject({ enabled: false, sessions: [] });
  });

  it("gives a session without a usable id one of its own, and a review time's sound its old default", () => {
    const { config } = configFrom({ "sync:reviewTime": { enabled: true, sessions: [{ id: "bad id!" }], sound: {} } });
    const [session] = config.reviewTime.sessions;
    expect(session?.id).toMatch(/^[\w-]+$/u);
    expect(session?.id).not.toBe("bad id!");
    expect(config.sound).toBe(true);
  });

  it("names the queues in the browser's language", () => {
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "pt-BR" });
    expect(configFrom({}).config.queues.map((q) => q.name)).toEqual(["Revisar", "Novidades", "Meus PRs"]);
  });
});

describe("migrate", () => {
  it("moves the old settings once, then forgets them", async () => {
    await seed({ ...ANA, "local:active": { "acme/web": ["frontend"] } });
    const moved = await migrate();
    expect(moved.migrated).toBe(true);
    expect(moved.dropped).toContain("reviewPace");
    const written: unknown = JSON.parse((await readAppFile("config"))!);
    const [frontend, backend, styles] = configFrom(ANA).config.filters!;
    expect(written).toMatchObject({
      version: 1,
      reviewTime: configFrom(ANA).config.reviewTime,
      filters: [frontend, backend, styles, expect.objectContaining({ name: "Docs" })],
      queues: [{ kind: "review" }, { kind: "involved" }, { kind: "authored" }],
    });
    expect(JSON.parse((await readAppFile("pace"))!)).toEqual({
      all: { actual: 30, expected: 20, files: 12 },
      kinds: { tests: { actual: 4, expected: 6, files: 3 } },
    });
    expect(await storage.getItems([...OLD_KEYS])).toEqual(OLD_KEYS.map((key) => ({ key, value: null })));
    // The filters picked per repository stay for the bar.
    expect(await storage.getItem("local:active")).toEqual({ "acme/web": ["frontend"] });
    expect(await storage.getItem(MIGRATED)).toBe(1);
    expect(await takeLegacyDone()).toEqual({ "https://github.com/acme/web/pull/7": "2026-03-02T10:00:00Z" });
    expect(await takeLegacyDone()).toBeNull();
    // Once only.
    await seed({ "sync:config": ANA["sync:config"] });
    expect(await migrate()).toEqual({ migrated: false, dropped: [] });
    expect(await storage.getItem("sync:config")).not.toBeNull();
  });

  it("has nothing to move on a fresh install", async () => {
    expect(await migrate()).toEqual({ migrated: false, dropped: [] });
    expect(await readAppFile("config")).toBeNull();
    expect(await storage.getItem(MIGRATED)).toBe(1);
  });

  it("never replaces a setup or a pace already made with the new version", async () => {
    await writeAppFile("config", '{"version":1}');
    await writeAppFile("pace", '{"all":{"actual":1,"expected":1,"files":1},"kinds":{}}');
    await seed({
      "sync:config": ANA["sync:config"],
      "local:learnedPace": ANA["local:learnedPace"],
      "sync:inboxDone": { u: 3 },
    });
    expect((await migrate()).migrated).toBe(true);
    expect(await readAppFile("config")).toBe('{"version":1}');
    expect(await readAppFile("pace")).toContain('"actual":1,');
    expect(await storage.getItem(LEGACY_DONE)).toBeNull();
  });
});

describe("pull requests marked done", () => {
  it("come off their queues while nothing happened on them since", () => {
    const done = {
      "https://github.com/acme/web/pull/7": "2026-03-02T10:00:00Z",
      "https://github.com/acme/web/pull/8": "2026-03-01T00:00:00Z",
    };
    const pr = (id: string, n: number, updatedAt: string) => ({
      id,
      url: `https://github.com/acme/web/pull/${n}`,
      updatedAt,
    });
    expect(
      legacyDismissals(done, [
        { queueId: "review", pr: pr("PR_7", 7, "2026-03-02T10:00:00Z") },
        { queueId: "updates", pr: pr("PR_7", 7, "2026-03-02T10:00:00Z") },
        { queueId: "review", pr: pr("PR_8", 8, "2026-03-05T00:00:00Z") },
        { queueId: "review", pr: pr("PR_9", 9, "2026-01-01T00:00:00Z") },
      ]),
    ).toEqual([
      ["review", "PR_7"],
      ["updates", "PR_7"],
    ]);
  });
});
