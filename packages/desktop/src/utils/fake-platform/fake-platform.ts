import { clearListeners, emitEvent, listen } from "@/utils/mock-ipc/mock-ipc";
import type { Args, InvokeOptions, Platform } from "@/utils/platform/platform";

export const VERSION = "platform:version";
export const CLOSE_WINDOW = "platform:closeWindow";
export const EMIT_TO = "platform:emitTo";

type Handler = (command: string, args?: Args, options?: InvokeOptions) => unknown;

let answering: Handler | null = null;

export function mockCommands(answer: Handler) {
  answering = answer;
}

export function clearMocks() {
  answering = null;
  clearListeners();
}

// oxlint-disable-next-line typescript/require-await -- a promise, as the real one's sending is
export async function emit(event: string, payload?: unknown) {
  emitEvent(event, payload);
}

// oxlint-disable-next-line typescript/require-await -- async so a throw becomes a rejection
async function ask<T>(command: string, args: Args = {}, options?: InvokeOptions): Promise<T> {
  if (!answering) throw new Error(`Nothing answers ${command}: the test calls mockCommands first.`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test answers in the shape the caller names
  return answering(command, args, options) as T;
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

export type Call = { cmd: string; fields: Record<string, unknown> };

export const fieldsOf = (args: Args | undefined): Record<string, unknown> =>
  args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array ? {} : args;

export const ok = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

export function recordCommands(answer: (cmd: string, fields: Record<string, unknown>, calls: Call[]) => unknown) {
  const calls: Call[] = [];
  mockCommands((cmd, args) => {
    const call = { cmd, fields: fieldsOf(args) };
    calls.push(call);
    return answer(cmd, call.fields, calls);
  });
  return calls;
}

export const replyInOrder = (...replies: unknown[]) =>
  recordCommands((_cmd, _fields, calls) => replies[calls.length - 1]);

export type GitHubRequest = { method: string; path: string; body: string; accept: unknown };

export function answerGitHub(answer: (request: GitHubRequest) => unknown) {
  const asked: GitHubRequest[] = [];
  mockCommands(async (_cmd, args) => {
    const fields = fieldsOf(args);
    const request = {
      method: String(fields.method),
      path: String(fields.path),
      body: String(fields.body),
      accept: fields.accept,
    };
    asked.push(request);
    const reply: unknown = await answer(request);
    return { status: 200, body: typeof reply === "string" ? reply : JSON.stringify(reply) };
  });
  return asked;
}

export const sentJson = (request: GitHubRequest | undefined): unknown => JSON.parse(String(request?.body));

export function answerConfirm(answer: boolean) {
  const asked: string[] = [];
  mockCommands((cmd, args) => {
    if (cmd !== "confirm") return null;
    const { title } = fieldsOf(args);
    asked.push(typeof title === "string" ? title : "");
    return answer;
  });
  return asked;
}

export function openedUrls() {
  const urls: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "open_url") urls.push(fieldsOf(args).url);
  });
  return urls;
}
