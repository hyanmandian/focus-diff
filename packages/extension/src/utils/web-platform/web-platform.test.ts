import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

import { startCommandServer } from "@/utils/command-server/command-server";
import { fakePorts } from "@/utils/fake-ports/fake-ports";

import { BROWSER_FEATURES, createWebPlatform, GONE, PING_MS } from "./web-platform";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the browser as the screens' platform", () => {
  let ports: ReturnType<typeof fakePorts>;
  beforeEach(() => {
    ports = fakePorts();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the background for the app's commands, bytes both ways", async () => {
    const asked = vi.fn();
    startCommandServer({
      refresh: (args, from) => {
        asked(args, from.window);
      },
      github_file: () => new Uint8Array([1, 2, 255]),
      upload_attachment: (args) => args,
      auth_use_gh: () => {
        throw new Error("Not here");
      },
    });
    const app = createWebPlatform("panel");
    expect(app.features).toBe(BROWSER_FEATURES);
    await app.invoke("refresh", { force: true });
    await app.invoke("refresh");
    expect(asked.mock.calls).toEqual([
      [{ force: true }, "panel"],
      [{}, "panel"],
    ]);
    expect(await app.invoke("github_file", { repo: "acme/web" })).toEqual(new Uint8Array([1, 2, 255]));
    expect(await app.invoke("upload_attachment", new Uint8Array([104, 105]), { headers: { "x-repo": "acme/web" } })).toEqual({
      bytes: { $bytes: "aGk=" },
      headers: { "x-repo": "acme/web" },
    });
    expect(await app.invoke("upload_attachment", new Uint8Array([104, 105]))).toEqual({
      bytes: { $bytes: "aGk=" },
      headers: {},
    });
    await expect(app.invoke("auth_use_gh")).rejects.toBe("Not here");
  });

  it("answers what's the page's own: closing, confirming, a menu bar it hasn't got", async () => {
    startCommandServer({});
    const app = createWebPlatform("panel");
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const confirm = vi.fn(() => true);
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    await app.invoke("hide_panel");
    await app.invoke("quit", new Uint8Array());
    expect(close).toHaveBeenCalledTimes(2);
    expect(await app.invoke("confirm", { title: "Delete?", message: "It goes for good.", ok: "Delete" })).toBe(true);
    expect(confirm).toHaveBeenCalledWith("Delete?\n\nIt goes for good.");
    expect(await app.invoke("menu_state", { items: {} })).toBeUndefined();
  });

  it("hears the background's events: everyone's, and its own window's", async () => {
    const server = startCommandServer({});
    const app = createWebPlatform("review-1");
    const all = vi.fn();
    const own = vi.fn();
    const stop = await app.listen("snapshot", all);
    await app.listenToWindow("review-open", own);
    await app.listen("review-open", all);
    server.broadcast("snapshot", 1);
    server.broadcast("review-open", "not mine");
    server.emitTo("review-1", "review-open", { id: "PR_1" });
    server.broadcast("nobody-listens");
    stop();
    server.broadcast("snapshot", 2);
    expect(all.mock.calls).toEqual([[1], ["not mine"], [{ id: "PR_1" }]]);
    expect(own.mock.calls).toEqual([[{ id: "PR_1" }]]);
  });

  it("sends an event to another window, or says it isn't open", async () => {
    const server = startCommandServer({});
    const settings = createWebPlatform("settings");
    const pane = vi.fn();
    await settings.listenToWindow("settings-pane", pane);
    const setup = createWebPlatform("setup");
    await setup.emitTo("settings", "settings-pane", "ai");
    await setup.emitTo("settings", "settings-pane");
    expect(pane.mock.calls).toEqual([["ai"], [null]]);
    await expect(setup.emitTo("panel", "x")).rejects.toBe("No window named panel");
    expect(server.pages().map((page) => page.window)).toEqual(["settings", "setup"]);
  });

  it("knows its version, and closes its tab or the popup", async () => {
    startCommandServer({});
    const app = createWebPlatform("settings");
    vi.spyOn(fakeBrowser.runtime, "getManifest").mockReturnValue({ version: "2.0.0" } as Browser.runtime.Manifest);
    expect(await app.version()).toBe("2.0.0");
    const remove = vi.spyOn(fakeBrowser.tabs, "remove").mockResolvedValue();
    const current = vi.spyOn(fakeBrowser.tabs, "getCurrent").mockResolvedValue({ id: 4 } as never);
    await app.closeWindow();
    expect(remove).toHaveBeenCalledWith(4);
    current.mockResolvedValue(undefined);
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    await app.closeWindow();
    expect(close).toHaveBeenCalled();
  });

  it("connects again when the background goes away, and what was on its way is asked again by the screens", async () => {
    const pending = Promise.withResolvers<unknown>();
    const server = startCommandServer({ snapshot: () => pending.promise });
    const app = createWebPlatform("panel");
    const heard = vi.fn();
    await app.listen("snapshot", heard);
    const asking = app.invoke("snapshot");
    await settle();
    ports.connections[0]!.background.disconnect();
    await expect(asking).rejects.toBe(GONE);
    expect(ports.connections).toHaveLength(2);
    server.broadcast("snapshot", "again");
    expect(heard).toHaveBeenCalledWith("again");
    // A late answer for a request that's gone is let go.
    pending.resolve(1);
    await settle();
  });

  it("tells the background it's still there", () => {
    vi.useFakeTimers();
    startCommandServer({});
    createWebPlatform("panel");
    const sent = vi.spyOn(ports.connections[0]!.page, "postMessage");
    vi.advanceTimersByTime(PING_MS);
    expect(sent).toHaveBeenCalledWith({ type: "ping" });
  });
});
