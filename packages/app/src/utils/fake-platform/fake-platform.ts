// Tests only: the platform the unit tests run on (utils/test-setup sets it before each file). A test
// answers what the screens ask with mockCommands, as the app's native side would, and sends events
// with emit. Besides the app's own commands, the handler hears the platform's other requests by
// these names, so a test can answer or count them like any command.

import type { Args, InvokeOptions, Platform, Unlisten } from "../platform/platform";

/** Platform.version, as a command. */
export const VERSION = "platform:version";
/** Platform.closeWindow, as a command. */
export const CLOSE_WINDOW = "platform:closeWindow";
/** Platform.emitTo, as a command with `{ window, event, payload }`. */
export const EMIT_TO = "platform:emitTo";

/** Answers a command, as it would come back from the app (a value, a promise, or a throw). */
export type Handler = (command: string, args?: Args, options?: InvokeOptions) => unknown;

let answering: Handler | null = null;
const listeners = new Map<string, Set<(payload: unknown) => void>>();

/** Answers every command with `answer` from now on. */
export function mockCommands(answer: Handler) {
  answering = answer;
}

/** Forgets the answers and every listener. */
export function clearMocks() {
  answering = null;
  listeners.clear();
}

/** Sends an event to everything listening, as the app would. */
// oxlint-disable-next-line typescript/require-await -- a promise, as the real one's sending is
export async function emit(event: string, payload?: unknown) {
  for (const heard of listeners.get(event) ?? []) heard(payload);
}

// Async, so an answer that throws comes back as a refusal, as the app's do; with no answers set,
// every command is refused.
// oxlint-disable-next-line typescript/require-await -- async so a throw becomes a rejection
async function ask<T>(command: string, args: Args = {}, options?: InvokeOptions): Promise<T> {
  if (!answering) throw new Error(`Nothing answers ${command}: the test calls mockCommands first.`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers in the shape the caller names
  return answering(command, args, options) as T;
}

// oxlint-disable-next-line typescript/require-await, typescript/no-unnecessary-type-parameters -- a promise, as the real one's registering is; the caller names the payload
async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  // A listener of its own each time, as the app's, even for the same handler twice.
  const heard = (payload: unknown) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test sends the payload the listener names
    handler(payload as T);
  };
  const set = listeners.get(event) ?? new Set();
  listeners.set(event, set.add(heard));
  return () => {
    set.delete(heard);
  };
}

export const fakePlatform: Platform = {
  invoke: ask,
  listen,
  listenToWindow: listen,
  emitTo: async (window, event, payload) => {
    await ask(EMIT_TO, { window, event, payload });
  },
  version: () => ask<string>(VERSION),
  closeWindow: async () => {
    await ask(CLOSE_WINDOW);
  },
};
