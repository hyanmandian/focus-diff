import { samplePull } from '@/providers/github/sample-pull';
import { describe, expect, it, vi } from 'vitest';
import { InboxError, type Activity, type Detail, type PullRequest } from '@/providers/github/inbox';
import { checkInbox, type InboxSource } from './check';
import {
  DEFAULT_NOTIFY,
  EVENT_KINDS,
  isQuiet,
  freshActivity,
  inPopup,
  isDone,
  markAgain,
  markDone,
  normalizeNotify,
  normalizePopup,
  pruneDone,
  reviewListEvents,
  splitRepos,
  unmarkDone,
  wants,
  type EventKind,
  type Exception,
  type InboxEvent,
  type InboxMemory,
  type NotifySettings,
} from './inbox';

const pull = samplePull;

const activity = (thread: string, extra: Partial<Activity> = {}): Activity => ({
  thread,
  repo: 'octo/web',
  number: 12,
  title: 'Pull request 12',
  url: 'https://github.com/octo/web/pull/12#issuecomment-1',
  reason: 'author',
  kind: 'comment',
  anchor: 'issuecomment-1',
  updatedAt: '2026-10-09T10:00:00Z',
  ...extra,
});

/** Notifications on for just these events, each with what it leaves out. */
const on = (events: Partial<Record<EventKind, Exception[]>>, repos: string[] = []): NotifySettings => ({
  ...DEFAULT_NOTIFY,
  enabled: true,
  repos,
  events: Object.fromEntries(
    EVENT_KINDS.map((kind) => [kind, { on: kind in events, except: events[kind] ?? [], repos: [] as string[] }]),
  ) as NotifySettings['events'],
});

const source = ({
  reviews = [] as PullRequest[],
  direct = [] as PullRequest[],
  activity: threads = [] as Activity[],
  detail = { actor: 'grace', bot: false, review: null, myReview: null, excerpt: '' } as Detail,
} = {}): InboxSource => ({
  pulls: vi.fn(async (list) => (list === 'reviews' ? reviews : list === 'direct' ? direct : [])),
  notifications: vi.fn(async () => ({ me: 'me-too', activity: threads })),
  detail: vi.fn(async () => detail),
});

const memory = (extra: Partial<InboxMemory> = {}): InboxMemory => ({ threads: {}, reviews: [], ...extra });

describe('normalizeNotify', () => {
  it('starts from what most reviewers want, and keeps only exceptions that mean something', () => {
    const settings = normalizeNotify({
      enabled: true,
      repos: [' octo/* ', 'octo/web', 'octo/web'],
      events: { approved: { on: true, except: ['bots', 'drafts', 'bots'], when: 'review' }, mention: { on: 'yes', when: 'later' } },
    });
    expect(settings.repos).toEqual(['octo/*', 'octo/web']);
    expect(settings.events.approved).toEqual({ on: true, except: ['bots'], repos: [], when: 'review' });
    expect(settings.events.mention).toEqual({ on: false, except: [], repos: [], when: 'now' });
    // Review requests wait for review time to start with; what happens on the reader's own pull requests doesn't.
    expect(settings.events['review-requested']).toEqual({ on: true, except: ['drafts'], repos: [], when: 'review' });
    expect(normalizeNotify(null)).toMatchObject({ enabled: false, repos: [] });
  });
});

describe('normalizeNotify, the rest', () => {
  it('keeps a known interval and well-formed quiet hours, or falls back', () => {
    const settings = normalizeNotify({ interval: 15, quiet: { on: true, from: '22:30', to: '7:00' }, delivery: { grouped: true } });
    expect(settings.interval).toBe(15);
    expect(settings.quiet).toEqual({ on: true, from: '22:30', to: '09:00', weekends: true });
    expect(settings.delivery).toEqual({ grouped: true, sticky: false, sound: { id: 'chime', volume: 60 } });
    // Quiet, from before there were sounds to pick, stays quiet.
    expect(normalizeNotify({ delivery: { silent: true } }).delivery.sound.id).toBe('none');
    expect(normalizeNotify({ interval: 3 }).interval).toBe(2);
  });
});

