import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import type { play } from "@/utils/background-sound/background-sound";
import { samplePull } from "@/utils/github-sample-pull/github-sample-pull";
import type { checkInbox, CheckResult } from "@/utils/inbox-check/inbox-check";
import {
  DEFAULT_NOTIFY,
  EVENT_KINDS,
  type InboxEvent,
  type InboxSnapshot,
  type NotifySettings,
} from "@/utils/inbox/inbox";
import type { Message } from "@/utils/messages/messages";
import type { readBranches } from "@/utils/pull-branches/pull-branches";
import { recordOf } from "@/utils/record/record";
import type {
  endRun,
  hold,
  holding,
  initReviewTime,
  onReviewAlarm,
  onReviewNotification,
  openPull,
  readQueueFiles,
  recoverReviewTime,
  runBadge,
  scheduleReviewTime,
  snoozeRun,
  startNow,
  startRun,
} from "@/utils/review-scheduler/review-scheduler";
import {
  doneItem,
  ignoredItem,
  inboxItem,
  inboxMemoryItem,
  notificationLinksItem,
  notifyItem,
  popupItem,
  queueHistoryItem,
  reviewSkipItem,
  reviewTimeItem,
  updateItem,
} from "@/utils/storage/storage";

type Hooks = Parameters<typeof initReviewTime>[0];

const mocks = vi.hoisted(() => ({
  checkInbox: vi.fn<typeof checkInbox>(),
  play: vi.fn<typeof play>(),
  readBranches: vi.fn<typeof readBranches>(),
  scheduler: {
    endRun: vi.fn<typeof endRun>(),
    hold: vi.fn<typeof hold>(),
    holding: vi.fn<typeof holding>(),
    initReviewTime: vi.fn<typeof initReviewTime>(),
    onReviewAlarm: vi.fn<typeof onReviewAlarm>(),
    onReviewNotification: vi.fn<typeof onReviewNotification>(),
    openPull: vi.fn<typeof openPull>(),
    readQueueFiles: vi.fn<typeof readQueueFiles>(),
    recoverReviewTime: vi.fn<typeof recoverReviewTime>(),
    runBadge: vi.fn<typeof runBadge>(),
    scheduleReviewTime: vi.fn<typeof scheduleReviewTime>(),
    snoozeRun: vi.fn<typeof snoozeRun>(),
    startNow: vi.fn<typeof startNow>(),
    startRun: vi.fn<typeof startRun>(),
  },
}));

vi.mock(import("@/utils/inbox-check/inbox-check"), async (original) => ({
  ...(await original()),
  checkInbox: mocks.checkInbox,
}));
vi.mock(import("@/utils/background-sound/background-sound"), async (original) => ({
  ...(await original()),
  play: mocks.play,
}));
vi.mock(import("@/utils/review-scheduler/review-scheduler"), () => mocks.scheduler);
vi.mock(import("@/utils/pull-branches/pull-branches"), async (original) => ({
  ...(await original()),
  readBranches: mocks.readBranches,
}));

const { scheduler } = mocks;
/** Friday 9 October 2026, 10:00 local time. */
const NOW = new Date(2026, 9, 9, 10).getTime();

const create = vi.fn<(id: string, options: Browser.notifications.NotificationCreateOptions) => Promise<string>>();
const clear = vi.fn<(id: string) => Promise<boolean>>();
/** The notifications shown, as their ids and what they say, and the ones cleared. */
const created = () => create.mock.calls;
const cleared = () => clear.mock.calls.map(([id]) => id);
const contains = vi.fn<(permissions: unknown) => Promise<boolean>>();
const tabMessages = vi.fn<(tabId: number, message: unknown) => Promise<unknown>>();
/** An event the fake browser doesn't have, to fire by hand. */
const fakeEvent = <T extends unknown[]>() => {
  let listeners: ((...args: T) => unknown)[] = [];
  return {
    addListener: (listener: (...args: T) => unknown) => {
      listeners.push(listener);
    },
    trigger: async (...args: T) => {
      await Promise.all(listeners.map((listener) => listener(...args)));
    },
    reset: () => {
      listeners = [];
    },
  };
};
const permissionsAdded = fakeEvent<[]>();
const commandGiven = fakeEvent<[string, Partial<Browser.tabs.Tab> | undefined]>();
let hooks: Hooks;

