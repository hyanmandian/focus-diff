import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { play } from "@/utils/background-sound/background-sound";
import { fetchFiles, type PullRequest } from "@/utils/github-inbox/github-inbox";
import { samplePull } from "@/utils/github-sample-pull/github-sample-pull";
import type { HeldEvent, InboxEvent, InboxSnapshot } from "@/utils/inbox/inbox";
import {
  DEFAULT_REVIEW_TIME,
  newSession,
  type PullFile,
  type ReviewRun,
  type ReviewSession,
  type ReviewTimeSettings,
} from "@/utils/review-sessions/review-sessions";
import {
  configItem,
  doneItem,
  heldItem,
  inboxItem,
  popupItem,
  pullFilesItem,
  reviewRunItem,
  reviewSkipItem,
  reviewTimeItem,
  selectionsItem,
} from "@/utils/storage/storage";

import {
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
} from "./review-scheduler";

vi.mock(import("@/utils/github-inbox/github-inbox"), async (original) => ({
  ...(await original()),
  fetchFiles: vi.fn<typeof fetchFiles>(),
}));
vi.mock(import("@/utils/background-sound/background-sound"), async (original) => ({
  ...(await original()),
  play: vi.fn<typeof play>(),
}));

/** Friday 9 October 2026, 10:00 local time. */
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
const NOW = at(9, 10);
const MINUTE = 60_000;
const FILES: PullFile[] = [["src/app.ts", 100, 0, false]];

const hooks = {
  refreshLists: vi.fn<() => Promise<void>>(),
  updateBadge: vi.fn<() => Promise<void>>(),
  release: vi.fn<(events: InboxEvent[]) => Promise<boolean>>(),
};
const contains = vi.fn<(permissions: unknown) => Promise<boolean>>();
const created: [string, Browser.notifications.NotificationCreateOptions][] = [];
const cleared: string[] = [];

const session = (extra: Partial<ReviewSession> = {}): ReviewSession => ({
  ...newSession(),
  id: "s1",
  name: "Afternoon",
  ...extra,
});
const settings = (extra: Partial<ReviewTimeSettings> = {}, sessionExtra: Partial<ReviewSession> = {}) => ({
  ...DEFAULT_REVIEW_TIME,
  enabled: true,
  sessions: [session(sessionExtra)],
  ...extra,
});
const snapshot = (reviews: PullRequest[], extra: Partial<InboxSnapshot> = {}): InboxSnapshot => ({
  me: "me",
  reviews,
  mine: [],
  checkedAt: NOW,
  problem: null,
  ...extra,
});
const run = (extra: Partial<ReviewRun> = {}): ReviewRun => ({
  session: "s1",
  name: "Afternoon",
  minutes: 30,
  offeredAt: NOW,
  startedAt: null,
  pulls: [
    {
      url: samplePull(1).url,
      repo: "octo/web",
      number: 1,
      title: "Pull request 1",
      author: "ada",
      minutes: 5,
      files: 1,
    },
  ],
  left: 0,
  overBy: 0,
  filters: [],
  ...extra,
});
const event = (number: number, extra: Partial<HeldEvent> = {}): HeldEvent => ({
  kind: "comment-mine",
  repo: "octo/web",
  number,
  title: `Pull request ${number}`,
  url: samplePull(number).url,
  actor: "ada",
  bot: false,
  draft: false,
  approvedByMe: false,
  team: false,
  again: false,
  excerpt: "",
  until: "review",
  heldAt: NOW,
  ...extra,
});

