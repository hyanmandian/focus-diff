/** Reading values from storage and the network, which come in untyped, and building typed records. */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** The object's fields, or none when it isn't one. */
export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/** A string or a number as text; anything else as none. */
export const asText = (value: unknown): string =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

/** `value` when it's one of `list`, otherwise `fallback`. */
export const oneOf = <T>(list: readonly T[], value: unknown, fallback: T): T =>
  list.find((each) => each === value) ?? fallback;

/** The keys of a record whose keys are all `K`. */
export const keysOf = <K extends string>(record: Record<K, unknown>): K[] =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.keys widens to string; the type says which.
  Object.keys(record) as K[];

/** A record with an entry for each key. */
export const recordOf = <K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.fromEntries widens the keys to string.
  Object.fromEntries(keys.map((key) => [key, value(key)])) as Record<K, V>;
