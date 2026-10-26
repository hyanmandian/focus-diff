// What the extension's pages (the panel in the popup, Settings, setup, a review) and the background say to each other
// over a port: the app's commands by name, as the desktop's pages ask Rust (@focus-diff/app's utils/bridge), and the
// events the background sends back. Messages cross as JSON, so bytes go as base64 inside a marked object.

/** The port's name: which window a page is, as the app names its windows ("panel", "settings", "review-3"). */
export const PORT_PREFIX = "focus-diff:";

/** What a page asks: one of the app's commands, or an event for another window. */
export type PageRequest =
  | { type: "invoke"; command: string; args: unknown }
  | { type: "emit"; window: string; event: string; payload: unknown };

/** A page's message: a request, numbered for its answer, or a ping. */
export type PageMessage =
  | (PageRequest & { id: number })
  /** Keeps the background awake while a page is open; it needs no answer. */
  | { type: "ping" };

/** The background's answer to a request, or an event: to every page, or to this one alone (`own`). */
export type BackgroundMessage =
  | { type: "reply"; id: number; ok: true; value: unknown }
  | { type: "reply"; id: number; ok: false; error: unknown }
  | { type: "event"; event: string; payload: unknown; own: boolean };

/** Bytes as they cross a port. */
export type Bytes = { $bytes: string };

export const isBytes = (value: unknown): value is Bytes =>
  typeof value === "object" && value !== null && typeof (value as { $bytes?: unknown }).$bytes === "string";

const CHUNK = 0x8000;

/** Bytes as base64, for a message. */
export const toBytes = (bytes: Uint8Array): Bytes => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK) binary += String.fromCodePoint(...bytes.subarray(at, at + CHUNK));
  return { $bytes: btoa(binary) };
};

/** The bytes a message carried. */
export const fromBytes = ({ $bytes }: Bytes): Uint8Array => Uint8Array.from(atob($bytes), (c) => c.codePointAt(0)!);

/** A command's error as it can cross: a string or a plain object stays, an Error becomes its message. */
export const toError = (error: unknown): unknown =>
  error instanceof Error ? error.message : typeof error === "object" && error !== null ? error : String(error);