const alarmNames = async () => (await fakeBrowser.alarms.getAll()).map((alarm) => alarm.name).toSorted();
/** The tabs opened; the fake browser starts with one of its own, at no address. */
const openTabs = async () =>
  (await fakeBrowser.tabs.query({})).filter((tab) => tab.url).map((tab) => [tab.url, tab.active]);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("FIREFOX", "");
  created.length = 0;
  cleared.length = 0;
  hooks.refreshLists.mockResolvedValue();
  hooks.updateBadge.mockResolvedValue();
  hooks.release.mockResolvedValue(true);
  initReviewTime(hooks);
  vi.mocked(fetchFiles).mockResolvedValue(FILES);
  vi.mocked(play).mockResolvedValue();
  contains.mockResolvedValue(true);
  Object.assign(fakeBrowser.permissions, { contains });
  Object.assign(fakeBrowser.notifications, {
    create: (id: string, options: Browser.notifications.NotificationCreateOptions) => {
      created.push([id, options]);
      return Promise.resolve(id);
    },
    clear: (id: string) => {
      cleared.push(id);
      return Promise.resolve(true);
    },
  });
  await reviewTimeItem.setValue(settings());
  await inboxItem.setValue(snapshot([samplePull(1), samplePull(2)]));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("scheduleReviewTime", () => {
  it("sets an alarm for the next review time, once, and clears ones for times no longer coming", async () => {
    await fakeBrowser.alarms.create("review-time:next:gone", { when: at(9, 12) });
    await fakeBrowser.alarms.create("inbox", { periodInMinutes: 5 });
    await scheduleReviewTime();
    expect(await alarmNames()).toEqual(["inbox", "review-time:next:s1"]);
    expect((await fakeBrowser.alarms.get("review-time:next:s1"))?.scheduledTime).toBe(at(9, 15));
    const create = vi.spyOn(fakeBrowser.alarms, "create");
    await scheduleReviewTime();
    expect(create).not.toHaveBeenCalled();
  });

  it("moves the alarm when the time changes, and past a skipped one", async () => {
    await scheduleReviewTime();
    await reviewSkipItem.setValue(at(9, 16));
    await scheduleReviewTime();
    expect((await fakeBrowser.alarms.get("review-time:next:s1"))?.scheduledTime).toBe(at(12, 15));
    await scheduleReviewTime(settings({}, { times: ["11:00"] }));
    expect((await fakeBrowser.alarms.get("review-time:next:s1"))?.scheduledTime).toBe(at(12, 11));
  });

  it("with none to come, shows what was kept for one, and keeps what waits for the end", async () => {
    await reviewTimeItem.setValue(settings({ enabled: false }));
    await fakeBrowser.alarms.create("review-time:next:s1", { when: at(9, 15) });
    await heldItem.setValue([event(1), event(2, { until: "end" })]);
    await scheduleReviewTime();
    expect(await alarmNames()).toEqual([]);
    expect(hooks.release).toHaveBeenCalledWith([event(1)]);
    expect(await heldItem.getValue()).toEqual([event(2, { until: "end" })]);
  });

  it("keeps them for later when they can't show now", async () => {
    await reviewTimeItem.setValue(settings({ enabled: false }));
    await heldItem.setValue([event(1)]);
    hooks.release.mockResolvedValue(false);
    await scheduleReviewTime();
    expect(await heldItem.getValue()).toEqual([event(1)]);
  });

  it("releases nothing when nothing was kept", async () => {
    await reviewTimeItem.setValue(settings({ enabled: false }));
    await scheduleReviewTime();
    expect(hooks.release).not.toHaveBeenCalled();
  });

  it("keeps what was kept while one is under way", async () => {
    await heldItem.setValue([event(1)]);
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    await scheduleReviewTime(settings({ enabled: false }));
    expect(hooks.release).not.toHaveBeenCalled();
    expect(await heldItem.getValue()).toEqual([event(1)]);
  });

  it("lets a failed change of what's kept go without holding up the next", async () => {
    await reviewTimeItem.setValue(settings({ enabled: false }));
    vi.spyOn(heldItem, "getValue").mockRejectedValueOnce(new Error("storage"));
    await expect(scheduleReviewTime()).rejects.toThrow("storage");
    await heldItem.setValue([event(1)]);
    await scheduleReviewTime();
    expect(hooks.release).toHaveBeenCalledWith([event(1)]);
  });
});