const snapshot = (extra: Partial<InboxSnapshot> = {}): InboxSnapshot => ({
  me: "me",
  reviews: [samplePull(1), samplePull(2)],
  mine: [samplePull(3, { author: "me" })],
  checkedAt: NOW,
  problem: null,
  ...extra,
});
/** What happened on a sample pull request: by default, a comment on one of the reader's. */
const event = (number: number, extra: Partial<InboxEvent> = {}): InboxEvent => {
  const { repo, title, url } = samplePull(number);
  return {
    repo,
    title,
    url,
    number,
    kind: "comment-mine",
    actor: "ada",
    bot: false,
    draft: false,
    approvedByMe: false,
    team: false,
    again: false,
    excerpt: "",
    ...extra,
  };
};
const result = (extra: Partial<CheckResult> = {}): CheckResult => ({
  snapshot: snapshot(),
  memory: { threads: {}, reviews: [] },
  events: [],
  ...extra,
});
const enabled = (extra: Partial<NotifySettings> = {}): NotifySettings => ({
  ...DEFAULT_NOTIFY,
  enabled: true,
  ...extra,
});

const alarm = (name: string): Browser.alarms.Alarm => ({ name, scheduledTime: NOW, persistAcrossSessions: false });

/** Lets what a listener started, without waiting on it, run to its end. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** The badge, its colour as `#rrggbb`. */
const badge = async () => ({
  text: await fakeBrowser.action.getBadgeText({}),
  color: `#${(await fakeBrowser.action.getBadgeBackgroundColor({}))
    .slice(0, 3)
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`,
});
const openTabs = async () => (await fakeBrowser.tabs.query({})).flatMap((tab) => tab.url ?? []);

/** A fresh background, its state and listeners its own. */
const start = async () => {
  vi.resetModules();
  const { startBackground } = await import("./background");
  startBackground();
  hooks = scheduler.initReviewTime.mock.calls.at(-1)![0];
};

const message = async (sent: Message | null) => {
  const answers: unknown[] = [];
  const kept = await fakeBrowser.runtime.onMessage.trigger(sent, {}, (answer: unknown) => {
    answers.push(answer);
  });
  await settle();
  return { kept: kept[0] as unknown, answers };
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("FIREFOX", "");
  contains.mockResolvedValue(true);
  tabMessages.mockResolvedValue(null);
  permissionsAdded.reset();
  commandGiven.reset();
  Object.assign(fakeBrowser.permissions, { contains, onAdded: permissionsAdded });
  Object.assign(fakeBrowser.commands, { onCommand: commandGiven });
  Object.assign(fakeBrowser.tabs, { sendMessage: tabMessages });
  Object.assign(fakeBrowser.runtime, { getManifest: () => ({ version: "1.3.0" }) });
  create.mockReset();
  create.mockImplementation((id) => Promise.resolve(id));
  clear.mockReset();
  clear.mockResolvedValue(true);
  Object.assign(fakeBrowser.notifications, { create, clear });
  mocks.checkInbox.mockResolvedValue(result());
  mocks.play.mockResolvedValue();
  scheduler.runBadge.mockResolvedValue(null);
  scheduler.holding.mockResolvedValue(() => null);
  scheduler.hold.mockResolvedValue();
  scheduler.readQueueFiles.mockResolvedValue();
  scheduler.recoverReviewTime.mockResolvedValue();
  scheduler.scheduleReviewTime.mockResolvedValue();
  scheduler.onReviewAlarm.mockResolvedValue(false);
  scheduler.onReviewNotification.mockResolvedValue(false);
  scheduler.startNow.mockResolvedValue(true);
  scheduler.startRun.mockResolvedValue();
  scheduler.snoozeRun.mockResolvedValue();
  scheduler.endRun.mockResolvedValue();
  scheduler.openPull.mockResolvedValue();
  await start();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("installing and starting", () => {
  it("welcomes a new reader, and sets up the looks and review time", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install" });
    await settle();
    expect(await openTabs()).toEqual(["chrome-extension://test-extension-id/welcome.html"]);
    expect(scheduler.recoverReviewTime).toHaveBeenCalled();
    expect(await badge()).toEqual({ text: "", color: "#1f6feb" });
  });

  it("tells about a new minor or major version, not a patch", async () => {
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", previousVersion: "1.3.0" });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", previousVersion: "" });
    await settle();
    expect(await updateItem.getValue()).toBeNull();
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", previousVersion: "1.2.9" });
    await settle();
    expect(await updateItem.getValue()).toBe("1.3.0");
    expect(await openTabs()).toEqual([]);
  });

  it("sets the looks up again when the browser starts", async () => {
    await notifyItem.setValue(enabled({ interval: 5 }));
    await fakeBrowser.runtime.onStartup.trigger();
    await settle();
    expect((await fakeBrowser.alarms.get("inbox"))?.periodInMinutes).toBe(5);
    expect(mocks.checkInbox).toHaveBeenCalledTimes(1);
    expect(scheduler.recoverReviewTime).toHaveBeenCalled();
  });
});

