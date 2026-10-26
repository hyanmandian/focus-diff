// Development only: reading what the page sends with a command, and answering it the way the app
// does, for the sample data (utils/mock/mock.ts and its neighbours).

/** A command's arguments, or any JSON object the page sent. */
export type Args = Record<string, unknown>;

export const isRecord = (value: unknown): value is Args =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A text argument; "" when it isn't one. */
export const str = (args: Args, key: string): string => {
  const value = args[key];
  return typeof value === "string" ? value : "";
};

/** A text argument that may be left out (or null). */
export const maybeStr = (args: Args, key: string): string | null => {
  const value = args[key];
  return typeof value === "string" ? value : null;
};

/** A list of texts, when that's what was sent. */
export const strings = (args: Args, key: string): string[] | undefined => {
  const value: unknown = args[key];
  return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : undefined;
};

/** The JSON object sent as text under `key` (a request's body), or an empty one. */
export const json = (args: Args, key: string): Args => {
  const parsed: unknown = JSON.parse(maybeStr(args, key) ?? "{}");
  return isRecord(parsed) ? parsed : {};
};

/** Just the text values of an object, as GraphQL variables mostly are. */
export const texts = (args: Args): Record<string, string> =>
  Object.fromEntries(Object.entries(args).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

/** Settles after `ms`, as if over the network. */
export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** A refusal, as an app command's: what it returns as its error (Rust's, in the desktop), not an Error. */
// oxlint-disable-next-line eslint/prefer-promise-reject-errors, typescript/prefer-promise-reject-errors -- the app's commands reject with their plain error value, and the page expects that shape.
export const fail = (reason: unknown): Promise<never> => Promise.reject(reason);