describe("recoverReviewTime", () => {
  it("ends a run whose time is past: as up once started, as lapsed when only offered", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 40 * MINUTE }));
    await recoverReviewTime();
    expect(await reviewRunItem.getValue()).toBeNull();
    expect(created.map(([id]) => id)).toEqual(["review-time:end"]);

    created.length = 0;
    await reviewRunItem.setValue(run({ offeredAt: NOW - 40 * MINUTE }));
    await recoverReviewTime();
    expect(await reviewRunItem.getValue()).toBeNull();
    expect(created).toEqual([]);
  });

  it("gives a run still going its alarms back, and the next review time its own", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 10 * MINUTE }));
    await recoverReviewTime();
    expect(await alarmNames()).toEqual(["review-time:end", "review-time:next:s1", "review-time:tick"]);
    expect((await fakeBrowser.alarms.get("review-time:end"))?.scheduledTime).toBe(NOW + 20 * MINUTE);
    const create = vi.spyOn(fakeBrowser.alarms, "create");
    await recoverReviewTime();
    expect(create).not.toHaveBeenCalled();
  });

  it("only looks for the next one without a run", async () => {
    await recoverReviewTime();
    expect(await alarmNames()).toEqual(["review-time:next:s1"]);
  });

  it("gives an offer only its end", async () => {
    await reviewRunItem.setValue(run());
    await recoverReviewTime();
    expect(await alarmNames()).toEqual(["review-time:end", "review-time:next:s1"]);
  });
});

describe("readQueueFiles", () => {
  it("reads each pull request's files once per push, keeping only the ones still waiting", async () => {
    await pullFilesItem.setValue({ "https://github.com/octo/web/pull/9": { sha: "x", files: FILES } });
    const reviews = [samplePull(1), samplePull(2)];
    await readQueueFiles(reviews);
    expect(fetchFiles).toHaveBeenCalledTimes(2);
    expect(Object.keys(await pullFilesItem.getValue())).toEqual(reviews.map((pull) => pull.url));
    await readQueueFiles(reviews);
    expect(fetchFiles).toHaveBeenCalledTimes(2);
    await readQueueFiles([samplePull(1, { headSha: "new" })]);
    expect(fetchFiles).toHaveBeenCalledTimes(3);
  });

  it("reads nothing when the popup doesn't estimate the queue", async () => {
    await reviewTimeItem.setValue(settings({ queueEstimates: false }));
    await readQueueFiles([samplePull(1)]);
    expect(fetchFiles).not.toHaveBeenCalled();
  });

  it("keeps nothing for a pull request whose files couldn't be read", async () => {
    vi.mocked(fetchFiles).mockRejectedValue(new Error("offline"));
    await readQueueFiles([samplePull(1)]);
    expect(await pullFilesItem.getValue()).toEqual({});
  });

  it("reads thirty at most, and past them keeps what was read at the same push", async () => {
    vi.mocked(fetchFiles).mockResolvedValue([["a.ts", 1, 0, false]]);
    const reviews = Array.from({ length: 33 }, (_, index) => samplePull(index + 1));
    const old = { sha: "abc123", files: FILES, readAt: 0 };
    await pullFilesItem.setValue({ [reviews[31]!.url]: old, [reviews[32]!.url]: { ...old, sha: "older" } });
    // Which files are viewed only counts for a plan; for the queue, any read at this push is fresh.
    await readQueueFiles(reviews.slice(0, 31));
    expect(fetchFiles).toHaveBeenCalledTimes(30);
    vi.mocked(fetchFiles).mockClear();
    await reviewTimeItem.setValue(settings({}, { minutes: 240 }));
    await inboxItem.setValue(snapshot(reviews));
    await pullFilesItem.setValue({ [reviews[31]!.url]: old, [reviews[32]!.url]: { ...old, sha: "older" } });
    await onReviewAlarm({ name: "review-time:next:s1", scheduledTime: NOW });
    expect(fetchFiles).toHaveBeenCalledTimes(30);
    // The 33rd, read at an older push, is a rough guess.
    expect((await reviewRunItem.getValue())?.pulls.find((pull) => pull.number === 33)?.files).toBeNull();
    expect((await reviewRunItem.getValue())?.pulls.find((pull) => pull.number === 32)?.files).toBe(1);
  });

  it("goes on after a read that failed whole", async () => {
    vi.spyOn(pullFilesItem, "getValue").mockRejectedValueOnce(new Error("storage"));
    await readQueueFiles([samplePull(1)]);
    await readQueueFiles([samplePull(1)]);
    expect(fetchFiles).toHaveBeenCalledTimes(1);
  });
});

