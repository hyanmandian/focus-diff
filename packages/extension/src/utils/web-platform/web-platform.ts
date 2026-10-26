// The browser extension as the screens' platform (@focus-diff/app's utils/platform): each page talks to the background
// over a port named for its window, which answers the app's commands as the desktop's Rust does (utils/commands) and
// sends its events back. A few commands are the page's own: closing itself, asking to confirm.

import type { Args, Platform, Unlisten } from "@focus-diff/app/utils/platform";
import { browser, type Browser } from "wxt/browser";

import {
  fromBytes,
  isBytes,
  PORT_PREFIX,
  toBytes,
  type BackgroundMessage,
  type PageMessage,
  type PageRequest,
} from "@/utils/port-protocol/port-protocol";

/** What the screens leave out in a browser: there's nothing to quit or update (the store does it), no AI tools, no
 *  commands to run, no attaching files as github.com does, and no menu bar. */
export const BROWSER_FEATURES = {
  quit: false,
  updates: false,
  ai: false,
  commands: false,
  uploads: false,
  tray: false,
} as const;

/** How often an open page tells the background it's still there, so the browser keeps it awake (it stops an idle one
 *  after 30 seconds). */
export const PING_MS = 20_000;

/** Said when the background went away while a command was on its way (the browser stopped it): asking again works. */
export const GONE = "Focus Diff's background stopped: try again";

type Pending = { resolve: (value: unknown) => void; reject: (error: unknown) => void };
type Listener = { handler: (payload: unknown) => void; own: boolean };

/** Closes this page: its tab, or the popup. */
const closePage = async () => {
  const tab = await browser.tabs.getCurrent();
  if (tab?.id === undefined) window.close();
  else await browser.tabs.remove(tab.id);
};

/** The page's own answers, without the background. */
const LOCAL: Record<string, (args: Record<string, unknown>) => unknown> = {
  hide_panel: () => window.close(),
  quit: () => window.close(),
  // The browser's own dialog: the title, then what it means; OK is the default.
  confirm: ({ title, message }) => window.confirm(`${String(title)}\n\n${String(message)}`),
  // Review windows' menu bar commands: a browser has no menu bar.
  menu_state: () => undefined,
};

/** The platform for a page that is the app's window `name`. */
export const createWebPlatform = (name: string): Platform => {
  const pending = new Map<number, Pending>();
  const listeners = new Map<string, Set<Listener>>();
  let port: Browser.runtime.Port | null = null;
  let next = 0;

  const receive = (message: BackgroundMessage) => {
    if (message.type === "event") {
      for (const listener of listeners.get(message.event) ?? []) {
        if (message.own || !listener.own) listener.handler(message.payload);
      }
      return;
    }
    const waiting = pending.get(message.id);
    pending.delete(message.id);
    if (message.ok) waiting?.resolve(message.value);
    else waiting?.reject(message.error);
  };

  const connect = (): Browser.runtime.Port => {
    if (port) return port;
    const opened = browser.runtime.connect({ name: `${PORT_PREFIX}${name}` });
    opened.onMessage.addListener(receive);
    opened.onDisconnect.addListener(() => {
      port = null;
      for (const waiting of pending.values()) waiting.reject(GONE);
      pending.clear();
      // Connected again at once, so the background hears of this page and sends its events.
      connect();
    });
    port = opened;
    return opened;
  };

  const request = (message: PageRequest) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve, reject });
      connect().postMessage({ ...message, id } satisfies PageMessage);
    });

  const addListener = (event: string, handler: (payload: unknown) => void, own: boolean): Promise<Unlisten> => {
    connect();
    const listener = { handler, own };
    const set = listeners.get(event) ?? new Set<Listener>();
    listeners.set(event, set.add(listener));
    return Promise.resolve(() => {
      set.delete(listener);
    });
  };

  connect();
  setInterval(() => {
    connect().postMessage({ type: "ping" } satisfies PageMessage);
  }, PING_MS);

  return {
    features: BROWSER_FEATURES,
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the shape the app answers in
    invoke: async <T>(command: string, args?: Args, options?: { headers: Record<string, string> }): Promise<T> => {
      const local = LOCAL[command];
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the page's own answers are the shapes the app asks for
      if (local) return local(args instanceof Uint8Array ? {} : (args ?? {})) as T;
      const sent = args instanceof Uint8Array ? { bytes: toBytes(args), headers: options?.headers ?? {} } : args;
      const value = await request({ type: "invoke", command, args: sent ?? {} });
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the background answers in the shape the caller names
      return (isBytes(value) ? fromBytes(value) : value) as T;
    },
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
    listen: <T>(event: string, handler: (payload: T) => void) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the background sends the payload the listener names
      addListener(event, (payload) => handler(payload as T), false),
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
    listenToWindow: <T>(event: string, handler: (payload: T) => void) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the background sends the payload the listener names
      addListener(event, (payload) => handler(payload as T), true),
    emitTo: async (window, event, payload) => {
      await request({ type: "emit", window, event, payload: payload ?? null });
    },
    version: () => Promise.resolve(browser.runtime.getManifest().version),
    closeWindow: closePage,
  };
};
