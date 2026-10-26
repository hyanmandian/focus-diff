// The background's side of the pages' ports (utils/port-protocol): it answers each page's commands with the handlers
// it's given, as the desktop's Rust answers its windows', and sends events to every open page or to one window.

import { browser, type Browser } from "wxt/browser";

import {
  PORT_PREFIX,
  toBytes,
  toError,
  type BackgroundMessage,
  type PageMessage,
} from "@/utils/port-protocol/port-protocol";

/** The page a command came from: the window it is, and its tab when it's in one (not the popup). */
export interface Sender {
  window: string;
  tabId?: number;
  windowId?: number;
}

/** Answers one command: its arguments as the page sent them, and which page sent them. */
export type Command = (args: Record<string, unknown>, from: Sender) => unknown;

export type Commands = Record<string, Command>;

export interface CommandServer {
  /** An event to every open page. */
  broadcast: (event: string, payload?: unknown) => void;
  /** An event to the pages that are this window; false when none is open. */
  emitTo: (window: string, event: string, payload?: unknown) => boolean;
  /** The pages open now. */
  pages: () => Sender[];
  /** Calls `listener` as each page opens (or connects again after the background restarted). */
  onConnect: (listener: (page: Sender) => void) => void;
}

/** Said when a page asks for a command nobody answers. */
export const unknownCommand = (command: string) => `Unknown command: ${command}`;

/** A window that isn't open, as the desktop's emitTo says it. */
export const notOpen = (window: string) => `No window named ${window}`;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

/** Starts answering the pages' ports with `commands`, once `ready` (the commands still being set up) has settled. */
export const startCommandServer = (commands: Commands, ready: Promise<unknown> = Promise.resolve()): CommandServer => {
  const ports = new Map<Browser.runtime.Port, Sender>();
  const connected: Array<(page: Sender) => void> = [];

  const send = (port: Browser.runtime.Port, message: BackgroundMessage) => {
    try {
      port.postMessage(message);
    } catch {
      // The page closed as its answer was on its way.
      ports.delete(port);
    }
  };

  const emitTo = (window: string, event: string, payload: unknown = null) => {
    let found = false;
    for (const [port, page] of ports) {
      if (page.window !== window) continue;
      found = true;
      send(port, { type: "event", event, payload, own: true });
    }
    return found;
  };

  const answer = async (port: Browser.runtime.Port, page: Sender, message: PageMessage) => {
    if (message.type === "ping") return;
    try {
      let value: unknown;
      if (message.type === "emit") {
        if (!emitTo(message.window, message.event, message.payload)) throw new Error(notOpen(message.window));
      } else {
        await ready;
        const command = Object.hasOwn(commands, message.command) ? commands[message.command] : undefined;
        if (!command) throw new Error(unknownCommand(message.command));
        value = await command(isRecord(message.args) ? message.args : {}, page);
      }
      send(port, {
        type: "reply",
        id: message.id,
        ok: true,
        value: value instanceof Uint8Array ? toBytes(value) : value,
      });
    } catch (error) {
      send(port, { type: "reply", id: message.id, ok: false, error: toError(error) });
    }
  };

  browser.runtime.onConnect.addListener((port) => {
    if (!port.name.startsWith(PORT_PREFIX)) return;
    const tab = port.sender?.tab;
    const page: Sender = {
      window: port.name.slice(PORT_PREFIX.length),
      ...(tab?.id === undefined ? {} : { tabId: tab.id, windowId: tab.windowId }),
    };
    ports.set(port, page);
    port.onMessage.addListener((message: PageMessage) => void answer(port, page, message));
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
    for (const listener of connected) listener(page);
  });

  return {
    broadcast: (event, payload = null) => {
      for (const port of ports.keys()) send(port, { type: "event", event, payload, own: false });
    },
    emitTo,
    pages: () => [...ports.values()],
    onConnect: (listener) => {
      connected.push(listener);
    },
  };
};
