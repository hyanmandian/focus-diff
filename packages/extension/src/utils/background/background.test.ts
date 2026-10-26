import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { writeAppFile } from "@/utils/app-files/app-files";
import { startCommandServer } from "@/utils/command-server/command-server";
import { fakePorts } from "@/utils/fake-ports/fake-ports";
import { LEGACY_DONE } from "@/utils/migration/migration";
import type { BackgroundMessage } from "@/utils/port-protocol/port-protocol";
import { language } from "@/utils/words/words";

import { applyLegacyDone, forwardCommand, startBackground } from "./background";

// The services the background puts together, each tested on its own: here, stand-ins that say what they were asked.
const services = vi.hoisted(() => ({
  authListeners: [] as Array<() => void>,
  queues: null as null | {
    commands: Record<string, () => unknown>;
    configChanged: ReturnType<typeof vi.fn>;
    authChanged: ReturnType<typeof vi.fn>;
    onAlarm: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
    broadcast: (event: string, payload?: unknown) => void;
    request: (...args: [string, string, string | null, string | null]) => Promise<unknown>;
    login: () => Promise<unknown>;
  },
  github: Promise.withResolvers<Record<string, () => unknown>>(),
  migrated: false,
}));

vi.mock("@/utils/github-api/github-api", () => ({
  createGitHubApi: () => ({
    request: (...args: unknown[]) => Promise.resolve({ asked: args }),
    login: () => Promise.resolve("ana"),
    onChange: (listener: () => void) => services.authListeners.push(listener),
  }),
}));
vi.mock("@/utils/github-commands/github-commands", () => ({ startGitHubCommands: () => services.github.promise }));
vi.mock("@/utils/migration/migration", async (real) => ({
  ...(await real<Record<string, unknown>>()),
  migrate: () => Promise.resolve({ migrated: services.migrated, dropped: [] }),
}));
vi.mock("@/utils/queue-service/queue-service", () => ({
  startQueues: (options: {
    server: { broadcast: (event: string, payload?: unknown) => void };
    request: (...args: [string, string, string | null, string | null]) => Promise<unknown>;
    login: () => Promise<unknown>;
  }) => {
    const dismiss = vi.fn(() => Promise.resolve());
    services.queues = {
      commands: { snapshot: () => ({ ready: true }) },
      configChanged: vi.fn(() => Promise.resolve()),
      authChanged: vi.fn(() => Promise.resolve()),
      onAlarm: vi.fn(() => Promise.resolve()),
      dismiss,
      broadcast: options.server.broadcast,
      request: options.request,
      login: options.login,
    };
    return { ...services.queues, watch: { dismiss } };
  },
}));

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/** A page connected to the background, and what it hears. */
const page = (name: string) => {
  const port = browser.runtime.connect({ name: `focus-diff:${name}` });
  const heard: BackgroundMessage[] = [];
  port.onMessage.addListener((message: BackgroundMessage) => {
    heard.push(message);
  });
  return { port, heard };
};

const snapshot = (over: object = {}) => ({
  signedIn: true,
  status: { phase: "idle" as const, updatedAt: 1 },
  items: {
    review: [{ pr: { id: "PR_1", url: "https://github.com/acme/web/pull/1", updatedAt: "2026-01-01T00:00:00Z" } }],
  },
  ...over,
});