describe("offers", () => {
  const offerAlarm = { name: "review-time:next:s1", scheduledTime: NOW };

  it("offers what fits in a notification to start it or put it off, and sets the next one", async () => {
    await onReviewAlarm(offerAlarm);
    expect(hooks.refreshLists).toHaveBeenCalled();
    expect(hooks.updateBadge).toHaveBeenCalled();
    const offered = await reviewRunItem.getValue();
    expect(offered).toMatchObject({ session: "s1", name: "Afternoon", startedAt: null, offeredAt: NOW });
    expect(offered?.pulls.map((pull) => pull.number)).toEqual([1, 2]);
    expect(await alarmNames()).toEqual(["review-time:end", "review-time:next:s1"]);
    expect(cleared).toEqual(["review-time:offer"]);
    const [id, options] = created[0]!;
    expect(id).toBe("review-time:offer");
    expect(options.title).toContain("2 pull requests");
    expect(options.message).toContain("Pull request 1 · ~");
    expect(options).toMatchObject({ contextMessage: "Afternoon", requireInteraction: true, silent: true });
    expect(options.buttons?.map((button) => button.title)).toEqual(["Start", expect.stringContaining("10")]);
    expect(play).toHaveBeenCalledWith(DEFAULT_REVIEW_TIME.sound);
  });

  it("leaves out what the reader marked done, their teams' when the queue does, and the ones not for the session", async () => {
    await inboxItem.setValue(
      snapshot([samplePull(1), samplePull(2, { team: true }), samplePull(3), samplePull(4, { draft: true })]),
    );
    await doneItem.setValue({ [samplePull(3).url]: "2026-10-09T00:00:00Z" });
    await popupItem.setValue({ ...(await popupItem.getValue()), teams: false });
    await onReviewAlarm(offerAlarm);
    expect((await reviewRunItem.getValue())?.pulls.map((pull) => pull.number)).toEqual([1]);
  });

  it("counts only the files in the session's filters, at the reader's pace as learned or not", async () => {
    await configItem.setValue({
      global: [{ id: "tests", name: "Tests", include: "\\.test\\.", exclude: "" }],
      repos: [],
    });
    await reviewTimeItem.setValue(settings({ learn: false }, { filters: ["tests"] }));
    vi.mocked(fetchFiles).mockResolvedValue([...FILES, ["src/app.test.ts", 10, 0, false]]);
    await onReviewAlarm(offerAlarm);
    expect((await reviewRunItem.getValue())?.pulls.map((pull) => pull.files)).toEqual([1, 1]);
  });

  it("reads again which files are viewed when that was a while ago", async () => {
    await inboxItem.setValue(snapshot([samplePull(1), samplePull(2), samplePull(3)]));
    const read = { sha: "abc123", files: FILES, readAt: NOW - 10 * MINUTE };
    await pullFilesItem.setValue({
      [samplePull(1).url]: read,
      [samplePull(2).url]: { ...read, readAt: NOW - 60 * MINUTE },
      [samplePull(3).url]: { sha: "abc123", files: FILES },
    });
    await onReviewAlarm(offerAlarm);
    expect(vi.mocked(fetchFiles).mock.calls).toEqual([
      ["octo/web", 2],
      ["octo/web", 3],
    ]);
  });

  it("guesses for a pull request whose files couldn't be read", async () => {
    vi.mocked(fetchFiles).mockResolvedValueOnce(FILES).mockRejectedValueOnce(new Error("offline"));
    await onReviewAlarm(offerAlarm);
    const pulls = (await reviewRunItem.getValue())?.pulls;
    expect(pulls?.[1]).toMatchObject({ files: null, minutes: DEFAULT_REVIEW_TIME.perPull + 10 });
  });

  it("says by how much the one picked runs over", async () => {
    vi.mocked(fetchFiles).mockResolvedValue([["src/app.ts", 5000, 0, false]]);
    await reviewTimeItem.setValue(settings({}, { minutes: 5 }));
    await onReviewAlarm(offerAlarm);
    const options = created[0]![1];
    expect(options.message.split("\n")[0]).toMatch(/^The one picked takes about \d+ min, \d+ min more than the 5 min/u);
  });

  it("says when there's nothing to review only with updates held for it, or when asked not to skip", async () => {
    await inboxItem.setValue(snapshot([]));
    await onReviewAlarm(offerAlarm);
    expect(created).toEqual([]);
    expect(await reviewRunItem.getValue()).toBeNull();

    await heldItem.setValue([event(1), event(2, { until: "end" })]);
    await onReviewAlarm(offerAlarm);
    const options = created[0]![1];
    expect(options.title).toBe("Review time: nothing waiting for your review");
    expect(options.message).toContain("1 update held");
    expect(options.buttons).toEqual([]);

    created.length = 0;
    await reviewRunItem.setValue(null);
    await heldItem.setValue([]);
    await reviewTimeItem.setValue(settings({ skipEmpty: false }));
    await onReviewAlarm(offerAlarm);
    expect(created).toHaveLength(1);
  });

  it("asks the reader to sign in when GitHub says they're signed out", async () => {
    await inboxItem.setValue(snapshot([], { problem: "signed-out" }));
    await onReviewAlarm(offerAlarm);
    expect(created).toEqual([
      [
        "review-time:offer",
        expect.objectContaining({
          title: "Review time: sign in to GitHub to see what’s waiting",
          contextMessage: "Afternoon",
        }),
      ],
    ]);
    expect(await reviewRunItem.getValue()).toBeNull();
  });

  it("plans from an empty queue when none was ever read", async () => {
    await inboxItem.setValue(null);
    await reviewTimeItem.setValue(settings({ skipEmpty: false }, { name: "" }));
    await onReviewAlarm(offerAlarm);
    expect(await reviewRunItem.getValue()).toMatchObject({ name: "Review time", pulls: [] });
  });

  it("offers nothing when off, the session is gone or off, one is under way, or the time has passed", async () => {
    await reviewTimeItem.setValue(settings({ enabled: false }));
    await onReviewAlarm(offerAlarm);
    await reviewTimeItem.setValue(settings({}, { on: false }));
    await onReviewAlarm(offerAlarm);
    await reviewTimeItem.setValue(settings());
    await onReviewAlarm({ name: "review-time:next:gone", scheduledTime: NOW });
    await onReviewAlarm({ name: "review-time:next:s1", scheduledTime: NOW - 30 * MINUTE });
    await reviewRunItem.setValue(run({ session: "other", startedAt: NOW }));
    await onReviewAlarm(offerAlarm);
    expect(created).toEqual([]);
    expect(await reviewRunItem.getValue()).toMatchObject({ session: "other" });
  });

  it("lets one started from the popup while planning win", async () => {
    hooks.refreshLists.mockImplementation(() => reviewRunItem.setValue(run({ session: "popup", startedAt: NOW })));
    await onReviewAlarm(offerAlarm);
    expect(created).toEqual([]);
    expect(await reviewRunItem.getValue()).toMatchObject({ session: "popup" });
  });

  it("offers again when a put-off one comes back", async () => {
    expect(await onReviewAlarm({ name: "review-time:snooze:s1", scheduledTime: NOW })).toBe(true);
    expect(await reviewRunItem.getValue()).toMatchObject({ session: "s1" });
  });

  it("shows no notification where they aren't allowed", async () => {
    contains.mockResolvedValue(false);
    await onReviewAlarm(offerAlarm);
    expect(created).toEqual([]);
    expect(await reviewRunItem.getValue()).not.toBeNull();
  });

  it("shows no notification where the browser has none", async () => {
    const { notifications } = fakeBrowser;
    Object.assign(fakeBrowser, { notifications: undefined });
    try {
      await onReviewAlarm(offerAlarm);
      expect(await reviewRunItem.getValue()).not.toBeNull();
      await snoozeRun();
      expect(await reviewRunItem.getValue()).toBeNull();
    } finally {
      Object.assign(fakeBrowser, { notifications });
    }
    expect(created).toEqual([]);
  });

  it("asks Firefox for no buttons, nor to stay or be quiet", async () => {
    vi.stubEnv("FIREFOX", "true");
    await onReviewAlarm(offerAlarm);
    const options = created[0]![1];
    expect(options).not.toHaveProperty("buttons");
    expect(options).not.toHaveProperty("requireInteraction");
    expect(options).not.toHaveProperty("silent");
  });
});

