export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

export const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export const oneOf = <T>(list: readonly T[], value: unknown, fallback: T): T =>
  list.find((each) => each === value) ?? fallback;

export const keysOf = <K extends string>(record: Record<K, unknown>): K[] =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys widens to string; the type says which.
  Object.keys(record) as K[];

export const recordOf = <K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.fromEntries widens the keys to string.
  Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;