describe("scheduling the looks", () => {
  it("looks every few minutes while on, keeping an alarm that's already right", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    expect((await fakeBrowser.alarms.get("inbox"))?.periodInMinutes).toBe(2);
    const setAlarm = vi.spyOn(fakeBrowser.alarms, "create");
    await notifyItem.setValue(enabled({ quiet: { ...DEFAULT_NOTIFY.quiet, on: true } }));
    await settle();
    expect(setAlarm).not.toHaveBeenCalled();
    expect(mocks.checkInbox).toHaveBeenCalledTimes(2);
  });

  it("stops, forgets what it saw and clears the count when turned off", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    await inboxMemoryItem.setValue({ threads: { a: "b" }, reviews: [] });
    await notifyItem.setValue(DEFAULT_NOTIFY);
    await settle();
    expect(await fakeBrowser.alarms.get("inbox")).toBeUndefined();
    expect(await inboxMemoryItem.getValue()).toBeNull();
    expect((await badge()).text).toBe("");
  });

  it("forgets what it saw while on but told of nothing, so turning an event on doesn't bring up everything since", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    await inboxMemoryItem.setValue({ threads: { a: "b" }, reviews: [] });
    const events = recordOf(EVENT_KINDS, (kind) => ({ ...DEFAULT_NOTIFY.events[kind], on: false }));
    // Told of nothing, a look reads only the lists, and leaves what was seen as it was.
    mocks.checkInbox.mockResolvedValue(result({ memory: null }));
    await notifyItem.setValue(enabled({ events }));
    await settle();
    expect(await inboxMemoryItem.getValue()).toBeNull();
    expect((await fakeBrowser.alarms.get("inbox"))?.periodInMinutes).toBe(2);
  });

  it("looks on its alarm, and leaves the others to review time", async () => {
    await fakeBrowser.alarms.onAlarm.trigger(alarm("inbox"));
    await settle();
    expect(mocks.checkInbox).toHaveBeenCalledTimes(1);
    const tick = alarm("review-time:tick");
    await fakeBrowser.alarms.onAlarm.trigger(tick);
    expect(scheduler.onReviewAlarm).toHaveBeenCalledWith(tick);
  });

  it("sets review time again when its settings or skip change", async () => {
    await reviewTimeItem.setValue({ ...(await reviewTimeItem.getValue()), enabled: true });
    await reviewSkipItem.setValue(NOW);
    await settle();
    expect(scheduler.scheduleReviewTime).toHaveBeenCalledTimes(2);
  });
});