describe("the background", () => {
  let onCommand: ((command: string) => void) | undefined;
  beforeEach(() => {
    fakePorts();
    services.authListeners = [];
    services.github = Promise.withResolvers();
    services.migrated = false;
    onCommand = undefined;
    Object.assign(fakeBrowser, {
      commands: {
        onCommand: {
          addListener: (listener: (command: string) => void) => {
            onCommand = listener;
          },
        },
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers the pages once the GitHub commands are ready, and hands the queues GitHub", async () => {
    startBackground();
    const { port, heard } = page("panel");
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port, not a window
    port.postMessage({ type: "invoke", id: 1, command: "github", args: {} });
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port, not a window
    port.postMessage({ type: "invoke", id: 2, command: "update_offered", args: {} });
    await settle();
    expect(heard).toEqual([]);
    services.github.resolve({ github: () => ({ status: 200, body: "{}" }) });
    await settle();
    expect(heard).toContainEqual({ type: "reply", id: 1, ok: true, value: { status: 200, body: "{}" } });
    expect(heard).toContainEqual({ type: "reply", id: 2, ok: true, value: null });
    expect(await services.queues!.request("POST", "/graphql", "{}", null)).toEqual({
      asked: ["POST", "/graphql", "{}", null],
    });
    expect(await services.queues!.login()).toBe("ana");
  });

  it("answers what it can even when the GitHub commands couldn't start", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    startBackground();
    const { port, heard } = page("panel");
    services.github.reject(new Error("storage"));
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port, not a window
    port.postMessage({ type: "invoke", id: 1, command: "snapshot", args: {} });
    await settle();
    await settle();
    expect(heard).toContainEqual({ type: "reply", id: 1, ok: true, value: { ready: true } });
    expect(logged).toHaveBeenCalledWith(new Error("storage"));
  });

  it("follows the app's files whoever writes them: the queues and its words follow the setup", async () => {
    startBackground();
    await settle();
    const { heard } = page("settings");
    await writeAppFile("config", JSON.stringify({ language: "pt-BR" }));
    await writeAppFile("pace", "{}");
    await settle();
    expect(language()).toBe("pt-BR");
    expect(services.queues!.configChanged).toHaveBeenCalledOnce();
    expect(heard.filter((m) => m.type === "event").map((m) => m.type === "event" && m.payload)).toEqual([
      "config",
      "pace",
    ]);
  });

  it("tells the queues of sign-ins and alarms", () => {
    startBackground();
    services.authListeners[0]!();
    expect(services.queues!.authChanged).toHaveBeenCalled();
    void fakeBrowser.alarms.onAlarm.trigger({ name: "queues-refresh", scheduledTime: 0 });
    expect(services.queues!.onAlarm).toHaveBeenCalledWith({ name: "queues-refresh", scheduledTime: 0 });
  });

  it("sends the bar's shortcuts to the tab in front", async () => {
    startBackground();
    const query = vi.spyOn(fakeBrowser.tabs, "query").mockResolvedValue([{ id: 3 } as Browser.tabs.Tab]);
    const sent = vi.spyOn(fakeBrowser.tabs, "sendMessage").mockResolvedValue(null);
    onCommand!("next-filter");
    await settle();
    expect(sent).toHaveBeenCalledWith(3, { type: "command", command: "next-filter" });
    sent.mockRejectedValueOnce(new Error("No receiving end"));
    await forwardCommand("show-all");
    query.mockResolvedValue([]);
    await forwardCommand("show-all");
    expect(sent).toHaveBeenCalledTimes(2);
  });

  it("opens setup on install, and on the first update to the app (the old settings moved first)", async () => {
    startBackground();
    const created = vi.spyOn(fakeBrowser.tabs, "create").mockResolvedValue({} as Browser.tabs.Tab);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "install", temporary: false });
    await settle();
    expect(created).toHaveBeenCalledWith({ url: "chrome-extension://test-extension-id/setup.html" });
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", temporary: false, previousVersion: "1.2.0" });
    await settle();
    expect(created).toHaveBeenCalledOnce();
    services.migrated = true;
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "update", temporary: false, previousVersion: "1.2.0" });
    await settle();
    expect(created).toHaveBeenCalledTimes(2);
    await fakeBrowser.runtime.onInstalled.trigger({ reason: "chrome_update", temporary: false });
    await settle();
    expect(created).toHaveBeenCalledTimes(2);
  });

  it("passes the queues' snapshots on, and takes the old popup's done pull requests off once GitHub answered", async () => {
    startBackground();
    const { heard } = page("panel");
    await fakeBrowser.storage.local.set({ "legacy.done": { "https://github.com/acme/web/pull/1": "2026-02-01T00:00:00Z" } });
    services.queues!.broadcast("snapshot", snapshot());
    // A second one while the first is still being applied waits its turn.
    services.queues!.broadcast("snapshot", snapshot());
    services.queues!.broadcast("drafts", "PR_1");
    await settle();
    await settle();
    expect(services.queues!.dismiss).toHaveBeenCalledExactlyOnceWith("review", "PR_1");
    expect(heard.filter((m) => m.type === "event").map((m) => m.type === "event" && m.event)).toEqual([
      "snapshot",
      "snapshot",
      "drafts",
    ]);
    expect(LEGACY_DONE).toBe("local:legacy.done");
  });
});

describe("the old popup's done pull requests", () => {
  it("wait until GitHub has answered, signed in", async () => {
    fakePorts();
    startCommandServer({});
    const dismiss = vi.fn(() => Promise.resolve());
    await fakeBrowser.storage.local.set({ "legacy.done": { "https://github.com/acme/web/pull/1": "2026-02-01T00:00:00Z" } });
    await applyLegacyDone(snapshot({ signedIn: false }), dismiss);
    await applyLegacyDone(snapshot({ status: { phase: "loading", updatedAt: 1 } }), dismiss);
    await applyLegacyDone(snapshot({ status: { phase: "idle", updatedAt: 0 } }), dismiss);
    expect(dismiss).not.toHaveBeenCalled();
    await applyLegacyDone(snapshot(), dismiss);
    await applyLegacyDone(snapshot(), dismiss);
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
