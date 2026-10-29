import type { Args, InvokeOptions, Platform, Unlisten } from "@/utils/platform/platform";

export const VERSION = "platform:version";
export const CLOSE_WINDOW = "platform:closeWindow";
export const EMIT_TO = "platform:emitTo";

type Handler = (command: string, args?: Args, options?: InvokeOptions) => unknown;

let answering: Handler | null = null;
const listeners = new Map<string, Set<(payload: unknown) => void>>();

export function mockCommands(answer: Handler) {
  answering = answer;
}

export function clearMocks() {
  answering = null;
  listeners.clear();
}

// oxlint-disable-next-line typescript/require-await -- a promise, as the real one's sending is
export async function emit(event: string, payload?: unknown) {
  for (const heard of listeners.get(event) ?? []) heard(payload);
}

// oxlint-disable-next-line typescript/require-await -- async so a throw becomes a rejection
async function ask<T>(command: string, args: Args = {}, options?: InvokeOptions): Promise<T> {
  if (!answering) throw new Error(`Nothing answers ${command}: the test calls mockCommands first.`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers in the shape the caller names
  return answering(command, args, options) as T;
}

// oxlint-disable-next-line typescript/require-await, typescript/no-unnecessary-type-parameters -- a promise, as the real one's registering is; the caller names the payload
async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
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