describe("starting", () => {
  beforeEach(async () => {
    await reviewRunItem.setValue(
      run({ pulls: [run().pulls[0]!, { ...run().pulls[0]!, number: 2, url: samplePull(2).url }] }),
    );
  });

  it("starts the offer, sets its alarms and opens the first pull request in front", async () => {
    await startRun();
    expect(await reviewRunItem.getValue()).toMatchObject({ startedAt: NOW });
    expect(await alarmNames()).toEqual(["review-time:end", "review-time:tick"]);
    expect((await fakeBrowser.alarms.get("review-time:end"))?.scheduledTime).toBe(NOW + 30 * MINUTE);
    expect(cleared).toEqual(["review-time:offer"]);
    expect(await openTabs()).toEqual([[`${samplePull(1).url}/changes`, true]]);
  });

  it("opens all of them, behind the popup", async () => {
    await reviewTimeItem.setValue(settings({ opens: "all" }));
    await startRun({ fromPopup: true });
    expect(await openTabs()).toEqual([
      [`${samplePull(1).url}/changes`, false],
      [`${samplePull(2).url}/changes`, false],
    ]);
  });

  it("opens none when asked not to", async () => {
    await reviewTimeItem.setValue(settings({ opens: "none" }));
    await startRun();
    expect(await openTabs()).toEqual([]);
  });

  it("starts nothing without an offer, one started already or one with nothing in it", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - MINUTE }));
    await startRun();
    expect(await reviewRunItem.getValue()).toMatchObject({ startedAt: NOW - MINUTE });
    await reviewRunItem.setValue(run({ pulls: [] }));
    await startRun();
    await reviewRunItem.setValue(null);
    await startRun();
    expect(await openTabs()).toEqual([]);
  });

  it("starts from the notification, or puts it off from its second button", async () => {
    expect(await onReviewNotification("review-time:offer")).toBe(true);
    expect(await reviewRunItem.getValue()).toMatchObject({ startedAt: NOW });
    await reviewRunItem.setValue(run());
    expect(await onReviewNotification("review-time:offer", 1)).toBe(true);
    expect(await reviewRunItem.getValue()).toBeNull();
    expect(await alarmNames()).toContain("review-time:snooze:s1");
    expect(await onReviewNotification("review-time:end")).toBe(true);
    expect(cleared.at(-1)).toBe("review-time:end");
    expect(await onReviewNotification("inbox:other")).toBe(false);
  });
});

