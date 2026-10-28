export type Args = Record<string, unknown> | Uint8Array;

export type InvokeOptions = { headers: Record<string, string> };

export type Unlisten = () => void;

export type Media = "avatar" | "media";

export interface Platform {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the shape the app answers in
  invoke: <T>(command: string, args?: Args, options?: InvokeOptions) => Promise<T>;
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listen: <T>(event: string, handler: (payload: T) => void) => Promise<Unlisten>;
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listenToWindow: <T>(event: string, handler: (payload: T) => void) => Promise<Unlisten>;
  emitTo: (window: string, event: string, payload?: unknown) => Promise<void>;
  version: () => Promise<string>;
  closeWindow: () => Promise<void>;
  mediaUrl?: (kind: Media, url: string) => string;
}

declare global {
  interface Window {
    focusDiffPlatform?: Platform;
  }
}

export function setPlatform(app: Platform) {
  window.focusDiffPlatform = app;
}

export function platform(): Platform {
  const current = window.focusDiffPlatform;
  if (!current) throw new Error("No platform: the page's entry calls setPlatform() before anything else.");
  return current;
}

export const invoke = <T>(command: string, args?: Args, options?: InvokeOptions): Promise<T> =>
  platform().invoke<T>(command, args, options);
