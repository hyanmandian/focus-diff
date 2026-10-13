import { samplePull } from '@/providers/github/sample-pull';
import { describe, expect, it } from 'vitest';
import type { PullRequest } from '@/providers/github/inbox';
import type { Config } from '@/utils/filters/filters';
import { createEstimator, LINES_PER_HOUR, reviewMinutes } from './review-time';
import {
  candidates,
  DEFAULT_REVIEW_TIME,
  estimate,
  newSession,
  nextOccurrence,
  normalizeReviewTime,
  plan,
  pullMinutes,
  sessionFilterIds,
  sessionMatchers,
  sessionsAt,
  startsOf,
  type Planned,
  type PullFile,
  type ReviewSession,
} from './sessions';

const pull = (number: number, extra: Partial<PullRequest> = {}) =>
  samplePull(number, { createdAt: `2026-10-0${number % 9}T12:00:00Z`, updatedAt: '2026-10-09T12:00:00Z', headSha: 'abc', ...extra });

const session = (extra: Partial<ReviewSession> = {}): ReviewSession => ({ ...newSession(), id: 's1', ...extra });
const settings = (extra: Partial<ReviewSession> = {}) => ({ ...DEFAULT_REVIEW_TIME, enabled: true, sessions: [session(extra)] });
/** Local time, like the alarms. */
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
const planned = (number: number, minutes: number, extra: Partial<PullRequest> = {}): Planned => ({
  pull: pull(number, extra),
  estimate: { minutes, files: 1 },
});

describe('normalizeReviewTime', () => {
  it('fills in what is missing and drops what is wrong', () => {
    const value = normalizeReviewTime({
      enabled: true,
      pace: 'sprint',
      sessions: [{ id: 'a', days: [1, 9, 1], times: ['15:00', '25:00', '09:30'], minutes: 999, order: 'random', every: 7 }],
    });
    expect(value.pace).toBe('steady');
    expect(value.sessions[0]).toMatchObject({ id: 'a', days: [1], times: ['09:30', '15:00'], minutes: 240, order: 'oldest', every: 2 });
    expect(value.sound).toEqual({ id: 'bowl', volume: 70 });
  });

  it('keeps two sessions apart even when another device gave them the same id', () => {
    const value = normalizeReviewTime({ sessions: [{ id: 'a' }, { id: 'a' }] });
    expect(new Set(value.sessions.map((each) => each.id)).size).toBe(2);
  });
});

describe('schedule', () => {
  it('starts at set times, or every few hours up to the end of a span', () => {
    expect(startsOf(session({ times: ['09:00', '15:30'] }))).toEqual([540, 930]);
    expect(startsOf(session({ repeat: 'every', every: 3, from: '09:00', to: '18:00' }))).toEqual([540, 720, 900, 1080]);
  });

  it('finds the next one, skipping the days it is off', () => {
    // 9 October 2026 is a Friday; the weekdays' 15:00 after Friday evening is Monday's.
    const weekdays = settings({ times: ['15:00'] });
    expect(nextOccurrence(weekdays, at(9, 10))?.at).toBe(at(9, 15));
    expect(nextOccurrence(weekdays, at(9, 15))?.at).toBe(at(12, 15));
    expect(nextOccurrence({ ...weekdays, enabled: false }, at(9, 10))).toBeNull();
    expect(nextOccurrence(settings({ on: false }), at(9, 10))).toBeNull();
  });

  it('knows which sessions are due at a minute', () => {
    const value = settings({ repeat: 'every', every: 1, from: '09:00', to: '12:00' });
    expect(sessionsAt(value, at(9, 11))).toHaveLength(1);
    expect(sessionsAt(value, at(9, 11, 30))).toHaveLength(0);
    expect(sessionsAt(value, at(10, 11))).toHaveLength(0);
  });
});

describe('estimate', () => {
  const files: PullFile[] = [
    ['src/app.ts', 1000, 0, false],
    ['src/app.test.ts', 500, 0, false],
    ['src/old.ts', 1000, 0, true],
  ];
  const config: Config = {
    global: [{ id: 'tests', name: 'Tests', include: '\\.test\\.', exclude: '' }],
    repos: [{ repo: 'octo/api', filters: [{ id: 'api', name: 'API', include: '^api/', exclude: '' }] }],
  };

  it('reads the files left to review at the reader’s pace, and a moment for the pull request', () => {
    const minutes = (path: string, additions: number) => reviewMinutes(path, { additions, deletions: 0 });
    expect(estimate(files, null, DEFAULT_REVIEW_TIME, reviewMinutes)).toEqual({
      minutes: DEFAULT_REVIEW_TIME.perPull + minutes('src/app.ts', 1000) + minutes('src/app.test.ts', 500),
      files: 2,
    });
    expect(estimate(files, null, { ...DEFAULT_REVIEW_TIME, unviewedOnly: false }, reviewMinutes).files).toBe(3);
  });

  it('counts only the files in the session’s filters, and nothing at all when none of them are', () => {
    const tests = sessionMatchers(config, 'octo/web', ['tests']);
    expect(estimate(files, tests, DEFAULT_REVIEW_TIME, reviewMinutes).files).toBe(1);
    expect(estimate([['README.md', 3, 0, false]], tests, DEFAULT_REVIEW_TIME, reviewMinutes)).toEqual({ minutes: 0, files: 0 });
  });

  it('reviews a repository whole when none of the filters are for it', () => {
    expect(sessionMatchers(config, 'octo/web', ['api'])).toBeNull();
    expect(sessionFilterIds(config, 'octo/api', ['api', 'tests'])).toEqual(['tests', 'api']);
  });

  it('follows the reader’s pace', () => {
    const slow = createEstimator(LINES_PER_HOUR / 2, null);
    expect(slow('src/app.ts', { additions: 1000, deletions: 0 })).toBeCloseTo(
      reviewMinutes('src/app.ts', { additions: 2000, deletions: 0 }),
    );
  });
});