describe("openPull", () => {
  beforeEach(async () => {
    await configItem.setValue({
      global: [{ id: "tests", name: "Tests", include: "\\.test\\.", exclude: "" }],
      repos: [],
    });
    await selectionsItem.setValue({ "octo/api": ["docs"] });
  });

  it("turns on the session's filters for the repository, then opens it on its files", async () => {
    await reviewRunItem.setValue(run({ filters: ["tests"] }));
    await openPull(samplePull(1).url, "octo/web", false);
    expect(await selectionsItem.getValue()).toEqual({ "octo/api": ["docs"], "octo/web": ["tests"] });
    expect(await openTabs()).toEqual([[`${samplePull(1).url}/changes`, false]]);
  });

  it("leaves the filters alone when asked to, without a run, or with none that apply", async () => {
    await reviewTimeItem.setValue(settings({ applyFilters: false }));
    await reviewRunItem.setValue(run({ filters: ["tests"] }));
    await openPull(samplePull(1).url, "octo/web", true);
    await reviewTimeItem.setValue(settings());
    await reviewRunItem.setValue(run({ filters: ["gone"] }));
    await openPull(samplePull(1).url, "octo/web", true);
    await reviewRunItem.setValue(null);
    await openPull(samplePull(1).url, "octo/web", true);
    expect(await selectionsItem.getValue()).toEqual({ "octo/api": ["docs"] });
  });
});

