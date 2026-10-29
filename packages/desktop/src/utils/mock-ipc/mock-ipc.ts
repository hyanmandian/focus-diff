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
