import { describe, expect, it } from 'vitest';
import { compile, filtersFor, normalize, REPO_PATTERN, repoMatches, toMatcher } from '@/utils/filters/filters';

const match = (filter: { include?: string; exclude?: string }, path: string) => toMatcher({ include: '', exclude: '', ...filter })?.(path);

describe('toMatcher', () => {
  it('keeps paths that match include and not exclude', () => {
    const frontend = { include: '\\.(ts|tsx)$', exclude: '\\.(test|stories)\\.' };
    expect(match(frontend, 'web/src/book-card.tsx')).toBe(true);
    expect(match(frontend, 'web/src/book-card.test.tsx')).toBe(false);
    expect(match(frontend, 'web/src/book-card.stories.tsx')).toBe(false);
    expect(match(frontend, 'api/books/service.py')).toBe(false);
  });

  it('treats an empty include as everything', () => {
    expect(match({ exclude: '\\.md$' }, 'src/index.ts')).toBe(true);
    expect(match({ exclude: '\\.md$' }, 'README.md')).toBe(false);
  });

  it('ignores case', () => {
    expect(match({ include: 'readme' }, 'README.md')).toBe(true);
  });

  it('returns null for invalid regexes', () => {
    expect(toMatcher({ include: '(', exclude: '' })).toBeNull();
    expect(compile('(')).toMatchObject({ ok: false });
  });
});

describe('repoMatches', () => {
  it('matches exact names and owner wildcards, ignoring case', () => {
    expect(repoMatches('Octo/Web', 'octo/web')).toBe(true);
    expect(repoMatches('octo/*', 'octo/api')).toBe(true);
    expect(repoMatches('octo/*', 'other/api')).toBe(false);
    expect(repoMatches('octo/web', 'octo/website')).toBe(false);
    // Sites that nest groups, like GitLab, have deeper paths; a group's pattern covers its subgroups.
    expect(repoMatches('group/*', 'group/sub/web')).toBe(true);
  });
});

describe('filtersFor', () => {
  it('puts global filters first, then the matching repository filters', () => {
    const config = normalize({
      global: [{ name: 'Docs', include: '\\.md$' }],
      repos: [
        { repo: 'octo/web', filters: [{ name: 'Web only' }] },
        { repo: 'octo/*', filters: [{ name: 'Org' }] },
        { repo: 'other/x', filters: [{ name: 'Elsewhere' }] },
      ],
    });
    expect(filtersFor(config, 'octo/web').map((filter) => filter.name)).toEqual(['Docs', 'Web only', 'Org']);
  });
});

describe('normalize', () => {
  it('drops malformed entries and fills defaults', () => {
    const config = normalize({ global: [{ name: ' Docs ' }, null, { include: 'x' }], repos: [{ filters: [] }, 'x'] });
    expect(config.global).toEqual([{ id: expect.any(String), name: 'Docs', include: '', exclude: '' }]);
    expect(config.repos).toEqual([]);
  });

  it('gives every filter a unique id that is never "all"', () => {
    const ids = normalize({
      global: [
        { id: 'all', name: 'A' },
        { id: 'x', name: 'B' },
        { id: 'x', name: 'C' },
      ],
    }).global.map((filter) => filter.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain('all');
    expect(ids[1]).toBe('x');
  });

  it('handles empty input', () => {
    expect(normalize(undefined)).toEqual({ global: [], repos: [] });
  });
});

describe('REPO_PATTERN', () => {
  it('takes owner/name, nested groups and wildcards, but not a lone name', () => {
    for (const repo of ['octo/web', 'octo/*', 'group/sub/web', 'group/sub/*']) expect(REPO_PATTERN.test(repo), repo).toBe(true);
    for (const repo of ['web', 'octo/', '/web', 'octo web/x']) expect(REPO_PATTERN.test(repo), repo).toBe(false);
  });
});