describe("startNow", () => {
  it("starts one from the popup like a session, for the minutes asked", async () => {
    expect(await startNow(45, "s1")).toBe(true);
    expect(await reviewRunItem.getValue()).toMatchObject({
      session: "s1",
      name: "Afternoon",
      minutes: 45,
      startedAt: NOW,
    });
    expect(await openTabs()).toEqual([[`${samplePull(1).url}/changes`, false]]);
  });

  it("starts one of its own for a session that's gone", async () => {
    expect(await startNow(15, "gone")).toBe(true);
    expect(await reviewRunItem.getValue()).toMatchObject({ session: "", name: "Review time", minutes: 15 });
  });

  it("starts nothing when nothing is waiting", async () => {
    await inboxItem.setValue(snapshot([]));
    expect(await startNow(30, "s1")).toBe(false);
    expect(await reviewRunItem.getValue()).toBeNull();
  });
});

describe("snoozeRun", () => {
  it("puts the offer off for the minutes the reader picked", async () => {
    await reviewTimeItem.setValue(settings({ snooze: 15 }));
    await reviewRunItem.setValue(run());
    await snoozeRun();
    expect(await reviewRunItem.getValue()).toBeNull();
    expect((await fakeBrowser.alarms.get("review-time:snooze:s1"))?.scheduledTime).toBe(NOW + 15 * MINUTE);
    expect(hooks.updateBadge).toHaveBeenCalled();
  });

  it("puts off nothing once started, or with nothing offered", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    await snoozeRun();
    expect(await reviewRunItem.getValue()).not.toBeNull();
    await reviewRunItem.setValue(null);
    await snoozeRun();
    expect(await alarmNames()).toEqual([]);
  });
});

describe("endRun", () => {
  it("lets go of what the offer showed, keeps what came since, and shows what waited for the end", async () => {
    await reviewRunItem.setValue(run({ offeredAt: NOW - MINUTE }));
    await heldItem.setValue([
      event(1, { heldAt: NOW - 2 * MINUTE }),
      event(2, { heldAt: NOW }),
      event(3, { until: "end" }),
    ]);
    await endRun("ended");
    expect(await heldItem.getValue()).toEqual([event(2, { heldAt: NOW })]);
    expect(hooks.release).toHaveBeenCalledWith([event(3, { until: "end" })]);
    expect(await reviewRunItem.getValue()).toBeNull();
  });

  it("keeps everything for the next one when the offer lapsed unseen, or there was no run", async () => {
    await reviewRunItem.setValue(run({ offeredAt: NOW - MINUTE }));
    await heldItem.setValue([event(1, { heldAt: NOW - 2 * MINUTE })]);
    await endRun("lapsed");
    expect(await heldItem.getValue()).toHaveLength(1);
    await endRun("skipped");
    expect(await heldItem.getValue()).toHaveLength(1);
  });

  it("says how far the reader got once the time is up", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 30 * MINUTE }));
    await endRun("time");
    expect(hooks.refreshLists).toHaveBeenCalled();
    expect(created.map(([id]) => id)).toEqual(["review-time:end"]);
    expect(created[0]![1].title).toBe("Review time’s up");
    expect(created[0]![1].message).toContain("You reviewed 0 of 1");
  });

  it("says when all were reviewed, counting the ones marked done", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 30 * MINUTE }));
    await doneItem.setValue({ [samplePull(1).url]: "2026-10-09T00:00:00Z" });
    await endRun("time");
    expect(created[0]?.[1].message).toBe("You went through all of them.");
  });

  it("says it can't tell when GitHub couldn't be read", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 30 * MINUTE }));
    await inboxItem.setValue(snapshot([], { problem: "offline" }));
    await endRun("time");
    expect(created[0]?.[1].message).toBe("GitHub couldn’t be read to tell how far you got.");
  });

  it("counts all as reviewed when the queue was never read", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 30 * MINUTE }));
    await inboxItem.setValue(null);
    await endRun("time");
    expect(created[0]?.[1].message).toBe("You went through all of them.");
  });

  it("reminds of nothing when ended early, not asked to, with nothing in it, or without a run", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    await endRun("ended");
    await reviewRunItem.setValue(run({ startedAt: NOW, pulls: [] }));
    await endRun("time");
    await reviewTimeItem.setValue(settings({ remindEnd: false }));
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    await endRun("time");
    await endRun("time");
    expect(created).toEqual([]);
  });

  it("ends once the end alarm goes off: up once started, lapsed if not", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW - 30 * MINUTE }));
    expect(await onReviewAlarm({ name: "review-time:end", scheduledTime: NOW })).toBe(true);
    expect(created).toHaveLength(1);
    await reviewRunItem.setValue(run({ offeredAt: NOW - 30 * MINUTE }));
    await onReviewAlarm({ name: "review-time:end", scheduledTime: NOW });
    expect(created).toHaveLength(1);
    expect(await reviewRunItem.getValue()).toBeNull();
  });
});

