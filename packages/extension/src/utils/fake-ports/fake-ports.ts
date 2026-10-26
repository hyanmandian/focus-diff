// Tests only: runtime ports between the pages and the background, which WXT's fake browser doesn't have. Messages are
// copied as JSON on the way, as Chrome does.

import { vi } from "vitest";
import type { Browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";

type Listener = (message: never) => void;

/** One end of a port, with the other's events wired to it. */
interface End {
  port: Browser.runtime.Port;
  messages: Set<Listener>;
  disconnects: Set<() => void>;
  other?: End;
}

const end = (name: string, sender?: Browser.runtime.MessageSender): End => {
  const messages = new Set<Listener>();
  const disconnects = new Set<() => void>();
  const self: End = {
    messages,
    disconnects,
    port: {
      name,
      sender,
      postMessage: (message: unknown) => {
        const copy = JSON.parse(JSON.stringify(message)) as never;
        for (const listener of self.other!.messages) listener(copy);
      },
      disconnect: () => {
        for (const listener of self.other!.disconnects) listener();
      },
      onMessage: {
        addListener: (listener: Listener) => messages.add(listener),
      },
      onDisconnect: {
        addListener: (listener: () => void) => disconnects.add(listener),
      },
    } as unknown as Browser.runtime.Port,
  };
  return self;
};

/** Gives the fake browser ports: `connect` from a page reaches the background's `onConnect` listeners. Returns each
 *  connection's two ends as they're made (`page`, `background`), and `tab` sets the tab the next pages are in. */
export const fakePorts = () => {
  const background = new Set<(port: Browser.runtime.Port) => void>();
  const connections: Array<{ page: Browser.runtime.Port; background: Browser.runtime.Port }> = [];
  let tab: Browser.tabs.Tab | undefined;
  Object.assign(fakeBrowser.runtime, {
    onConnect: {
      addListener: (listener: (port: Browser.runtime.Port) => void) => background.add(listener),
    },
    connect: vi.fn((info: { name: string }) => {
      const page = end(info.name);
      const there = end(info.name, tab ? { tab } : {});
      page.other = there;
      there.other = page;
      connections.push({ page: page.port, background: there.port });
      for (const listener of background) listener(there.port);
      return page.port;
    }),
  });
  return {
    connections,
    inTab: (next: Browser.tabs.Tab | undefined) => {
      tab = next;
    },
  };
};
