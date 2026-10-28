import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { Platform } from "@/utils/platform/platform";

const scheme = (name: string) =>
  navigator.userAgent.includes("Windows") ? `http://${name}.localhost` : `${name}://localhost`;

export const tauriPlatform: Platform = {
  invoke,
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listen: <T>(event: string, handler: (payload: T) => void) =>
    listen<T>(event, (e) => {
      handler(e.payload);
    }),
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listenToWindow: <T>(event: string, handler: (payload: T) => void) =>
    getCurrentWebviewWindow().listen<T>(event, (e) => {
      handler(e.payload);
    }),
  emitTo: (window, event, payload) => emitTo(window, event, payload),
  version: () => getVersion(),
  closeWindow: () => getCurrentWindow().close(),
  mediaUrl: (kind, url) => {
    if (kind === "media") return `${scheme("media")}/?u=${encodeURIComponent(url)}`;
    const u = new URL(url);
    return `${scheme("avatar")}${u.pathname}${u.search}`;
  },
};
