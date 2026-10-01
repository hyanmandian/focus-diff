var FocusDiff = (() => {
  const ALL = 'all';

  const EXAMPLE_CONFIG = {
    global: [
      { id: 'frontend', name: 'Frontend', include: '\\.(ts|tsx|js|jsx)$', exclude: '\\.(test|spec|stories)\\.' },
      { id: 'backend', name: 'Backend', include: '\\.py$', exclude: '(^|/)tests/' },
      { id: 'docs', name: 'Docs', include: '\\.mdx?$', exclude: '' },
    ],
    repos: [],
  };

  const newId = () => Math.random().toString(36).slice(2, 10);

  const compile = (source) => {
    if (!source) return { ok: true, regex: null };
    try {
      return { ok: true, regex: new RegExp(source, 'i') };
    } catch (error) {
      return { ok: false, error: error.message.replace(/^Invalid regular expression: /, '') };
    }
  };

  const toMatcher = (filter) => {
    const include = compile(filter.include);
    const exclude = compile(filter.exclude);
    if (!include.ok || !exclude.ok) return null;
    return (path) => (!include.regex || include.regex.test(path)) && !(exclude.regex && exclude.regex.test(path));
  };

  const REPO_PATTERN = /^[^/\s]+\/[^/\s]+$/;

  const repoMatches = (pattern, repo) => {
    const key = pattern.trim().toLowerCase();
    const target = repo.toLowerCase();
    return key === target || (key.endsWith('/*') && target.startsWith(key.slice(0, -1)));
  };

  const filtersFor = (config, repo) => [
    ...config.global,
    ...config.repos.filter((entry) => entry.repo && repoMatches(entry.repo, repo)).flatMap((entry) => entry.filters),
  ];

  const normalize = (config) => {
    const seen = new Set([ALL]);
    const uniqueId = (id) => {
      let next = typeof id === 'string' && id ? id : newId();
      while (seen.has(next)) next = newId();
      seen.add(next);
      return next;
    };
    const filters = (list) =>
      (Array.isArray(list) ? list : [])
        .filter((filter) => filter && typeof filter.name === 'string')
        .map((filter) => ({
          id: uniqueId(filter.id),
          name: filter.name.trim(),
          include: typeof filter.include === 'string' ? filter.include : '',
          exclude: typeof filter.exclude === 'string' ? filter.exclude : '',
        }));
    return {
      global: filters(config?.global),
      repos: (Array.isArray(config?.repos) ? config.repos : [])
        .filter((entry) => entry && typeof entry.repo === 'string')
        .map((entry) => ({ repo: entry.repo.trim(), filters: filters(entry.filters) })),
    };
  };

  const load = async () => normalize((await chrome.storage.sync.get('config')).config);

  const save = (config) => chrome.storage.sync.set({ config: normalize(config) });

  const formatNumber = new Intl.NumberFormat('en-US').format;

  const isEmpty = (config) => config.global.length === 0 && config.repos.length === 0;

  return {
    ALL,
    EXAMPLE_CONFIG,
    REPO_PATTERN,
    newId,
    compile,
    toMatcher,
    repoMatches,
    filtersFor,
    normalize,
    load,
    save,
    isEmpty,
    formatNumber,
  };
})();
