import type { Unlisten } from "@/utils/platform/platform";

export type Args = Record<string, unknown>;

export const isRecord = (value: unknown): value is Args =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const str = (args: Args, key: string): string => {
  const value = args[key];
  return typeof value === "string" ? value : "";
};

export const maybeStr = (args: Args, key: string): string | null => {
  const value = args[key];
  return typeof value === "string" ? value : null;
};

export const strings = (args: Args, key: string): string[] | undefined => {
  const value: unknown = args[key];
  return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : undefined;
};

export const json = (args: Args, key: string): Args => {
  const parsed: unknown = JSON.parse(maybeStr(args, key) ?? "{}");
  return isRecord(parsed) ? parsed : {};
};

export const texts = (args: Args): Record<string, string> =>
  Object.fromEntries(Object.entries(args).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

// oxlint-disable-next-line eslint/prefer-promise-reject-errors, typescript/prefer-promise-reject-errors -- the app's commands reject with their plain error value, and the page expects that shape.
export const fail = (reason: unknown): Promise<never> => Promise.reject(reason);

export const now = Date.now();
export const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const person = (login: string, name: string) => ({
  __typename: "User",
  login,
  name,
  avatarUrl: `https://avatars.githubusercontent.com/${login}?s=64`,
});
export const people = {
  me: person("you_reviewer", "You"),
  ana: person("ana_lima", "Ana Lima"),
  bruno: person("bruno_costa", "Bruno Costa"),
  carla: person("carla_dias", "Carla Dias"),
  dev: person("devon_hart", "Devon Hart"),
};

const listeners = new Map<string, Set<(payload: unknown) => void>>();

export const emitEvent = (event: string, payload?: unknown) => {
  for (const heard of listeners.get(event) ?? []) heard(payload);
};

export const clearListeners = () => {
  listeners.clear();
};

// oxlint-disable-next-line typescript/require-await, typescript/no-unnecessary-type-parameters -- a promise, as the real one's registering is; the caller names the payload
export async function listen<T>(event: string, handler: (payload: T) => void): Promise<Unlisten> {
  const heard = (payload: unknown) => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the sender sends the payload the listener names
    handler(payload as T);
  };
  const set = listeners.get(event) ?? new Set();
  listeners.set(event, set.add(heard));
  return () => {
    set.delete(heard);
  };
}