describe("a look", () => {
  const look = async () => {
    await fakeBrowser.alarms.onAlarm.trigger(alarm("inbox"));
    await settle();
  };

  it("stores the lists, what it saw, and counts what waits for the reader's review", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    mocks.checkInbox.mockClear();
    mocks.checkInbox.mockResolvedValue(
      result({
        snapshot: snapshot({
          reviews: [samplePull(1), samplePull(2, { draft: true }), samplePull(4), samplePull(5, { repo: "octo/old" })],
        }),
      }),
    );
    await doneItem.setValue({
      [samplePull(4).url]: "2026-10-09T00:00:00Z",
      [samplePull(9).url]: "2026-10-09T00:00:00Z",
    });
    await popupItem.setValue({ repos: [], excludeRepos: ["octo/old"], teams: true, updates: false, merged: false });
    await settle();
    await look();
    expect(mocks.checkInbox.mock.calls[0]?.[1].enabled).toBe(true);
    expect(mocks.checkInbox.mock.calls[0]?.[3]).toEqual({ skipTeams: false, updates: false, merged: false });
    expect((await inboxItem.getValue())?.reviews).toHaveLength(4);
    expect(await inboxMemoryItem.getValue()).toEqual({ threads: {}, reviews: [] });
    expect(await badge()).toEqual({ text: "1", color: "#1f6feb" });
    // A mark is let go once its pull request is off the lists.
    expect(Object.keys(await doneItem.getValue())).toEqual([samplePull(4).url]);
    expect(scheduler.readQueueFiles).toHaveBeenCalledWith((await inboxItem.getValue())?.reviews);
  });

  it("reads the lists the reader added, keeps one that failed as it was, and lets go of marks off the lists", async () => {
    const [one, two, three] = [samplePull(1), samplePull(2), samplePull(3)];
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: true, updates: true, merged: true });
    await settle();
    await inboxItem.setValue(snapshot({ updates: [one], merged: [two] }));
    await ignoredItem.setValue({ updates: [one.url, three.url], merged: [two.url], reviews: [one.url] });
    mocks.checkInbox.mockClear();
    mocks.checkInbox.mockResolvedValue(result({ snapshot: snapshot({ updates: [one, three] }) }));
    await look();
    expect(mocks.checkInbox.mock.calls[0]?.[3]).toEqual({ skipTeams: false, updates: true, merged: true });
    expect(await inboxItem.getValue()).toMatchObject({ updates: [one, three], merged: [two] });
    expect(await ignoredItem.getValue()).toEqual({
      reviews: [one.url],
      updates: [one.url, three.url],
      merged: [two.url],
    });
    expect(mocks.readBranches).toHaveBeenCalledWith([snapshot().reviews, snapshot().mine, [one, three], [two]]);

    // Taken away, a list isn't kept, nor are its marks.
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: true, updates: false, merged: false });
    mocks.checkInbox.mockResolvedValue(result());
    await look();
    expect((await inboxItem.getValue())?.updates).toBeUndefined();
    expect(await ignoredItem.getValue()).toEqual({ reviews: [one.url] });
  });

  it("keeps the done marks when none are let go", async () => {
    await doneItem.setValue({ [samplePull(1).url]: "2026-10-09T00:00:00Z" });
    const write = vi.spyOn(doneItem, "setValue");
    await look();
    expect(write).not.toHaveBeenCalled();
  });

  it("marks a pull request back on the queue as asked again, and a request for it as one to review again", async () => {
    await inboxItem.setValue(snapshot({ reviews: [samplePull(1)] }));
    await queueHistoryItem.setValue({ [samplePull(2).url]: { left: NOW - 1000 } });
    await notifyItem.setValue(enabled());
    await settle();
    create.mockClear();
    mocks.checkInbox.mockResolvedValue(result({ events: [event(2, { kind: "review-requested" })] }));
    await look();
    expect((await inboxItem.getValue())?.reviews.map((pull) => Boolean(pull.again))).toEqual([false, true]);
    expect(created()[0]?.[1].title).toBe("ada asked you to review again");
  });

  it("compares against nothing when the last look found the reader signed out", async () => {
    await inboxItem.setValue(snapshot({ reviews: [], problem: "signed-out" }));
    await queueHistoryItem.setValue({ [samplePull(2).url]: { left: NOW - 1000 } });
    await look();
    expect((await inboxItem.getValue())?.reviews.map((pull) => Boolean(pull.again))).toEqual([false, true]);
  });

  it("keeps the last lists when GitHub couldn't be read, saying so", async () => {
    await inboxItem.setValue(snapshot({ checkedAt: NOW - 60_000 }));
    await inboxMemoryItem.setValue({ threads: { a: "b" }, reviews: [] });
    mocks.checkInbox.mockResolvedValue(
      result({ snapshot: snapshot({ reviews: [], problem: "offline" }), memory: null }),
    );
    await look();
    expect(await inboxItem.getValue()).toEqual(snapshot({ checkedAt: NOW - 60_000, problem: "offline" }));
    expect(await inboxMemoryItem.getValue()).toEqual({ threads: { a: "b" }, reviews: [] });
    expect(scheduler.readQueueFiles).not.toHaveBeenCalled();
  });

  it("stores what it found when there were no lists to keep", async () => {
    mocks.checkInbox.mockResolvedValue(result({ snapshot: snapshot({ reviews: [], problem: "offline" }) }));
    await look();
    expect((await inboxItem.getValue())?.problem).toBe("offline");
  });

  it("warns on the icon when the reader is signed out, and drops the lists", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    await inboxItem.setValue(snapshot());
    mocks.checkInbox.mockResolvedValue(result({ snapshot: snapshot({ reviews: [], problem: "signed-out" }) }));
    await look();
    expect((await inboxItem.getValue())?.reviews).toEqual([]);
    expect(await badge()).toEqual({ text: "!", color: "#d29922" });
  });

  it("shows no count while notifications are off", async () => {
    await look();
    expect((await badge()).text).toBe("");
  });

  it("is one look when asked again while it's running", async () => {
    await Promise.all([
      fakeBrowser.alarms.onAlarm.trigger(alarm("inbox")),
      fakeBrowser.alarms.onAlarm.trigger(alarm("inbox")),
    ]);
    await settle();
    expect(mocks.checkInbox).toHaveBeenCalledTimes(1);
  });

  it("keeps what waits for review time, and shows the rest", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    create.mockClear();
    scheduler.holding.mockResolvedValue((when) => (when === "review" ? "review" : null));
    mocks.checkInbox.mockResolvedValue(
      result({ events: [event(1, { kind: "review-requested" }), event(2, { kind: "approved" })] }),
    );
    await look();
    expect(scheduler.hold).toHaveBeenCalledWith([
      { ...event(1, { kind: "review-requested" }), until: "review", heldAt: NOW },
    ]);
    expect(created().map(([, options]) => options.title)).toEqual(["ada approved your pull request"]);
  });

  it("shows nothing in quiet hours, or when notifications are off", async () => {
    mocks.checkInbox.mockResolvedValue(result({ events: [event(1)] }));
    await look();
    await notifyItem.setValue(enabled({ quiet: { on: true, from: "09:00", to: "17:00", weekends: false } }));
    await settle();
    await look();
    expect(created()).toEqual([]);
  });

  it("reads only the lists for the popup, leaving out their teams' when the queue does", async () => {
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: false, updates: false, merged: false });
    await settle();
    await message({ type: "inbox-refresh" });
    expect(mocks.checkInbox.mock.calls.at(-1)?.[1].enabled).toBe(false);
    expect(mocks.checkInbox.mock.calls.at(-1)?.[3]).toEqual({ skipTeams: true, updates: false, merged: false });
  });
});