describe('isQuiet', () => {
  const at = (day: number, time: string) => new Date(2026, 9, 4 + day, Number(time.slice(0, 2)), Number(time.slice(3)));
  const quiet = (from: string, to: string, weekends = false) => ({ ...DEFAULT_NOTIFY, quiet: { on: true, from, to, weekends } });

  it('keeps quiet across midnight, within a day, and on weekends if asked', () => {
    expect(isQuiet(quiet('19:00', '09:00'), at(1, '23:00'))).toBe(true);
    expect(isQuiet(quiet('19:00', '09:00'), at(1, '08:59'))).toBe(true);
    expect(isQuiet(quiet('19:00', '09:00'), at(1, '09:00'))).toBe(false);
    expect(isQuiet(quiet('12:00', '14:00'), at(1, '13:00'))).toBe(true);
    expect(isQuiet(quiet('12:00', '14:00'), at(1, '15:00'))).toBe(false);
    // 4 October 2026 is a Sunday.
    expect(isQuiet(quiet('12:00', '14:00', true), at(0, '10:00'))).toBe(true);
    expect(isQuiet({ ...DEFAULT_NOTIFY }, at(1, '23:00'))).toBe(false);
  });
});

describe('splitRepos', () => {
  it('reads repositories apart by commas, spaces or lines', () => {
    expect(splitRepos(' octo/web, octo/*\nacme/api  octo/web ')).toEqual(['octo/web', 'octo/*', 'acme/api']);
    expect(splitRepos('  ')).toEqual([]);
  });
});

describe('wants', () => {
  const event: InboxEvent = {
    kind: 'comment-mine',
    repo: 'octo/web',
    number: 1,
    title: '',
    url: '',
    actor: 'bot',
    bot: true,
    draft: false,
    approvedByMe: false,
    team: false,
    again: false,
    excerpt: '',
  };

  it('takes the event in the chosen repositories, unless an exception applies', () => {
    expect(wants(on({ 'comment-mine': [] }), event)).toBe(true);
    expect(wants(on({ 'comment-mine': [] }, ['other/*', 'octo/*']), event)).toBe(true);
    expect(wants(on({ 'comment-mine': [] }, ['other/*']), event)).toBe(false);
    expect(wants(on({ 'comment-mine': ['bots'] }), event)).toBe(false);
    expect(wants(on({ approved: [] }), event)).toBe(false);
  });

  it('takes an event’s own repositories over the general ones, and never the excluded ones', () => {
    const settings = on({ 'comment-mine': [] }, ['other/*']);
    settings.events['comment-mine'].repos = ['octo/web'];
    expect(wants(settings, event)).toBe(true);
    expect(wants({ ...settings, excludeRepos: ['octo/*'] }, event)).toBe(false);
  });
});

describe('reviewListEvents', () => {
  it('finds new review requests and drafts that are now ready, but nothing on the first look', () => {
    expect(reviewListEvents(null, [pull(1)])).toEqual([]);
    const events = reviewListEvents([pull(1, { draft: true }), pull(2)], [pull(1), pull(2), pull(3)]);
    expect(events.map(({ kind, number }) => [kind, number])).toEqual([
      ['ready-for-review', 1],
      ['review-requested', 3],
    ]);
  });
});

describe('markAgain', () => {
  const urls = (list: PullRequest[]) => list.filter((each) => each.again).map((each) => each.number);

  it('marks a pull request back on the queue after leaving it, until it leaves again', () => {
    const day = 86_400_000;
    // Reviewed: off the queue.
    let step = markAgain([pull(1), pull(2)], [pull(2)], {}, 0);
    expect(step.history).toEqual({ [pull(1).url]: { left: 0 } });
    // Asked again: back, and it stays marked while it waits.
    step = markAgain([pull(2)], [pull(1), pull(2)], step.history, day);
    expect(urls(step.reviews)).toEqual([1]);
    step = markAgain(step.reviews, step.reviews, step.history, 2 * day);
    expect(urls(step.reviews)).toEqual([1]);
    // Reviewed again: off, and back once more, again.
    step = markAgain(step.reviews, [pull(2)], step.history, 3 * day);
    expect(step.history[pull(1).url]).toEqual({ left: 3 * day });
  });

  it('marks nothing new on a first look, and forgets one gone for months', () => {
    expect(urls(markAgain(null, [pull(1)], {}, 0).reviews)).toEqual([]);
    const history = { [pull(1).url]: { left: 0 } };
    expect(urls(markAgain([], [pull(1)], history, 100 * 86_400_000).reviews)).toEqual([]);
  });
});

