import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { writeAppFile } from "@/utils/app-files/app-files";
import { followConfig } from "@/utils/words/words";

import {
  COUNT_COLOR,
  COUNTDOWN_COLOR,
  readConfig,
  REFRESH_ALARM,
  showNotification,
  startQueues,
  TICK_ALARM,
  type Request,
} from "./queue-service";

const T0 = Date.UTC(2026, 0, 5, 12); // A Monday.
const MINUTE = 60_000;
const iso = (ms: number) => new Date(ms).toISOString().replace(".000", "");

const pull = (id: string, n: number) => ({
  id,
  number: n,
  title: `Fix ${id}`,
  url: `https://github.com/acme/web/pull/${n}`,
  state: "OPEN",
  createdAt: iso(T0 - 600 * MINUTE),
  updatedAt: iso(T0 - 10 * MINUTE),
  headRefOid: "head",
  mergeable: "MERGEABLE",
  additions: 10,
  changedFiles: 1,
  repository: { nameWithOwner: "acme/web" },
  author: { __typename: "User", login: "ana", name: "Ana Lima" },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] },
  commits: { nodes: [{ commit: { committedDate: iso(T0), statusCheckRollup: null } }] },
});

const REVIEW = { id: "r", name: "Review", kind: "review", notify: ["new"], drafts: "show" };

/** A field of a JSON object, as GitHub reads it. */
const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Object.entries(value).find(([k]) => k === key)?.[1] : undefined;

/** GitHub as the queues ask it: the pull requests waiting for review, by id. */
const github = () => {
  const prs = new Map<string, ReturnType<typeof pull>>();
  const calls: string[] = [];
  let status = 200;
  const request: Request = (method, path, body) => {
    calls.push(`${method} ${path}`);
    const sent: unknown = JSON.parse(body ?? "{}");
    const query = String(field(sent, "query"));
    const variables = field(sent, "variables");
    const reply = (data: unknown) => Promise.resolve({ status, body: JSON.stringify(status === 200 ? { data } : {}) });
    if (query.includes("organizations")) return reply({ viewer: { organizations: { nodes: [] } } });
    if (query.includes("search(")) {
      const nodes = [...prs.values()].map((p) => ({
        id: p.id,
        updatedAt: p.updatedAt,
        headRefOid: p.headRefOid,
        mergeable: p.mergeable,
        commits: p.commits,
      }));
      return reply({ search: { pageInfo: { hasNextPage: false }, nodes } });
    }
    return reply({ nodes: [field(variables, "ids")].flat().map((id) => prs.get(String(id)) ?? null) });
  };
  return {
    prs,
    calls,
    request,
    fail: (code: number) => {
      status = code;
    },
  };
};

const setup = async (config: unknown) => {
  await writeAppFile("config", JSON.stringify(config));
};

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

const start = (gh = github(), now = () => T0) => {
  const broadcast = vi.fn<(event: string, payload?: unknown) => void>();
  const queues = startQueues({ request: gh.request, login: () => Promise.resolve("me"), server: { broadcast }, now });
  return { queues, broadcast, gh };
};

const badge = async () => ({
  text: await fakeBrowser.action.getBadgeText({}),
  color: await fakeBrowser.action.getBadgeBackgroundColor({}),
});

const hex = (color: string) => [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16)).concat(255);

beforeEach(() => {
  followConfig(null);
});

