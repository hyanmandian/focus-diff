/**
 * Reading JSON into typed shapes by serde's rules, as the desktop app's Rust side reads GitHub's replies and its own
 * files (`#[serde(default)]` structs): a missing field takes its default, `null` is only allowed where the field is
 * optional, and a value of the wrong type fails the whole shape. Unknown fields are ignored.
 */

/** A value that isn't what its shape expects (serde's "invalid type"). */
export class Mismatch extends Error {
  public constructor(what: string) {
    super(`expected ${what}`);
    this.name = "Mismatch";
  }
}

export type Fields = Readonly<Record<string, unknown>>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A struct: an object, or a mismatch (`null` included). */
export const fields = (value: unknown): Fields => {
  if (!isFields(value)) throw new Mismatch("an object");
  return value;
};

/** A `String` field: "" when missing. */
export const text = (o: Fields, key: string): string => {
  const value = o[key];
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Mismatch(`a string at ${key}`);
  return value;
};

/** An `Option<String>` field: null when missing or null. */
export const maybeText = (o: Fields, key: string): string | null => {
  const value = o[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new Mismatch(`a string at ${key}`);
  return value;
};

/** A `String` field with no default: missing is a mismatch too. */
export const requiredText = (o: Fields, key: string): string => {
  if (o[key] === undefined) throw new Mismatch(`a string at ${key}`);
  return text(o, key);
};

/** A `bool` field: `fallback` when missing. */
export const flag = (o: Fields, key: string, fallback = false): boolean => {
  const value = o[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Mismatch(`a boolean at ${key}`);
  return value;
};

/** An integer field (`u32`, `i64`…) within `min`..`max`: `fallback` when missing. */
export const integer = (
  o: Fields,
  key: string,
  { fallback = 0, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {},
): number => {
  const value = o[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Mismatch(`an integer at ${key}`);
  }
  return value;
};

/** The largest `u32`. */
export const U32 = 4_294_967_295;

/** A `Vec<String>` field: [] when missing. */
export const texts = (o: Fields, key: string): string[] => {
  const value = o[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Mismatch(`a list at ${key}`);
  return value.map((item: unknown) => {
    if (typeof item !== "string") throw new Mismatch(`strings at ${key}`);
    return item;
  });
};

/** A `Vec<T>` field: [] when missing; any item that doesn't read fails the list. */
export const list = <T>(o: Fields, key: string, read: (value: unknown) => T): T[] => {
  const value = o[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Mismatch(`a list at ${key}`);
  return value.map((item: unknown) => read(item));
};

/** An `Option<T>` field: null when missing or null. */
export const maybe = <T>(o: Fields, key: string, read: (value: unknown) => T): T | null => {
  const value = o[key];
  return value === undefined || value === null ? null : read(value);
};

/** A struct field that has a default: the default when missing, a mismatch when null. */
export const nested = <T>(o: Fields, key: string, read: (value: unknown) => T, fallback: () => T): T => {
  const value = o[key];
  return value === undefined ? fallback() : read(value);
};

/** One of an enum's names (`#[serde(other)]`): `fallback` when missing or unknown, a mismatch if not a string. */
export const choice = <T extends string>(o: Fields, key: string, names: readonly T[], fallback: T): T => {
  const value = o[key];
  if (value === undefined) return fallback;
  if (typeof value !== "string") throw new Mismatch(`a name at ${key}`);
  return names.find((name) => name === value) ?? fallback;
};

/** The shape read, or null where serde would have failed. */
export const attempt = <T>(read: () => T): T | null => {
  try {
    return read();
  } catch (error) {
    if (error instanceof Mismatch) return null;
    throw error;
  }
};