describe("notifications", () => {
  const show = async (events: InboxEvent[], settings: NotifySettings = enabled()) => {
    await notifyItem.setValue(settings);
    await settle();
    create.mockClear();
    mocks.checkInbox.mockResolvedValue(result({ events }));
    await fakeBrowser.alarms.onAlarm.trigger(alarm("inbox"));
    await settle();
  };

  it("titles each kind of event by who did it", async () => {
    await show([
      event(1, { kind: "review-requested" }),
      event(2, { kind: "review-requested", team: true }),
      event(3, { kind: "ready-for-review" }),
      event(4, { kind: "comment-reviewing", actor: "" }),
    ]);
    await show([event(5, { kind: "mention" }), event(6, { kind: "changes-requested" }), event(7)]);
    expect(created().map(([, options]) => options.title)).toEqual([
      "ada mentioned you",
      "ada requested changes on your pull request",
      "ada commented on your pull request",
    ]);
  });

  it("opens a request on its files, and anything else where it happened", async () => {
    await show([
      event(1, { kind: "review-requested" }),
      event(2, { kind: "review-requested", team: true }),
      event(3, { kind: "ready-for-review", excerpt: "Ready now" }),
      event(4, { kind: "comment-reviewing", actor: "", excerpt: "Looks good" }),
    ]);
    expect(created().map(([, options]) => [options.title, options.message, options.contextMessage])).toEqual([
      ["ada asked for your review", "Pull request 1", "octo/web#1"],
      ["ada asked your team for a review", "Pull request 2", "octo/web#2"],
      ["ada’s pull request is ready for your review", "“Ready now”", "octo/web#3 · Pull request 3"],
      ["octo/web commented on a pull request you review", "“Looks good”", "octo/web#4 · Pull request 4"],
    ]);
    const links = await notificationLinksItem.getValue();
    expect(Object.values(links)).toEqual([
      `${samplePull(1).url}/changes`,
      `${samplePull(2).url}/changes`,
      `${samplePull(3).url}/changes`,
      samplePull(4).url,
    ]);
    expect(created()[0]?.[1]).toMatchObject({ silent: true, requireInteraction: false });
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it("says how many more there are past four", async () => {
    await show([1, 2, 3, 4, 5, 6].map((number) => event(number)));
    expect(created()).toHaveLength(5);
    expect(created()[4]?.[0]).toMatch(/^inbox:more:/u);
    expect(created()[4]?.[1].title).toContain("2 more");
    expect(Object.values(await notificationLinksItem.getValue()).at(-1)).toBe("https://github.com/notifications");
  });

  it("groups them in one, a line each, when asked", async () => {
    const delivery = { ...DEFAULT_NOTIFY.delivery, grouped: true };
    await show([event(1), event(2, { excerpt: "Nice" })], enabled({ delivery }));
    expect(created()).toHaveLength(1);
    expect(created()[0]?.[1].title).toContain("2 updates");
    expect(created()[0]?.[1].message).toBe(
      "ada commented on your pull request: Pull request 1\nada commented on your pull request: “Nice”",
    );
    // One alone shows as itself.
    await show([event(3)], enabled({ delivery }));
    expect(created()[0]?.[0]).toMatch(/^inbox:comment-mine:/u);
  });

  it("keeps the links of the latest fifty", async () => {
    await notificationLinksItem.setValue(
      Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`old:${index}`, "x"])),
    );
    await show([event(1)]);
    const links = Object.keys(await notificationLinksItem.getValue());
    expect(links).toHaveLength(50);
    expect(links.at(-1)).toMatch(/^inbox:comment-mine:/u);
  });

  it("asks Firefox for nothing it can't do, and puts the pull request in the message", async () => {
    vi.stubEnv("FIREFOX", "true");
    await show([event(1, { excerpt: "Nice" }), event(2)]);
    expect(created().map(([, options]) => options)).toEqual([
      {
        type: "basic",
        iconUrl: "chrome-extension://test-extension-id/icon/128.png",
        title: "ada commented on your pull request",
        message: "“Nice”\nPull request 1",
      },
      {
        type: "basic",
        iconUrl: "chrome-extension://test-extension-id/icon/128.png",
        title: "ada commented on your pull request",
        message: "Pull request 2",
      },
    ]);
  });

  it("shows none without the permission, or where the browser has none", async () => {
    contains.mockResolvedValue(false);
    await show([event(1)]);
    const { notifications } = fakeBrowser;
    Object.assign(fakeBrowser, { notifications: undefined });
    try {
      await show([event(2)]);
    } finally {
      Object.assign(fakeBrowser, { notifications });
    }
    expect(created()).toEqual([]);
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it("opens what a notification is about when clicked, unless it's review time's", async () => {
    await show([event(1)]);
    const [id] = created()[0]!;
    await fakeBrowser.notifications.onClicked.trigger(id);
    await settle();
    expect(await openTabs()).toEqual([samplePull(1).url]);
    expect(cleared()).toEqual([id]);
    await fakeBrowser.notifications.onClicked.trigger("gone");
    await settle();
    expect(await openTabs()).toHaveLength(1);
    expect(cleared()).toEqual([id, "gone"]);
    scheduler.onReviewNotification.mockResolvedValue(true);
    await fakeBrowser.notifications.onClicked.trigger("review-time:offer");
    await settle();
    expect(cleared()).toEqual([id, "gone"]);
  });

  it("hands review time's buttons to it", async () => {
    await fakeBrowser.notifications.onButtonClicked.trigger("review-time:offer", 1);
    expect(scheduler.onReviewNotification).toHaveBeenCalledWith("review-time:offer", 1);
  });

  it("listens once notifications are allowed, and only once", async () => {
    const { notifications } = fakeBrowser;
    Object.assign(fakeBrowser, { notifications: undefined });
    try {
      await start();
    } finally {
      Object.assign(fakeBrowser, { notifications });
    }
    const listen = vi.spyOn(fakeBrowser.notifications.onClicked, "addListener");
    await permissionsAdded.trigger();
    await permissionsAdded.trigger();
    expect(listen).toHaveBeenCalledTimes(1);
  });

  it("shows what was kept while reviewing once the time's up, unless it's quiet or they're off", async () => {
    expect(await hooks.release([event(1)])).toBe(true);
    expect(created()).toEqual([]);
    await notifyItem.setValue(enabled({ quiet: { on: true, from: "09:00", to: "17:00", weekends: false } }));
    await settle();
    expect(await hooks.release([event(1)])).toBe(false);
    await notifyItem.setValue(enabled());
    await settle();
    create.mockClear();
    expect(await hooks.release([event(1)])).toBe(true);
    expect(created()).toHaveLength(1);
  });
});

describe("the icon", () => {
  it("counts down review time instead while one is under way", async () => {
    scheduler.runBadge.mockResolvedValue({ text: "12m", color: "#1a7f37" });
    await hooks.updateBadge();
    expect(await badge()).toEqual({ text: "12m", color: "#1a7f37" });
  });

  it("counts again when the reader marks one done", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    await inboxItem.setValue(snapshot());
    await doneItem.setValue({ [samplePull(1).url]: "2026-10-09T00:00:00Z" });
    await settle();
    expect((await badge()).text).toBe("1");
  });

  it("counts again for the popup's repositories, and reads the lists again when its teams are left out", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    mocks.checkInbox.mockClear();
    await inboxItem.setValue(snapshot());
    await popupItem.setValue({ repos: ["octo/other"], excludeRepos: [], teams: true, updates: false, merged: false });
    await settle();
    expect((await badge()).text).toBe("");
    expect(mocks.checkInbox).not.toHaveBeenCalled();
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: false, updates: false, merged: false });
    await settle();
    expect(mocks.checkInbox).toHaveBeenCalledTimes(1);
    // A list added is read at once, to have it there.
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: false, updates: true, merged: false });
    await settle();
    await popupItem.setValue({ repos: [], excludeRepos: [], teams: false, updates: true, merged: true });
    await settle();
    expect(mocks.checkInbox).toHaveBeenCalledTimes(3);
  });

  it("counts again when the reader ignores one", async () => {
    await notifyItem.setValue(enabled());
    await settle();
    await inboxItem.setValue(snapshot());
    await ignoredItem.setValue({ reviews: [samplePull(1).url] });
    await settle();
    expect((await badge()).text).toBe("1");
  });
});