describe("the queues in the background", () => {
  it("wait for a setup, with the alarms set", async () => {
    const { queues, gh } = start();
    await queues.started;
    expect(gh.calls).toStrictEqual([]);
    expect(queues.commands.snapshot!({}, { window: "panel" })).toMatchObject({
      ready: true,
      signedIn: true,
      items: {},
    });
    expect(await fakeBrowser.alarms.get(REFRESH_ALARM)).toMatchObject({ periodInMinutes: 1 });
    expect(await fakeBrowser.alarms.get(TICK_ALARM)).toMatchObject({ periodInMinutes: 1 });
  });

  it("read the setup from config.json, and nothing from one that doesn't read", async () => {
    expect(await readConfig()).toBeNull();
    await writeAppFile("config", "{");
    expect(await readConfig()).toBeNull();
    await setup({ queues: [REVIEW], pollSeconds: 300 });
    expect((await readConfig())?.pollSeconds).toBe(300);
  });

  it("fetch the queues, tell the pages, count what's unread and notify about what's new", async () => {
    await setup({ queues: [REVIEW], sound: true });
    const { queues, broadcast, gh } = start(github());
    gh.prs.set("A", pull("A", 1));
    await queues.started;
    expect(gh.calls.length).toBeGreaterThan(0);
    expect(queues.commands.snapshot!({}, { window: "panel" })).toStrictEqual(queues.watch.snapshot());
    expect(queues.watch.snapshot().items.r).toHaveLength(1);
    expect(broadcast).toHaveBeenLastCalledWith("snapshot", expect.objectContaining({ ready: true }));
    await flush();
    expect(await badge()).toStrictEqual({ text: "1", color: hex(COUNT_COLOR) });

    gh.prs.set("B", pull("B", 2));
    await queues.onAlarm({ name: REFRESH_ALARM });
    // Not yet: the last refresh is fresh.
    expect(fakeBrowser.notifications.getAllCreateOptions()).toStrictEqual({});
    queues.commands.refresh!({ force: true }, { window: "panel" });
    await vi.waitFor(() => {
      expect(Object.values(fakeBrowser.notifications.getAllCreateOptions())).toStrictEqual([
        {
          type: "basic",
          iconUrl: "chrome-extension://test-extension-id/icon/128.png",
          title: "Ana asked for your review",
          message: "Fix B\nacme/web#2",
          silent: false,
        },
      ]);
    });
    await flush();
    expect((await badge()).text).toBe("2");
  });

  it("answer the panel's clicks", async () => {
    await setup({ queues: [REVIEW] });
    const { queues, gh } = start(github());
    gh.prs.set("A", pull("A", 1));
    gh.prs.set("B", pull("B", 2));
    await queues.started;
    const panel = { window: "panel" };
    await queues.commands.mark_seen!({ queueId: "r", prId: "A" }, panel);
    await flush();
    expect((await badge()).text).toBe("1");
    await queues.commands.mark_queue_seen!({ queueId: "r" }, panel);
    await flush();
    expect((await badge()).text).toBe("");
    await queues.commands.dismiss!({ queueId: "r", prId: "A" }, panel);
    expect(queues.watch.snapshot().dismissed).toStrictEqual({ "r:A": true });
    await queues.commands.restore!({ queueId: "r", prId: "A" }, panel);
    expect(queues.watch.snapshot().dismissed).toStrictEqual({});
    queues.commands.clear_arrival!({ prId: "A" }, panel);
    queues.commands.refresh!({}, panel);
    queues.commands.end_review!({}, panel);
    await flush();
    expect(await fakeBrowser.storage.local.get("watch.state")).toMatchObject({
      "watch.state": { dismissed: {} },
    });
  });

  it("follow the setup's rhythm, and signing in or out", async () => {
    await setup({ queues: [REVIEW] });
    const { queues, gh } = start(github());
    await queues.started;
    await setup({ queues: [REVIEW], pollSeconds: 120 });
    await queues.configChanged();
    expect(await fakeBrowser.alarms.get(REFRESH_ALARM)).toMatchObject({ periodInMinutes: 2 });
    const before = gh.calls.length;
    await queues.authChanged();
    expect(gh.calls.length).toBeGreaterThan(before);
    await queues.onAlarm({ name: TICK_ALARM });
    await queues.onAlarm({ name: "something-else" });
  });

  it("say what's new in the language in use, and GitHub's errors too", async () => {
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "pt-BR" });
    await setup({ queues: [REVIEW] });
    const { queues, gh } = start(github());
    gh.prs.set("A", pull("A", 1));
    await queues.started;
    gh.prs.set("B", pull("B", 2));
    await queues.watch.refresh(true);
    await vi.waitFor(() => {
      expect(Object.values(fakeBrowser.notifications.getAllCreateOptions())[0]).toMatchObject({
        title: "Ana pediu sua revisão",
        silent: true,
      });
    });
    gh.fail(502);
    await queues.watch.refresh(true);
    expect(queues.watch.snapshot().status).toMatchObject({ phase: "error", error: "O GitHub respondeu 502" });
  });

  /** A review time that comes a minute after the queues start, and its clock's tick then. */
  const dueSoon = async () => {
    let now = T0;
    const local = new Date(T0 + MINUTE);
    const at = `${String(local.getHours()).padStart(2, "0")}:${String(local.getMinutes()).padStart(2, "0")}`;
    await setup({
      queues: [REVIEW],
      reviewTime: { enabled: true, sessions: [{ id: "s", days: [local.getDay()], times: [at], minutes: 30 }] },
    });
    await writeAppFile("pace", JSON.stringify({ all: { actual: 20, expected: 20 } }));
    const { queues, gh } = start(github(), () => now);
    gh.prs.set("A", pull("A", 1));
    await queues.started;
    now = T0 + MINUTE;
    await queues.onAlarm({ name: TICK_ALARM });
    return queues;
  };

  it("say review time's words in the language in use", async () => {
    Object.assign(fakeBrowser.i18n, { getUILanguage: () => "pt-BR" });
    await dueSoon();
    await vi.waitFor(() => {
      expect(Object.values(fakeBrowser.notifications.getAllCreateOptions())[0]).toMatchObject({
        title: "Review time: 1 pull request, cerca de 1 min",
      });
    });
  });

  it("keep going when saving fails", async () => {
    await setup({ queues: [REVIEW] });
    const { queues } = start();
    await queues.started;
    const set = vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValue(new Error("full"));
    queues.commands.refresh!({ force: true }, { window: "panel" });
    await vi.waitFor(() => {
      expect(set).toHaveBeenCalled();
    });
    await flush();
  });

  it("count down a review time under way on the badge, and say when it's due", async () => {
    const queues = await dueSoon();
    await vi.waitFor(async () => {
      expect(await badge()).toStrictEqual({ text: "30m", color: hex(COUNTDOWN_COLOR) });
    });
    expect(Object.values(fakeBrowser.notifications.getAllCreateOptions())[0]).toMatchObject({
      title: "Review time: 1 pull request, about 1 min",
    });
    queues.commands.end_review!({}, { window: "panel" });
    await vi.waitFor(async () => {
      expect(await badge()).toStrictEqual({ text: "1", color: hex(COUNT_COLOR) });
    });
  });

  it("open the panel from a notification, where the browser lets it", async () => {
    const { queues } = start();
    await queues.started;
    const open = vi.spyOn(fakeBrowser.action, "openPopup").mockRejectedValue(new Error("no gesture"));
    await fakeBrowser.notifications.create("n", { type: "basic", iconUrl: "", title: "t", message: "m" });
    await fakeBrowser.notifications.onClicked.trigger("n");
    await flush();
    expect(open).toHaveBeenCalled();
    expect(fakeBrowser.notifications.getAllCreateOptions()).toStrictEqual({});
    // A browser without it.
    Object.assign(fakeBrowser.action, { openPopup: undefined });
    await fakeBrowser.notifications.onClicked.trigger("n");
  });
});

describe("a notification", () => {
  it("goes without its sound where the browser can't say", async () => {
    const create = vi
      .spyOn(fakeBrowser.notifications, "create")
      .mockRejectedValueOnce(new Error("Unexpected property silent"))
      .mockResolvedValueOnce();
    await showNotification({ title: "t", body: "b", sound: true });
    expect(create).toHaveBeenLastCalledWith({
      type: "basic",
      iconUrl: "chrome-extension://test-extension-id/icon/128.png",
      title: "t",
      message: "b",
    });
  });

  it("isn't missed when notifications are off", async () => {
    vi.spyOn(fakeBrowser.notifications, "create").mockRejectedValue(new Error("off"));
    await expect(showNotification({ title: "t", body: "b", sound: false })).resolves.toBeUndefined();
  });
});