describe('inPopup', () => {
  it('lists the repositories picked, and the reviews asked of a team unless left out', () => {
    const settings = normalizePopup({ repos: ['octo/*'] });
    expect(settings.teams).toBe(true);
    expect(inPopup(settings, pull(1, { team: true }))).toBe(true);
    expect(inPopup({ ...settings, teams: false }, pull(1, { team: true }))).toBe(false);
    expect(inPopup({ ...settings, teams: false }, pull(1))).toBe(true);
    expect(inPopup(settings, { repo: 'acme/api' })).toBe(false);
  });
});

describe('freshActivity', () => {
  it('finds threads updated since the last look', () => {
    const threads = [activity('a'), activity('b', { updatedAt: '2026-10-09T11:00:00Z' }), activity('c')];
    expect(freshActivity(null, threads)).toEqual([]);
    expect(freshActivity({ a: '2026-10-09T10:00:00Z', b: '2026-10-09T10:00:00Z' }, threads).map(({ thread }) => thread)).toEqual([
      'b',
      'c',
    ]);
  });
});

describe('done', () => {
  it('hides a pull request until something happens on it', () => {
    const done = markDone({}, [pull(1), pull(2)]);
    expect(isDone(done, pull(1))).toBe(true);
    expect(isDone(done, pull(1, { updatedAt: '2026-10-08T13:00:00Z' }))).toBe(false);
    expect(isDone(done, pull(3))).toBe(false);
    expect(isDone(unmarkDone(done, [pull(1)]), pull(1))).toBe(false);
  });

  it('forgets marks that no longer hide anything', () => {
    const done = markDone({}, [pull(1), pull(2), pull(3)]);
    expect(Object.keys(pruneDone(done, [pull(1), pull(2, { updatedAt: '2026-10-09T00:00:00Z' })]))).toEqual([
      'https://github.com/octo/web/pull/1',
    ]);
  });
});

