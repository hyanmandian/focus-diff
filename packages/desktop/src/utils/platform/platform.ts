// What the screens need from the app, and nothing else: its native side's commands and events, the
// windows, its version. The app plugs in Tauri (utils/tauri-platform), `vp dev` and the end-to-end tests
// the sample data (utils/mock), the unit tests a fake (utils/fake-platform). Each page's entry sets it
// once, before anything is drawn.

/** A command's arguments: named values, or raw bytes sent as they are (with headers to name them). */
export type Args = Record<string, unknown> | Uint8Array;

export type InvokeOptions = { headers: Record<string, string> };

/** Stops hearing an event. */
export type Unlisten = () => void;

/** What a picture or video from GitHub is: a person's avatar, or an attachment in a comment. */
export type Media = "avatar" | "media";

export interface Platform {
  /** Runs one of the app's commands (the desktop's are Rust's, src-tauri/src/lib.rs) and answers what it
   *  returns; rejects with the command's error as it is, not always an Error. */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the shape the app answers in
  invoke: <T>(command: string, args?: Args, options?: InvokeOptions) => Promise<T>;
  /** Hears an event, from the app or any of its windows, until the returned function is called. */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listen: <T>(event: string, handler: (payload: T) => void) => Promise<Unlisten>;
  /** Hears an event sent to this window alone. */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the caller names the payload the app sends
  listenToWindow: <T>(event: string, handler: (payload: T) => void) => Promise<Unlisten>;
  /** Sends an event to one window, by its name ("settings"); rejects when it isn't open. */
  emitTo: (window: string, event: string, payload?: unknown) => Promise<void>;
  /** The app's version, as "1.2.3". */
  version: () => Promise<string>;
  /** Closes the window this page is in. */
  closeWindow: () => Promise<void>;
  /** Where a picture or video from GitHub loads from, when the app keeps copies of them (the desktop's
   *  avatar:// and media:// schemes); without it, from GitHub itself. */
  mediaUrl?: (kind: Media, url: string) => string;
}

declare global {
  interface Window {
    /** The app's platform, set by its entry. On the page rather than in this module, so a module
     *  loaded afresh (a test's vi.resetModules) finds the same one; the end-to-end tests read it too. */
    focusDiffPlatform?: Platform;
  }
}

/** Plugs the app in. Every page's entry calls it first. */
export function setPlatform(app: Platform) {
  window.focusDiffPlatform = app;
}

/** The app the screens run in. */
export function platform(): Platform {
  const current = window.focusDiffPlatform;
  if (!current) throw new Error("No platform: the page's entry calls setPlatform() before anything else.");
  return current;
}

/** One of the app's commands (Platform.invoke), through the platform set now. */
export const invoke = <T>(command: string, args?: Args, options?: InvokeOptions): Promise<T> =>
  platform().invoke<T>(command, args, options);
