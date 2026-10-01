import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import vm from 'node:vm';

const loadShared = () => {
  const context = vm.createContext({ chrome: {}, Intl });
  vm.runInContext(readFileSync(new URL('../../src/shared.js', import.meta.url), 'utf8'), context);
  return context.FocusDiff;
};

const FocusDiff = loadShared();
const match = (filter, path) => FocusDiff.toMatcher({ include: '', exclude: '', ...filter })(path);

describe('toMatcher', () => {
  it('keeps paths that match include and not exclude', () => {
    const frontend = { include: '\\.(ts|tsx)$', exclude: '\\.(test|stories)\\.' };
    assert.equal(match(frontend, 'web/src/book-card.tsx'), true);
    assert.equal(match(frontend, 'web/src/book-card.test.tsx'), false);
    assert.equal(match(frontend, 'web/src/book-card.stories.tsx'), false);
    assert.equal(match(frontend, 'api/books/service.py'), false);
  });

  it('treats an empty include as everything', () => {
    assert.equal(match({ exclude: '\\.md$' }, 'src/index.ts'), true);
    assert.equal(match({ exclude: '\\.md$' }, 'README.md'), false);
  });

  it('ignores case', () => {
    assert.equal(match({ include: 'readme' }, 'README.md'), true);
  });

  it('returns null for invalid regexes', () => {
    assert.equal(FocusDiff.toMatcher({ include: '(', exclude: '' }), null);
    assert.equal(FocusDiff.compile('(').ok, false);
  });
});

describe('repoMatches', () => {
  it('matches exact names and owner wildcards, ignoring case', () => {
    assert.equal(FocusDiff.repoMatches('Octo/Web', 'octo/web'), true);
    assert.equal(FocusDiff.repoMatches('octo/*', 'octo/api'), true);
    assert.equal(FocusDiff.repoMatches('octo/*', 'other/api'), false);
    assert.equal(FocusDiff.repoMatches('octo/web', 'octo/website'), false);
  });
});

describe('filtersFor', () => {
  it('puts global filters first, then the matching repository filters', () => {
    const config = FocusDiff.normalize({
      global: [{ name: 'Docs', include: '\\.md$' }],
      repos: [
        { repo: 'octo/web', filters: [{ name: 'Web only' }] },
        { repo: 'octo/*', filters: [{ name: 'Org' }] },
        { repo: 'other/x', filters: [{ name: 'Elsewhere' }] },
      ],
    });
    assert.deepEqual([...FocusDiff.filtersFor(config, 'octo/web').map((filter) => filter.name)], ['Docs', 'Web only', 'Org']);
  });
});

describe('normalize', () => {
  it('drops malformed entries and fills defaults', () => {
    const config = FocusDiff.normalize({ global: [{ name: ' Docs ' }, null, { include: 'x' }], repos: [{ filters: [] }, 'x'] });
    assert.equal(config.global.length, 1);
    assert.equal(config.global[0].name, 'Docs');
    assert.equal(config.global[0].include, '');
    assert.equal(config.repos.length, 0);
  });

  it('gives every filter a unique id that is never "all"', () => {
    const config = FocusDiff.normalize({ global: [{ id: 'all', name: 'A' }, { id: 'x', name: 'B' }, { id: 'x', name: 'C' }] });
    const ids = config.global.map((filter) => filter.id);
    assert.equal(new Set(ids).size, 3);
    assert.ok(!ids.includes('all'));
    assert.equal(ids[1], 'x');
  });

  it('handles empty input', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(FocusDiff.normalize(undefined))), { global: [], repos: [] });
  });
});