describe('checkInbox', () => {
  it('only reads the lists while notifications are off', async () => {
    const github = source({ reviews: [pull(1)] });
    const result = await checkInbox(github, { ...on({ 'review-requested': [] }), enabled: false }, null);
    expect(result.snapshot).toMatchObject({ reviews: [pull(1)], mine: [], problem: null });
    expect(result.memory).toBeNull();
    expect(github.notifications).not.toHaveBeenCalled();
  });

  it('remembers where things stand on the first look, without telling', async () => {
    const result = await checkInbox(
      source({ reviews: [pull(1)], activity: [activity('a')] }),
      on({ 'review-requested': [], 'comment-mine': [] }),
      null,
    );
    expect(result.events).toEqual([]);
    expect(result.memory).toEqual({ threads: { a: '2026-10-09T10:00:00Z' }, reviews: [pull(1)] });
  });

  it('tells about a ready draft, unless the reader approved it already', async () => {
    const before = memory({ reviews: [pull(1, { draft: true })] });
    const ready = await checkInbox(source({ reviews: [pull(1)] }), on({ 'ready-for-review': ['approved'] }), before);
    expect(ready.events).toMatchObject([{ kind: 'ready-for-review', number: 1, approvedByMe: false }]);

    const approved = source({ reviews: [pull(1)], detail: { actor: '', bot: false, review: null, myReview: 'approved', excerpt: '' } });
    expect((await checkInbox(approved, on({ 'ready-for-review': ['approved'] }), before)).events).toEqual([]);
  });

  it('tells who commented or reviewed, with the link, and leaves out bots and the reader', async () => {
    const before = memory({ threads: { a: '2026-10-08T00:00:00Z' } });
    const comment = await checkInbox(source({ activity: [activity('a')] }), on({ 'comment-mine': ['bots'] }), before);
    expect(comment.events).toMatchObject([
      { kind: 'comment-mine', actor: 'grace', url: 'https://github.com/octo/web/pull/12#issuecomment-1' },
    ]);

    const bot = source({ activity: [activity('a')], detail: { actor: 'ci', bot: true, review: null, myReview: null, excerpt: '' } });
    expect((await checkInbox(bot, on({ 'comment-mine': ['bots'] }), before)).events).toEqual([]);

    const self = source({ activity: [activity('a')], detail: { actor: 'Me-Too', bot: false, review: null, myReview: null, excerpt: '' } });
    expect((await checkInbox(self, on({ 'comment-mine': [] }), before)).events).toEqual([]);

    const review = activity('a', { kind: 'review', anchor: 'pullrequestreview-2' });
    const approval = source({
      activity: [review],
      detail: { actor: 'grace', bot: false, review: 'approved', myReview: null, excerpt: '' },
    });
    expect((await checkInbox(approval, on({ approved: [] }), before)).events).toMatchObject([{ kind: 'approved', actor: 'grace' }]);
  });

  it('says what a comment said', async () => {
    const before = memory({ threads: { a: '2026-10-08T00:00:00Z' } });
    const said = source({
      activity: [activity('a')],
      detail: { actor: 'grace', bot: false, review: null, myReview: null, excerpt: 'Could this cache expire?' },
    });
    expect((await checkInbox(said, on({ 'comment-mine': [] }), before)).events).toMatchObject([{ excerpt: 'Could this cache expire?' }]);
  });

  it('tells the reviews asked of a team from the ones asked of the reader, and leaves the team’s out with the queue', async () => {
    const before = memory({ reviews: [], threads: { a: '2026-10-08T00:00:00Z', b: '2026-10-08T00:00:00Z' } });
    const threads = [
      activity('a', { reason: 'review_requested', number: 1, anchor: 'issuecomment-1' }),
      activity('b', { reason: 'author', number: 3, anchor: 'issuecomment-3' }),
    ];
    const github = source({ reviews: [pull(1), pull(2)], direct: [pull(2)], activity: threads });
    const settings = on({ 'review-requested': [], 'comment-reviewing': [], 'comment-mine': [] });
    const told = await checkInbox(github, settings, before);
    expect(told.events.map(({ kind, number, team }) => [kind, number, team])).toEqual([
      ['review-requested', 1, true],
      ['review-requested', 2, false],
      ['comment-reviewing', 1, true],
      ['comment-mine', 3, false],
    ]);
    // Left out of the queue, a team's review isn't told about, nor what's said on it; the reader's own pull requests are.
    const skipped = await checkInbox(github, settings, before, { skipTeams: true });
    expect(skipped.events.map(({ kind, number }) => [kind, number])).toEqual([
      ['review-requested', 2],
      ['comment-mine', 3],
    ]);
  });

  it('reads the list of reviews asked of the reader only when it tells something', async () => {
    const quiet = source({ reviews: [pull(1)] });
    await checkInbox(quiet, on({ 'review-requested': [] }), memory({ reviews: [pull(1)] }));
    expect(quiet.pulls).not.toHaveBeenCalledWith('direct');

    const queue = source({ reviews: [pull(1), pull(2)], direct: [pull(1)] });
    const result = await checkInbox(queue, { ...DEFAULT_NOTIFY }, null, { skipTeams: true });
    expect(result.snapshot.reviews.map(({ team }) => team)).toEqual([false, true]);

    // Unread, none is known to be a team's.
    queue.pulls = vi.fn(async (list) => {
      if (list === 'direct') throw new InboxError('unreadable');
      return list === 'reviews' ? [pull(1)] : [];
    });
    const failed = await checkInbox(queue, { ...DEFAULT_NOTIFY }, null, { skipTeams: true });
    expect(failed.snapshot).toMatchObject({ reviews: [pull(1)], problem: null });
  });

  it('reads no pull request page for events the reader didn’t ask about', async () => {
    const github = source({ activity: [activity('a', { repo: 'other/app' })] });
    await checkInbox(github, on({ 'comment-mine': [] }, ['octo/*']), memory());
    expect(github.detail).not.toHaveBeenCalled();
  });

  it('reads at most eight pull request pages a look, three at a time', async () => {
    const before = memory({ threads: Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`t${index}`, '2026-10-08T00:00:00Z'])) });
    const threads = Array.from({ length: 12 }, (_, index) => activity(`t${index}`, { anchor: `issuecomment-${index}` }));
    const github = source({ activity: threads });
    let open = 0;
    let most = 0;
    github.detail = vi.fn(async () => {
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 5));
      open -= 1;
      return { actor: 'grace', bot: false, review: null, myReview: null, excerpt: '' };
    });
    const result = await checkInbox(github, on({ 'comment-mine': [] }), before);
    expect(github.detail).toHaveBeenCalledTimes(8);
    expect(most).toBe(3);
    expect(result.events.map((event) => event.url)).toHaveLength(8);
  });

  it('says what went wrong', async () => {
    const github = source();
    github.pulls = vi.fn(async () => {
      throw new InboxError('signed-out');
    });
    expect((await checkInbox(github, on({}), null)).snapshot.problem).toBe('signed-out');
  });
});
