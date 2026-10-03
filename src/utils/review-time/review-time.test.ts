import { describe, expect, it } from 'vitest';
import { isGenerated, LINES_PER_HOUR, MINUTES_PER_FILE, reviewMinutes } from '@/utils/review-time/review-time';

describe('reviewMinutes', () => {
  it('reads added lines at the review pace, plus a moment to open the file', () => {
    expect(reviewMinutes('src/app.ts', { additions: LINES_PER_HOUR, deletions: 0 })).toBe(MINUTES_PER_FILE + 60);
  });

  it('counts removed lines at a quarter', () => {
    expect(reviewMinutes('src/app.ts', { additions: 0, deletions: 1000 })).toBe(MINUTES_PER_FILE + 12);
  });

  it('only opens generated and lock files', () => {
    expect(reviewMinutes('package-lock.json', { additions: 5000, deletions: 3000 })).toBe(MINUTES_PER_FILE);
    expect(reviewMinutes('web/dist/app.min.js', { additions: 1, deletions: 0 })).toBe(MINUTES_PER_FILE);
  });

  it('still counts files whose stats have not loaded', () => {
    expect(reviewMinutes('src/app.ts', null)).toBe(MINUTES_PER_FILE);
  });
});

describe('isGenerated', () => {
  it('spots lock files, bundles and snapshots, not regular code', () => {
    expect(['yarn.lock', 'go.sum', 'a/__snapshots__/x.snap', 'vendor/lib.js', 'app.min.css'].every(isGenerated)).toBe(true);
    expect(['src/lock.ts', 'docs/dist.md', 'src/vendors.ts'].some(isGenerated)).toBe(false);
  });
});