describe('pullMinutes', () => {
  const files: PullFile[] = [['src/app.ts', 100, 0, false]];
  it('takes the whole pull request, from files read at its latest push', () => {
    const minutes = pullMinutes(pull(1), { sha: 'abc', files }, DEFAULT_REVIEW_TIME, reviewMinutes);
    expect(minutes).toBe(DEFAULT_REVIEW_TIME.perPull + reviewMinutes('src/app.ts', { additions: 100, deletions: 0 }));
    expect(pullMinutes(pull(1), { sha: 'old', files }, DEFAULT_REVIEW_TIME, reviewMinutes)).toBeNull();
    expect(pullMinutes(pull(1), undefined, DEFAULT_REVIEW_TIME, reviewMinutes)).toBeNull();
    expect(pullMinutes(pull(1), { sha: 'abc', files: [['a.ts', 1, 0, true]] }, DEFAULT_REVIEW_TIME, reviewMinutes)).toBeNull();
  });
});

describe('candidates', () => {
  it('leaves out drafts unless asked, and the repositories not wanted', () => {
    const pulls = [pull(1), pull(2, { draft: true }), pull(3, { repo: 'octo/legacy' }), pull(4, { repo: 'other/app' })];
    expect(candidates(session({ excludeRepos: ['octo/legacy'] }), pulls).map((each) => each.number)).toEqual([1, 4]);
    expect(candidates(session({ drafts: true, repos: ['octo/*'] }), pulls).map((each) => each.number)).toEqual([1, 2, 3]);
  });
});

describe('plan', () => {
  const items = [planned(1, 25), planned(2, 10), planned(3, 8), planned(4, 14)];

  it('takes the ones waiting longest that still fit', () => {
    const result = plan(items, 30, 'oldest');
    expect(result.picked.map((item) => item.pull.number)).toEqual([1]);
    expect(result.left).toHaveLength(3);
    expect(result.overBy).toBe(0);
  });

  it('takes the quickest first, as many as fit', () => {
    expect(plan(items, 30, 'quickest').picked.map((item) => item.pull.number)).toEqual([3, 2]);
  });

  it('fills the time best, where going in order would leave most of it unused', () => {
    expect(plan(items, 32, 'oldest').total).toBe(25);
    const result = plan(items, 32, 'fill');
    expect(result.picked.map((item) => item.pull.number)).toEqual([2, 3, 4]);
    expect(result.total).toBe(32);
  });

  it('picks one even when none fits, and says by how much it runs over', () => {
    const result = plan([planned(1, 50), planned(2, 45)], 30, 'oldest');
    expect(result.picked.map((item) => item.pull.number)).toEqual([1]);
    expect(result.overBy).toBe(20);
    expect(plan([planned(1, 50), planned(2, 45)], 30, 'quickest').picked.map((item) => item.pull.number)).toEqual([2]);
  });

  it('sets aside the ones with nothing to review, and gives the ones it couldn’t read a rough guess', () => {
    const empty = { pull: pull(5), estimate: { minutes: 0, files: 0 } };
    const unread = { pull: pull(6), estimate: { minutes: 12, files: 0, guessed: true } };
    const result = plan([empty, unread, planned(1, 5)], 30, 'oldest');
    expect(result.nothing.map((each) => each.number)).toEqual([5]);
    expect(result.picked.map((item) => item.pull.number)).toEqual([1, 6]);
  });

  it('puts the ones asked for again first, when they fit, in the session’s order after that', () => {
    const again = [planned(1, 25), planned(2, 10, { again: true }), planned(3, 8), planned(4, 14, { again: true })];
    expect(plan(again, 30, 'oldest', true).picked.map((item) => item.pull.number)).toEqual([2, 4]);
    expect(plan(again, 30, 'oldest').picked.map((item) => item.pull.number)).toEqual([1]);
    expect(plan(again, 32, 'fill', true).picked.map((item) => item.pull.number)).toEqual([2, 4, 3]);
    // One that doesn't fit gives way to the rest; with none fitting at all, it's the one picked.
    expect(plan([planned(1, 50, { again: true }), planned(2, 10)], 30, 'oldest', true).picked.map((item) => item.pull.number)).toEqual([2]);
    expect(plan([planned(1, 50), planned(2, 40, { again: true })], 30, 'oldest', true).picked.map((item) => item.pull.number)).toEqual([2]);
  });

  it('fills with the smallest when even that one doesn’t fit', () => {
    const result = plan([planned(1, 50), planned(2, 40)], 30, 'fill');
    expect(result.picked.map((item) => item.pull.number)).toEqual([2]);
    expect(result.overBy).toBe(10);
  });
});