describe("the popup's refresh", () => {
  it("reads the lists for review time too", async () => {
    await hooks.refreshLists();
    expect(mocks.checkInbox).toHaveBeenCalledTimes(1);
  });

  it("puts review time right, then reads the lists unless they're fresh, and answers", async () => {
    await inboxItem.setValue(snapshot({ checkedAt: NOW - 10_000 }));
    const { kept, answers } = await message({ type: "inbox-refresh" });
    expect(kept).toBe(true);
    expect(answers).toEqual([true]);
    expect(scheduler.recoverReviewTime).toHaveBeenCalled();
    expect(mocks.checkInbox).not.toHaveBeenCalled();
    await inboxItem.setValue(snapshot({ checkedAt: NOW - 60_000 }));
    await message({ type: "inbox-refresh" });
    await inboxItem.setValue(snapshot({ problem: "offline" }));
    await message({ type: "inbox-refresh" });
    expect(mocks.checkInbox).toHaveBeenCalledTimes(2);
  });

  it("answers false when reading the lists fails", async () => {
    mocks.checkInbox.mockRejectedValue(new Error("storage"));
    const { kept, answers } = await message({ type: "inbox-refresh" });
    expect(kept).toBe(true);
    expect(answers).toEqual([false]);
  });

  it("reads them when there are none, and waits for a look already running", async () => {
    await message({ type: "inbox-refresh" });
    expect(mocks.checkInbox).toHaveBeenCalledTimes(1);
    let finish: (value: CheckResult) => void = () => {};
    mocks.checkInbox.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await fakeBrowser.alarms.onAlarm.trigger(alarm("inbox"));
    const refreshing = message({ type: "inbox-refresh" });
    finish(result());
    const { answers } = await refreshing;
    expect(answers).toEqual([true]);
    expect(mocks.checkInbox).toHaveBeenCalledTimes(2);
  });
});

