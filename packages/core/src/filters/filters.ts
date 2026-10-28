export interface PathPatterns {
  include: string;
  exclude: string;
}

export type Matcher = (path: string) => boolean;

export type Compiled = { ok: true; regex: RegExp | null } | { ok: false; error: string };

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

export const isValidPattern = (source: string): boolean => compile(source).ok;

export const toMatcher = (filter: PathPatterns): Matcher | null => {
  const include = compile(filter.include);
  const exclude = compile(filter.exclude);
  if (!include.ok || !exclude.ok) return null;
  return (path) => (!include.regex || include.regex.test(path)) && !exclude.regex?.test(path);
};

export const inFilter = (filter: PathPatterns, path: string): boolean => {
  const include = compile(filter.include);
  if (!include.ok) return true;
  if (include.regex && !include.regex.test(path)) return false;
  const exclude = compile(filter.exclude);
  return !exclude.ok || !exclude.regex?.test(path);
};
