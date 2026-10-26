import { describe, expect, it, vi } from "vitest";
import type { Browser } from "wxt/browser";

import { fakePorts } from "@/utils/fake-ports/fake-ports";
import type { BackgroundMessage } from "@/utils/port-protocol/port-protocol";

import { notOpen, startCommandServer, unknownCommand, type Commands } from "./command-server";

const connect = (name: string) => browser.runtime.connect({ name });

/** What a page's port hears. */
const heard = (port: Browser.runtime.Port) => {
  const messages: BackgroundMessage[] = [];
  port.onMessage.addListener((message: BackgroundMessage) => messages.push(message));
  return messages;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the background's command server", () => {
  const start = (commands: Commands = {}) => {
    const ports = fakePorts();
    return { ports, server: startCommandServer(commands) };
  };

  it("answers a page's commands with what they return, bytes as base64, and says why one failed", async () => {
    const asked = vi.fn();
    start({
      snapshot: (args, from) => {
        asked(args, from);
        return { ready: true };
      },
      github_file: () => new Uint8Array([104, 105]),
      broken: () => {
        throw new Error("GitHub returned 500");
      },
      refused: () => Promise.reject({ kind: "not_signed_in" }),
      odd: () => {
        // oxlint-disable-next-line typescript/only-throw-error -- Tauri's commands reject with strings, and so may these
        throw "absent";
      },
    });
    const page = connect("focus-diff:panel");
    const messages = heard(page);
    page.postMessage({ type: "invoke", id: 1, command: "snapshot", args: { force: true } });
    page.postMessage({ type: "invoke", id: 2, command: "github_file", args: null });
    page.postMessage({ type: "invoke", id: 3, command: "broken", args: {} });
    page.postMessage({ type: "invoke", id: 4, command: "refused", args: {} });
    page.postMessage({ type: "invoke", id: 5, command: "odd", args: {} });
    page.postMessage({ type: "invoke", id: 6, command: "toString", args: {} });
    page.postMessage({ type: "ping" });
    await settle();
    expect(asked).toHaveBeenCalledWith({ force: true }, { window: "panel" });
    expect(messages.toSorted((a, b) => (a.type === "reply" && b.type === "reply" ? a.id - b.id : 0))).toEqual([
      { type: "reply", id: 1, ok: true, value: { ready: true } },
      { type: "reply", id: 2, ok: true, value: { $bytes: "aGk=" } },
      { type: "reply", id: 3, ok: false, error: "GitHub returned 500" },
      { type: "reply", id: 4, ok: false, error: { kind: "not_signed_in" } },
      { type: "reply", id: 5, ok: false, error: "absent" },
      { type: "reply", id: 6, ok: false, error: unknownCommand("toString") },
    ]);
  });

  it("knows the pages open, and the tab each is in", async () => {
    const { ports, server } = start();
    const opened = vi.fn();
    server.onConnect(opened);
    connect("focus-diff:panel");
    ports.inTab({ id: 7, windowId: 2 } as Browser.tabs.Tab);
    const review = connect("focus-diff:review-1");
    connect("someone-else");
    expect(server.pages()).toEqual([{ window: "panel" }, { window: "review-1", tabId: 7, windowId: 2 }]);
    expect(opened).toHaveBeenCalledTimes(2);
    review.disconnect();
    expect(server.pages()).toEqual([{ window: "panel" }]);
  });

  it("sends events to every page, or to one window, and passes a page's event on", async () => {
    const { server } = start();
    const panel = heard(connect("focus-diff:panel"));
    const settings = connect("focus-diff:settings");
    const inSettings = heard(settings);
    server.broadcast("snapshot", { ready: true });
    server.broadcast("panel-shown");
    expect(server.emitTo("settings", "settings-pane", "ai")).toBe(true);
    expect(server.emitTo("setup", "anything")).toBe(false);
    settings.postMessage({ type: "emit", id: 1, window: "panel", event: "hello", payload: 1 });
    settings.postMessage({ type: "emit", id: 2, window: "setup", event: "hello", payload: 1 });
    await settle();
    expect(panel).toEqual([
      { type: "event", event: "snapshot", payload: { ready: true }, own: false },
      { type: "event", event: "panel-shown", payload: null, own: false },
      { type: "event", event: "hello", payload: 1, own: true },
    ]);
    expect(inSettings).toEqual([
      { type: "event", event: "snapshot", payload: { ready: true }, own: false },
      { type: "event", event: "panel-shown", payload: null, own: false },
      { type: "event", event: "settings-pane", payload: "ai", own: true },
      { type: "reply", id: 1, ok: true },
      { type: "reply", id: 2, ok: false, error: notOpen("setup") },
    ]);
  });

  it("forgets a page that closed as something was sent to it", () => {
    const { ports, server } = start();
    connect("focus-diff:panel");
    vi.spyOn(ports.connections[0]!.background, "postMessage").mockImplementation(() => {
      throw new Error("Attempting to use a disconnected port object");
    });
    server.broadcast("snapshot");
    expect(server.pages()).toEqual([]);
  });
});