describe("messages", () => {
  it("opens settings on a repository, a section, or at the top", async () => {
    await message({ type: "open-options", repo: "octo/web" });
    await message({ type: "open-options", section: "notifications" });
    await message({ type: "open-options" });
    expect(await openTabs()).toEqual([
      "chrome-extension://test-extension-id/options.html#repo=octo%2Fweb",
      "chrome-extension://test-extension-id/options.html#notifications",
      "chrome-extension://test-extension-id/options.html",
    ]);
  });

  it("brings an open settings page forward instead", async () => {
    fakeBrowser.runtime.onMessage.addListener((sent: Message, _sender, respond) => {
      if (sent.type !== "show-options") return;
      respond(true);
      // oxlint-disable-next-line typescript/strict-void-return -- true keeps the channel open for the answer, as the browser asks.
      return true;
    });
    await message({ type: "open-options" });
    expect(await openTabs()).toEqual([]);
  });

  it("opens a tab when asking the open page fails", async () => {
    fakeBrowser.runtime.onMessage.addListener((sent: Message) => {
      if (sent.type === "show-options") throw new Error("gone");
    });
    await message({ type: "open-options" });
    expect(await openTabs()).toEqual(["chrome-extension://test-extension-id/options.html"]);
  });

  it("opens the welcome page", async () => {
    const { kept } = await message({ type: "open-welcome" });
    expect(kept).toBeUndefined();
    expect(await openTabs()).toEqual(["chrome-extension://test-extension-id/welcome.html"]);
  });

  it("runs review time from the popup, answering once done", async () => {
    scheduler.startNow.mockResolvedValue(false);
    expect((await message({ type: "review-start-now", minutes: 30, session: "s1" })).answers).toEqual([false]);
    expect(scheduler.startNow).toHaveBeenCalledWith(30, "s1");
    expect((await message({ type: "review-start" })).answers).toEqual([true]);
    expect(scheduler.startRun).toHaveBeenCalledWith({ fromPopup: true });
    await message({ type: "review-snooze" });
    expect(scheduler.snoozeRun).toHaveBeenCalled();
    await message({ type: "review-end" });
    await message({ type: "review-skip" });
    expect(scheduler.endRun.mock.calls).toEqual([["ended"], ["skipped"]]);
    await message({ type: "review-open", url: samplePull(1).url, repo: "octo/web" });
    expect(scheduler.openPull).toHaveBeenCalledWith(samplePull(1).url, "octo/web", false);
  });

  it("answers false when review time fails", async () => {
    scheduler.startRun.mockRejectedValue(new Error("storage"));
    const { kept, answers } = await message({ type: "review-start" });
    expect(kept).toBe(true);
    expect(answers).toEqual([false]);
  });

  it("leaves messages that aren't its own", async () => {
    expect((await message(null)).kept).toBeUndefined();
    expect((await message({ type: "play-sound", sound: "bowl", volume: 50 })).answers).toEqual([]);
  });
});