describe("onReviewAlarm", () => {
  it("counts the minutes down every minute", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    expect(await onReviewAlarm({ name: "review-time:tick", scheduledTime: NOW })).toBe(true);
    expect(hooks.updateBadge).toHaveBeenCalled();
  });

  it("leaves the alarms that aren't review time's", async () => {
    expect(await onReviewAlarm({ name: "inbox", scheduledTime: NOW })).toBe(false);
  });
});

describe("holding", () => {
  it("keeps an event for the next review time when asked and one is coming", async () => {
    const until = await holding();
    expect(until("review")).toBe("review");
    expect(until("now")).toBeNull();
    await reviewTimeItem.setValue(settings({ enabled: false }));
    expect((await holding())("review")).toBeNull();
  });

  it("keeps everything for the end while reviewing, when asked", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    expect((await holding())("now")).toBeNull();
    await reviewTimeItem.setValue(settings({ holdWhileReviewing: true }));
    expect((await holding())("now")).toBe("end");
    await reviewRunItem.setValue(run());
    expect((await holding())("now")).toBeNull();
  });
});

describe("hold", () => {
  it("keeps the latest fifty, one per kind of event on a pull request", async () => {
    await hold(Array.from({ length: 60 }, (_, index) => event(index + 1)));
    await hold([event(60, { title: "Renamed" })]);
    const held = await heldItem.getValue();
    expect(held).toHaveLength(50);
    expect(held.at(0)?.number).toBe(11);
    expect(held.at(-1)?.title).toBe("Renamed");
  });

  it("shows at once what waits for the end of a review time that isn't under way", async () => {
    await hold([event(1, { until: "end" }), event(2)]);
    expect(hooks.release).toHaveBeenCalledWith([event(1, { until: "end" })]);
    expect(await heldItem.getValue()).toEqual([event(2)]);
  });

  it("keeps it while one is", async () => {
    await reviewRunItem.setValue(run({ startedAt: NOW }));
    await hold([event(1, { until: "end" })]);
    expect(hooks.release).not.toHaveBeenCalled();
    expect(await heldItem.getValue()).toEqual([event(1, { until: "end" })]);
  });

  it("keeps nothing of nothing", async () => {
    await hold([]);
    expect(await heldItem.getValue()).toEqual([]);
  });
});

describe("runBadge", () => {
  it("shows a play sign for an offer, and the minutes left once started", async () => {
    expect(await runBadge()).toBeNull();
    await reviewRunItem.setValue(run());
    expect(await runBadge()).toEqual({ text: "▶", color: "#1a7f37" });
    await reviewRunItem.setValue(run({ startedAt: NOW - 10.5 * MINUTE }));
    expect(await runBadge()).toEqual({ text: "20m", color: "#1a7f37" });
    await reviewRunItem.setValue(run({ startedAt: NOW - 40 * MINUTE }));
    expect(await runBadge()).toBeNull();
  });
});
