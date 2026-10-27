// The Mac app as the screens' platform (src/utils/platform): Rust's commands and events
// through Tauri, its windows, and the custom schemes that serve GitHub's pictures from the app's cache.
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Platform } from "@/utils/platform/platform";

/** A custom scheme's address: http://<scheme>.localhost on Windows (WebView2), <scheme>://localhost elsewhere. */
const scheme = (name: string) =>
  navigator.userAgent.includes("Windows") ? `http://${name}.localhost` : `${name}://localhost`;

export const tauriPlatform: Platform = {
  invoke,
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listen: <T>(event: string, handler: (payload: T) => void) =>
    listen<T>(event, (e) => {
      handler(e.payload);
    }),
  // The event module's listen hears every window's; this window's own only.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listenToWindow: <T>(event: string, handler: (payload: T) => void) =>
    getCurrentWebviewWindow().listen<T>(event, (e) => {
      handler(e.payload);
    }),
  emitTo: (window, event, payload) => emitTo(window, event, payload),
  version: () => getVersion(),
  closeWindow: () => getCurrentWindow().close(),
  // src-tauri/src/avatars.rs and media.rs.
  mediaUrl: (kind, url) => {
    if (kind === "media") return `${scheme("media")}/?u=${encodeURIComponent(url)}`;
    const u = new URL(url);
    return `${scheme("avatar")}${u.pathname}${u.search}`;
  },
};