describe("keyboard shortcuts", () => {
  const command = async (name: string, tab?: Partial<Browser.tabs.Tab>) => {
    await commandGiven.trigger(name, tab);
    await settle();
  };

  it("sends a shortcut to the tab it was pressed in, or the active one", async () => {
    const query = vi.fn<(info: Browser.tabs.QueryInfo) => Promise<Partial<Browser.tabs.Tab>[]>>();
    Object.assign(fakeBrowser.tabs, { query });
    query.mockResolvedValue([{ id: 3 }]);
    await command("next-filter", { id: 7 });
    await command("show-all");
    query.mockResolvedValue([]);
    await command("show-all");
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(tabMessages.mock.calls).toEqual([
      [7, { type: "command", command: "next-filter" }],
      [3, { type: "command", command: "show-all" }],
    ]);
  });

  it("sends nothing for a shortcut it doesn't know, or without a tab", async () => {
    await command("launch-rockets", { id: 7 });
    await command("next-filter", {});
    expect(tabMessages).not.toHaveBeenCalled();
  });

  it("lets a tab that can't take it go", async () => {
    tabMessages.mockRejectedValue(new Error("no receiver"));
    await command("next-filter", { id: 7 });
    expect(tabMessages).toHaveBeenCalledTimes(1);
  });
});
