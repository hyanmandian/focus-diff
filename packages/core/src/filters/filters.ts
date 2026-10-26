/** A path filter: the files whose paths match `include` (all, when empty) and not `exclude`. */
export interface PathPatterns {
  include: string;
  exclude: string;
}

export type Matcher = (path: string) => boolean;

export type Compiled = { ok: true; regex: RegExp | null } | { ok: false; error: string };

/**
 * A pattern someone wrote, as a case-insensitive regular expression: no regex when it's empty, or what's wrong with it.
 * Case doesn't matter, so a filter shared between the extension and the desktop app keeps the same files.
 */
export const compile = (source: string): Compiled => {
  if (!source) return { ok: true, regex: null };
  try {
    // oxlint-disable-next-line eslint/require-unicode-regexp -- the reader's own patterns: the u flag would reject some that work today.
    return { ok: true, regex: new RegExp(source, "i") };
  } catch (error) {
    return {
      ok: false,
      error: (error instanceof Error ? error.message : String(error)).replace(/^Invalid regular expression: /u, ""),
    };
  }
};

/** Whether a pattern is empty or a valid regular expression. */
export const isValidPattern = (source: string): boolean => compile(source).ok;

/** A filter ready to test paths with, or null when either of its patterns is broken. */
export const toMatcher = (filter: PathPatterns): Matcher | null => {
  const include = compile(filter.include);
  const exclude = compile(filter.exclude);
  if (!include.ok || !exclude.ok) return null;
  return (path) => (!include.regex || include.regex.test(path)) && !exclude.regex?.test(path);
};

/**
 * Whether a file is in a filter, leniently: a broken include leaves every file in, and a broken exclude leaves
 * nothing out. For where a filter can't be turned away, unlike {@link toMatcher}, which rejects it.
 */
export const inFilter = (filter: PathPatterns, path: string): boolean => {
  const include = compile(filter.include);
  if (!include.ok) return true;
  if (include.regex && !include.regex.test(path)) return false;
  const exclude = compile(filter.exclude);
  return !exclude.ok || !exclude.regex?.test(path);
};
