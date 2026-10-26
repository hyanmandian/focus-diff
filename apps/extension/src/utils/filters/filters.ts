export const ALL = 'all';

/** A repository's path, `owner/name`, or deeper where a site nests groups, like `group/subgroup/name`. */
export const REPO_PATTERN = /^[^/\s]+(?:\/[^/\s]+)+$/;

export interface Filter {
  id: string;
  name: string;
  include: string;
  exclude: string;
}

export interface RepoFilters {
  repo: string;
  filters: Filter[];
}

export interface Config {
  global: Filter[];
  repos: RepoFilters[];
}

export type Matcher = (path: string) => boolean;

export type Compiled = { ok: true; regex: RegExp | null } | { ok: false; error: string };

export const newId = (): string => Math.random().toString(36).slice(2, 10);

export const compile = (source: string): Compiled => {
  if (!source) return { ok: true, regex: null };
  try {
    return { ok: true, regex: new RegExp(source, 'i') };
  } catch (error) {
    return { ok: false, error: (error as Error).message.replace(/^Invalid regular expression: /, '') };
  }
};

export const toMatcher = (filter: Pick<Filter, 'include' | 'exclude'>): Matcher | null => {
  const include = compile(filter.include);
  const exclude = compile(filter.exclude);
  if (!include.ok || !exclude.ok) return null;
  return (path) => (!include.regex || include.regex.test(path)) && !exclude.regex?.test(path);
};

export const repoMatches = (pattern: string, repo: string): boolean => {
  const key = pattern.trim().toLowerCase();
  const target = repo.toLowerCase();
  return key === target || (key.endsWith('/*') && target.startsWith(key.slice(0, -1)));
};

export const filtersFor = (config: Config, repo: string): Filter[] => [
  ...config.global,
  ...config.repos.filter((entry) => entry.repo && repoMatches(entry.repo, repo)).flatMap((entry) => entry.filters),
];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

export const normalize = (input: unknown): Config => {
  const seen = new Set([ALL]);
  const uniqueId = (id: unknown) => {
    let next = typeof id === 'string' && id ? id : newId();
    while (seen.has(next)) next = newId();
    seen.add(next);
    return next;
  };
  const filters = (list: unknown): Filter[] =>
    (Array.isArray(list) ? list : [])
      .filter((filter): filter is Record<string, unknown> => isRecord(filter) && typeof filter.name === 'string')
      .map((filter) => ({
        id: uniqueId(filter.id),
        name: text(filter.name).trim(),
        include: text(filter.include),
        exclude: text(filter.exclude),
      }));
  const config = isRecord(input) ? input : {};
  return {
    global: filters(config.global),
    repos: (Array.isArray(config.repos) ? config.repos : [])
      .filter((entry): entry is Record<string, unknown> => isRecord(entry) && typeof entry.repo === 'string')
      .map((entry) => ({ repo: text(entry.repo).trim(), filters: filters(entry.filters) })),
  };
};

export const isEmpty = (config: Config): boolean => config.global.length === 0 && config.repos.length === 0;
