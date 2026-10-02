// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { pullRequestData } from '@/utils/github-data';

const embed = (data: unknown) => {
  document.head.innerHTML = '';
  const script = document.createElement('script');
  script.type = 'application/json';
  script.dataset.target = 'react-app.embeddedData';
  script.textContent = JSON.stringify(data);
  document.head.append(script);
};

describe('pullRequestData', () => {
  beforeEach(() => history.replaceState(null, '', `/octo/web/pull/${Math.random().toString(36).slice(2)}/changes`));

  it('reads files, counts, viewed state and threads wherever GitHub nests them', () => {
    embed({
      payload: {
        route: {
          diffSummaries: [
            {
              path: 'a.ts',
              pathDigest: 'aa',
              linesAdded: 3,
              linesDeleted: 1,
              markedAsViewed: true,
              markersMap: { R40: { threads: [{ id: 2 }] }, R3: { threads: [{ id: 1 }] } },
            },
            { path: 'b.ts', pathDigest: 'bb', linesAdded: 0, linesDeleted: 9, markedAsViewed: false, markersMap: {} },
            { notAFile: true },
          ],
          markers: { threads: { 1: { isResolved: true }, 2: { isResolved: false } } },
        },
      },
    });
    const data = pullRequestData();
    expect(data?.files).toEqual([
      {
        path: 'a.ts',
        digest: 'aa',
        additions: 3,
        deletions: 1,
        viewed: true,
        threads: [
          { id: '1', line: 'R3', resolved: true },
          { id: '2', line: 'R40', resolved: false },
        ],
      },
      { path: 'b.ts', digest: 'bb', additions: 0, deletions: 9, viewed: false, threads: [] },
    ]);
  });

  it('is absent on the classic view or with unreadable data', () => {
    document.head.innerHTML = '';
    expect(pullRequestData()).toBeNull();
    embed({ unrelated: true });
    expect(pullRequestData()).toBeNull();
  });
});
