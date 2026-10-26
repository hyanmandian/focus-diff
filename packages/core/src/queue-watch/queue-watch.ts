/**
 * The queues' live state: refreshes them, remembers what's been seen and taken off, works out what's new and
 * notifies about it (or keeps it for review time), and hands the panel a snapshot. A port of the desktop app's
 * `src-tauri/src/watch.rs`, with what's platform-specific passed in: GitHub, who's signed in, the clock, storage,
 * notifications, the words, and where snapshots and the unread count go.
 *
 * Like watch.rs's worker thread, the refreshing side (boot, sign-in, setup changes, refreshes, the clock) runs one
 * thing at a time; clicks (seen, dismiss, restore) take effect at once. Its owner calls {@link QueueWatch.refresh} on
 * its own rhythm ({@link QueueWatch.pollMs}) and {@link QueueWatch.reviewTick} every so often (watch.rs: 15 seconds).
 *
 * Review time runs here as in watch.rs (its schedule, plan and words are review-time.ts, review.rs's port): a time
 * that's due starts with what fits, the one under way ends when its time is up, and what waited for either shows
 * then. Not here (the app's shell): the tray icon, the panel window, the notifications and sounds themselves.
 */

import type { Actor } from "../github-pulls/github-pulls";
import {
  attempt,
  fields,
  flag,
  integer,
  list as listOf,
  maybe,
  Mismatch,
  text,
  texts,
} from "../json-decode/json-decode";
import {
  enabledQueues,
  isScheduled,
  waitsForReview,
  type Config,
  type QueueKind,
  type Session,
} from "../queue-config/queue-config";
import {
  isRateLimited,
  readCache,
  sync,
  toFailure,
  emptyCache,
  type Cache,
  type Gql,
} from "../queue-engine/queue-engine";
import { freshEvents, itemsFor, type CiMemo, type Fresh } from "../queue-items/queue-items";
import { panelItem, type EngineItem, type ReviewRun, type Snapshot, type Status } from "../queue-panel/queue-panel";
import type { Words } from "../queue-words/queue-words";
import {
  candidate,
  due,
  endsAt,
  endWords,
  ENGLISH_REVIEW,
  localOffset,
  minutesLeft,
  offerWords,
  paceFactor,
  plan,
  type ReviewWords,
} from "../review-time/review-time";

/** Every pull request in full again this often, changed or not: a safety net for what GitHub doesn't count as an update. */
export const FULL_EVERY = 20 * 60_000;
export const MAX_NOTIFICATIONS = 4;
/** Notifications kept for later, the latest of them. */
export const MAX_HELD = 50;
/**
 * Bumped when there are new kinds of event: the first refresh after notifies about none of them, or every comment and
 * draft made ready in the queues would be news at once.
 */
export const EVENTS_VERSION = 1;
/** How many pull requests taken off by hand Undo can still put back. */
export const MOST_UNDONE = 50;
export const FIRST_BACKOFF = 5 * 60_000;
export const LONGEST_BACKOFF = 30 * 60_000;

/** What a notification kept for later waits for: the next review time, or the end of the one under way. */
export type Until = "review" | "end";

/** A notification kept for later, as it would have shown. */
export interface Held {
  key: string;
  title: string;
  body: string;
  until: Until;
}

/** What's remembered between launches (state.json on the desktop). */
export interface Persisted {
  /** Event keys of cards clicked. */
  seen: Record<string, true>;
  /** Every event key last time, to tell what's new. Null before the first refresh. */
  keys: string[] | null;
  ci: Record<string, CiMemo>;
  /** "queueId:prId" taken off a queue by hand: merged ones marked as seen, others ignored. */
  dismissed: Record<string, true>;
  /**
   * Each queue's search last time: a queue that's new or searches differently starts quietly, its first results the
   * baseline rather than a burst of notifications.
   */
  searches: Record<string, string>;
  /** The kinds of event `keys` knows about ({@link EVENTS_VERSION}). */
  eventsVersion: number;
  /** Notifications waiting for review time, or for the end of the one under way. */
  held: Held[];
  /** The review time under way. */
  run: ReviewRun["run"] | null;
  /** When review time's schedule was last looked at (ms): one that started since is due. */
  reviewCheckedAt: number;
  /**
   * When GitHub last answered a refresh (ms), so a watch started again soon after (a browser's background, stopped
   * when idle) can tell its queues are still fresh. Not in watch.rs, whose process lives on.
   */
  refreshedAt: number;
}

export const emptyPersisted = (): Persisted => ({
  seen: {},
  keys: null,
  ci: {},
  dismissed: {},
  searches: {},
  eventsVersion: 0,
  held: [],
  run: null,
  reviewCheckedAt: 0,
  refreshedAt: 0,
});

const trues = (value: unknown): Record<string, true> => {
  const out: Record<string, true> = {};
  if (value === undefined) return out;
  // Any key counts, as in watch.rs: only `true` is ever written.
  for (const [key, on] of Object.entries(fields(value))) {
    if (typeof on !== "boolean") throw new Mismatch("a flag");
    out[key] = true;
  }
  return out;
};

const readRun = (value: unknown): ReviewRun["run"] => {
  const o = fields(value);
  return {
    session: text(o, "session"),
    name: text(o, "name"),
    minutes: integer(o, "minutes", { min: 0 }),
    startedAt: integer(o, "startedAt"),
    pulls: listOf(o, "pulls", (p) => {
      const pull = fields(p);
      return {
        id: text(pull, "id"),
        title: text(pull, "title"),
        repo: text(pull, "repo"),
        number: integer(pull, "number", { min: 0 }),
        url: text(pull, "url"),
        minutes: integer(pull, "minutes", { min: 0 }),
        again: flag(pull, "again"),
      };
    }),
    left: integer(o, "left", { min: 0 }),
    overBy: integer(o, "overBy", { min: 0 }),
  };
};

/** What was remembered, read back from storage: the defaults when it's missing or doesn't read. */
export const readPersisted = (value: unknown): Persisted =>
  attempt(() => {
    const o = fields(value);
    const ci: Record<string, CiMemo> = {};
    for (const [id, memo] of Object.entries(o.ci === undefined ? {} : fields(o.ci))) {
      const m = fields(memo);
      ci[id] = { oid: text(m, "oid"), state: maybe(m, "state", (s) => text({ s }, "s")) };
    }
    const searches: Record<string, string> = {};
    for (const [id, search] of Object.entries(o.searches === undefined ? {} : fields(o.searches))) {
      searches[id] = text({ search }, "search");
    }
    return {
      seen: trues(o.seen),
      keys: maybe(o, "keys", () => texts(o, "keys")),
      ci,
      dismissed: trues(o.dismissed),
      searches,
      eventsVersion: integer(o, "eventsVersion", { min: 0 }),
      held: listOf(o, "held", (h) => {
        const held = fields(h);
        const until = text(held, "until");
        if (until !== "review" && until !== "end") throw new Mismatch("review or end");
        return { key: text(held, "key"), title: text(held, "title"), body: text(held, "body"), until };
      }),
      run: maybe(o, "run", readRun),
      reviewCheckedAt: integer(o, "reviewCheckedAt"),
      refreshedAt: integer(o, "refreshedAt"),
    };
  }) ?? emptyPersisted();

/** A queue's search without the date a merged queue moves along each day. */
export const searchKey = (search: string): string =>
  search
    .split(" ")
    .filter((part) => !part.startsWith("merged:>="))
    .join(" ");

// MARK: Words

/** The first of someone's names, their login without one, or "Someone". */
const firstName = (actor: Actor | null, words: Words): string => {
  const first = actor?.name?.trim().split(/\s+/u)[0];
  if (first) return first;
  return actor?.login || words.someone;
};

/**
 * What a notification says: what happened, by whom (and for a review request, whether it's asked of you or your team,
 * or again), then what a comment or review said, if anything, over the pull request it's on.
 */
export const notificationWords = (
  fresh: Fresh,
  kind: QueueKind | null,
  words: Words,
): { title: string; body: string } => {
  const { pr } = fresh.item;
  const who = firstName(fresh.event.who, words);
  const teams = fresh.item.viaTeams ?? [];
  const reviewing = kind === "review";
  const titles: Record<string, () => string> = {
    new: () => (reviewing ? (teams.length > 0 ? words.askedTeam(who) : words.asked(who)) : words.newInQueue),
    rerequest: () => words.askedAgain(who),
    ready: () => (reviewing ? words.readyForYou(who) : words.markedReady(who)),
    commits: () => words.pushed(who),
    reply: () => words.replied(who),
    mention: () => words.mentioned(who),
    comment: () =>
      kind === "authored"
        ? words.commentedOnYours(who)
        : reviewing
          ? words.commentedOnReviewing(who)
          : words.commented(who),
    approved: () => words.approved(who),
    changes: () => words.changes(who),
    "ci-failed": () => words.ciFailed,
    "ci-passed": () => words.ciPassed,
    conflict: () => words.conflict,
  };
  const title = Object.hasOwn(titles, fresh.event.kind) ? titles[fresh.event.kind]!() : words.somethingHappened;
  let place = `${pr.repository.nameWithOwner}#${pr.number}`;
  const team = teams[0];
  if (team !== undefined) {
    const slash = team.indexOf("/");
    place += words.forTeam(slash === -1 ? team : team.slice(slash + 1));
  }
  if (fresh.event.text !== null) return { title, body: `“${fresh.event.text}”\n${place} · ${pr.title}` };
  if (fresh.event.kind === "new" && !reviewing) {
    return { title, body: words.byAuthor(pr.title, place, firstName(pr.author, words)) };
  }
  return { title, body: `${pr.title}\n${place}` };
};

/** Why notifications were kept, for the one that sums them up. */
export type Why = "cameIn" | "waitedForReview" | "cameInWhileReviewing";

/** Several notifications as one: how many, and a line each for the first few. */
export const summary = (notes: readonly Held[], why: Why, words: Words): { title: string; body: string } => {
  const lines = notes.slice(0, 5).map((n) => `${n.title}: ${n.body.split("\n", 1)[0]!.replace(/\r$/u, "")}`);
  const more = notes.length > 5 ? words.andMore(notes.length - 5) : "";
  const n = notes.length;
  const titles: Record<Why, string> = {
    cameIn: words.cameIn(n),
    waitedForReview: words.waitedForReview(n),
    cameInWhileReviewing: words.cameInWhileReviewing(n),
  };
  return { title: titles[why], body: `${lines.join("\n")}${more}` };
};

// MARK: The watch

/** A notification to show now. Only the first of a batch makes a sound. */
export interface Note {
  title: string;
  body: string;
  sound: boolean;
}

export interface WatchStorage {
  loadState: () => Promise<unknown>;
  saveState: (state: Persisted) => Promise<void> | void;
  loadCache: () => Promise<unknown>;
  saveCache: (cache: Cache) => Promise<void> | void;
}

export interface WatchOptions {
  gql: Gql;
  /** Who's signed in: null when no one is; rejects when GitHub can't be reached to tell. */
  login: () => Promise<string | null>;
  /** The person's setup, null without one (read again on {@link QueueWatch.configChanged}). */
  config: () => Promise<Config | null>;
  now: () => number;
  storage: WatchStorage;
  notify: (note: Note) => void;
  words: Words;
  /** The panel's new state, after every change. */
  publish?: (snapshot: Snapshot) => void;
  /** How many pull requests have something unread, when it changes; `animate` when notifications showed. */
  badge?: (count: number, animate: boolean) => void;
  /** The reader's pace (pace.json's contents), for what fits in a review time; nothing learned without it. */
  pace?: () => Promise<unknown>;
  /** Review time's own notification (its start, its end), with its own sound where the app has one; `notify` without it. */
  chime?: (note: Note) => void;
  /** Review time's minutes left, as they change, or null when none is under way (the desktop's tray countdown). */
  countdown?: (minutes: number | null) => void;
  /** What review time says, English without it. */
  reviewWords?: ReviewWords;
}

export class QueueWatch {
  private readonly options: WatchOptions;
  private ready = false;
  private config: Config | null = null;
  private me: string | null = null;
  private cache: Cache = emptyCache();
  private persisted: Persisted = emptyPersisted();
  private items: Array<[string, EngineItem[]]> = [];
  private status: Status = { phase: "idle", updatedAt: 0 };
  /** Pull request ids with something new to call out, until the panel shows them. */
  private readonly arrivals = new Set<string>();
  private lastCount: number | null = null;
  /** GitHub couldn't be reached to tell who's signed in: asked again before the next refresh. */
  private authUnknown = false;
  /** GitHub asked to slow down: no refresh before this (ms), and how long the last wait was. */
  private retryAt = 0;
  private backoff = 0;
  /** Pull requests just taken off by hand, with the event keys that counted as seen then, for Undo. */
  private dismissedNow: Array<{ queueId: string; item: EngineItem; fresh: string[] }> = [];
  /** The refreshing side's work, one thing at a time. */
  private work: Promise<void> = Promise.resolve();
  /** A refresh asked for while others wait: they all make this one. */
  private pending: { force: boolean; done: Promise<void> } | null = null;
  /** The minutes left last told to `countdown`. */
  private shownCountdown: number | null = null;

  public constructor(options: WatchOptions) {
    this.options = options;
  }

  // MARK: What the panel reads

  public snapshot(): Snapshot {
    const items: Snapshot["items"] = {};
    for (const [id, list] of this.items) items[id] = list.map((item) => panelItem(item));
    const { run } = this.persisted;
    return {
      ready: this.ready,
      signedIn: this.me !== null,
      me: this.me,
      items,
      status: { ...this.status },
      arrivals: [...this.arrivals],
      seen: { ...this.persisted.seen },
      dismissed: { ...this.persisted.dismissed },
      review: run ? { run, endsAt: run.startedAt + run.minutes * 60_000 } : null,
    };
  }

  /** How often to refresh (ms): the setup's rhythm, a minute without one. */
  public pollMs(): number {
    return (this.config?.pollSeconds ?? 60) * 1000;
  }

  // MARK: The refreshing side

  /**
   * Last time's state and pull requests first, so the panel has something to show at once; then who's signed in, then
   * GitHub, then review time's clock. Unless `force` is false, GitHub is asked whatever the rhythm says; with it false,
   * only if the last refresh is older than the rhythm (a watch started again soon after it stopped).
   */
  public boot({ force = true }: { force?: boolean } = {}): Promise<void> {
    return this.queue(async () => {
      this.persisted = readPersisted(await this.options.storage.loadState());
      this.status = { phase: "idle", updatedAt: this.persisted.refreshedAt };
      this.config = await this.options.config();
      const cache = readCache(await this.options.storage.loadCache());
      if (cache) {
        if (cache.me) this.me = cache.me;
        this.cache = cache;
        await this.apply();
      }
      this.ready = true;
      this.publish();
      await this.checkAuth();
      await this.runRefresh(force);
      await this.reviewClock();
    });
  }

  /** Signed in or out: who it is now, then everything again. */
  public authChanged(): Promise<void> {
    return this.queue(async () => {
      await this.checkAuth();
      await this.runRefresh(true);
    });
  }

  /** The setup changed: its rules on what's known already, before GitHub answers, then everything again. */
  public configChanged(): Promise<void> {
    return this.queue(async () => {
      this.config = await this.options.config();
      await this.apply();
      this.publish();
      await this.runRefresh(true);
    });
  }

  /**
   * Asks GitHub what changed: not before the rhythm says, unless `force`. Several asked for while one runs make one,
   * forced if any was.
   */
  public refresh(force = false): Promise<void> {
    if (this.pending) {
      this.pending.force ||= force;
      return this.pending.done;
    }
    const pending = { force, done: Promise.resolve() };
    pending.done = this.queue(() => {
      this.pending = null;
      return this.runRefresh(pending.force);
    });
    this.pending = pending;
    return pending.done;
  }

  /**
   * Review time's clock: the one under way ends when its time is up, one that's due starts, and the countdown follows.
   * What was kept for review times that won't come any more shows now.
   */
  public reviewTick(): Promise<void> {
    return this.queue(() => this.reviewClock());
  }

  /** The clock (as {@link QueueWatch.reviewTick}). */
  public tick(): Promise<void> {
    return this.reviewTick();
  }

  /** Ends the review time under way by hand: what waited for the end of it shows now. */
  public endReview(): Promise<void> {
    return this.queue(async () => {
      await this.endRun(false);
      this.updateCountdown(this.options.now());
      this.publish();
    });
  }

  private queue(job: () => Promise<void>): Promise<void> {
    const done = this.work.then(job);
    this.work = done.catch(() => {
      // A job that failed doesn't stop the ones after it; its caller hears about it.
    });
    return done;
  }

  private async checkAuth(): Promise<void> {
    try {
      const login = await this.options.login();
      this.authUnknown = false;
      if (this.me !== login) {
        this.me = login;
        this.items = [];
        this.arrivals.clear();
        this.status = { phase: "idle", updatedAt: 0 };
        this.updateBadge(false);
      }
    } catch (error) {
      // Offline: keep last time's account and try again on the next refresh.
      this.authUnknown = true;
      this.status = { phase: "error", error: toFailure(error).message, updatedAt: this.status.updatedAt };
    }
    this.publish();
  }

  private async runRefresh(force: boolean): Promise<void> {
    if (this.authUnknown) await this.checkAuth();
    const { config, me } = this;
    if (!config || me === null) return;
    const now = this.options.now();
    if (this.authUnknown || now < this.retryAt) return;
    const recent = now - this.status.updatedAt < config.pollSeconds * 1000 - 5000;
    if (!force && recent && this.status.phase !== "error") return;
    this.status = { ...this.status, phase: "loading" };
    const full = now - this.cache.fullAt > FULL_EVERY;
    const { cache } = this;
    this.cache = emptyCache();
    this.publish();

    let failure = null;
    try {
      await sync(this.options.gql, enabledQueues(config), me, cache, force, full, this.options.now());
    } catch (error) {
      failure = toFailure(error);
    }
    this.cache = cache;
    if (failure) {
      // What came in before GitHub refused is kept (the cache was updated as it went).
      await this.options.storage.saveCache(this.cache);
      let message = failure.message;
      if (failure.status === 401) {
        message = this.options.words.signedOut;
      } else if (isRateLimited(failure)) {
        // Waiting longer each time it asks again, up to half an hour.
        this.backoff = Math.min(Math.max(this.backoff * 2, FIRST_BACKOFF), LONGEST_BACKOFF);
        this.retryAt = this.options.now() + this.backoff;
        message = this.options.words.slowDown(this.backoff / 60_000);
      }
      this.status = { phase: "error", error: message, updatedAt: this.status.updatedAt };
      if (failure.status === 401) {
        await this.checkAuth();
        return;
      }
    } else {
      this.backoff = 0;
      if (full) this.cache.fullAt = this.options.now();
      this.status = { phase: "idle", updatedAt: this.options.now() };
      this.persisted.refreshedAt = this.status.updatedAt;
      await this.apply();
      await this.options.storage.saveCache(this.cache);
    }
    this.publish();
  }

  /** The items of every queue from the cache, and what's new since last time. */
  private async apply(): Promise<void> {
    const { config, me, persisted, cache } = this;
    if (!config || me === null) return;
    const queues = enabledQueues(config);
    const items: Array<[string, EngineItem[]]> = [];
    const problems: string[] = [];
    for (const queue of queues) {
      const found = cache.lists[queue.id];
      if (!found) {
        items.push([queue.id, []]);
        continue;
      }
      const prs = found.ids.flatMap((id) => {
        const cached = cache.prs[id];
        return cached ? [cached.pr] : [];
      });
      const result = itemsFor(queue, prs, me, persisted.ci);
      if (result.ok) {
        items.push([
          queue.id,
          result.items.filter((i) => !Object.hasOwn(persisted.dismissed, `${queue.id}:${i.pr.id}`)),
        ]);
      } else {
        problems.push(this.options.words.unsupportedPattern(result.problem.queue, result.problem.pattern));
        items.push([queue.id, []]);
      }
    }
    const all = items.flatMap(([, list]) => list);
    const keys = new Set(all.flatMap((i) => i.events.map((e) => e.key)));
    const searches: Record<string, string> = {};
    for (const queue of queues) {
      const found = cache.lists[queue.id];
      if (found) searches[queue.id] = searchKey(found.search);
    }
    const settled = (id: string): boolean => Object.hasOwn(searches, id) && persisted.searches[id] === searches[id];
    let animate = false;
    if (persisted.keys && persisted.eventsVersion === EVENTS_VERSION) {
      const previous = new Set(persisted.keys);
      const audible = all.filter((i) => settled(i.queueId));
      const fresh = freshEvents(audible, queues, previous, persisted.seen, this.options.now());
      for (const f of fresh) this.arrivals.add(f.item.pr.id);
      // Only what shows now draws the eye: what's kept waits quietly.
      animate = this.notify(config, fresh) > 0;
    }
    // Only once GitHub answered for them: before that a queue has no results to start from.
    if (Object.keys(searches).length > 0) {
      persisted.searches = searches;
      persisted.eventsVersion = EVENTS_VERSION;
    }
    // The first refresh notifies about nothing: it's all old news. Cards still show as unclicked.
    persisted.keys = [...keys];
    // Forget what's gone, so the state stays small.
    for (const key of Object.keys(persisted.seen)) if (!keys.has(key)) delete persisted.seen[key];
    // A pull request taken off a queue by hand stays off while it still turns up in its search.
    for (const key of Object.keys(persisted.dismissed)) {
      const colon = key.indexOf(":");
      const queueId = colon === -1 ? key : key.slice(0, colon);
      const prId = colon === -1 ? "" : key.slice(colon + 1);
      const found = cache.lists[queueId];
      if (found && !found.ids.includes(prId)) delete persisted.dismissed[key];
    }
    persisted.ci = {};
    for (const i of all) persisted.ci[i.pr.id] = { oid: i.pr.headRefOid, state: i.ci };
    const [problem] = problems;
    if (problem !== undefined) this.status = { phase: "error", error: problem, updatedAt: this.status.updatedAt };
    this.items = items;
    await this.saveState();
    this.updateBadge(animate);
  }

  /**
   * Shows what's new, or keeps it: for the next review time when its queue says so (and there is one coming), or for
   * the end of the one under way when everything waits while reviewing. Returns how many showed now.
   */
  private notify(config: Config, fresh: readonly Fresh[]): number {
    const { persisted } = this;
    const reviewing = persisted.run !== null;
    const scheduled = isScheduled(config.reviewTime);
    const now: Held[] = [];
    for (const f of fresh) {
      // What's fresh is from the setup's queues.
      const queue = config.queues.find((q) => q.id === f.item.queueId)!;
      const { title, body } = notificationWords(f, queue.kind, this.options.words);
      const until: Until | null =
        reviewing && config.reviewTime.holdWhileReviewing
          ? "end"
          : scheduled && waitsForReview(queue)
            ? "review"
            : null;
      const note: Held = { key: f.event.key, title, body, until: until ?? "review" };
      if (until) {
        persisted.held = persisted.held.filter((h) => h.key !== note.key);
        persisted.held.push(note);
      } else {
        now.push(note);
      }
    }
    persisted.held = persisted.held.slice(Math.max(0, persisted.held.length - MAX_HELD));
    this.show(now, config.sound);
    return now.length;
  }

  /** Notifications, a few at most, with one sound for the batch, not one per notification. */
  private show(notes: readonly Held[], sound: boolean): void {
    let ring = sound;
    for (const note of notes.slice(0, MAX_NOTIFICATIONS)) {
      this.options.notify({ title: note.title, body: note.body, sound: ring });
      ring = false;
    }
    if (notes.length > MAX_NOTIFICATIONS) {
      const { words } = this.options;
      this.options.notify({
        title: words.moreUpdates(notes.length - MAX_NOTIFICATIONS),
        body: words.openToSee,
        sound: ring,
      });
    }
  }

  /** Notifications that were kept: as they were if just one, summed up in one otherwise. */
  private release(notes: readonly Held[], why: Why, sound: boolean): void {
    if (notes.length === 1) this.show(notes, sound);
    if (notes.length > 1) this.options.notify({ ...summary(notes, why, this.options.words), sound });
  }

  /** Takes the notifications kept for this, in the order they came. */
  private takeHeld(until: Until): Held[] {
    const taken = this.persisted.held.filter((h) => h.until === until);
    this.persisted.held = this.persisted.held.filter((h) => h.until !== until);
    return taken;
  }

  // MARK: Review time

  private get reviewWords(): ReviewWords {
    return this.options.reviewWords ?? ENGLISH_REVIEW;
  }

  /** watch.rs's review_tick. */
  private async reviewClock(): Promise<void> {
    const now = this.options.now();
    const { run } = this.persisted;
    const over = run !== null && now >= endsAt(run);
    if (over) {
      // How far it got, from the queues as they are now.
      await this.runRefresh(true);
      await this.endRun(true);
    }
    const { config, persisted } = this;
    if (!config) return;
    if (!isScheduled(config.reviewTime) && persisted.run === null && persisted.held.some((h) => h.until === "review")) {
      this.release(this.takeHeld("review"), "cameIn", config.sound);
    }
    const last = persisted.reviewCheckedAt;
    persisted.reviewCheckedAt = now;
    // The first look starts the clock: nothing from before counts.
    const session = last > 0 ? (due(config.reviewTime, last, now, localOffset)?.session ?? null) : null;
    const starting = session !== null && persisted.run === null && this.me !== null;
    if (starting) {
      // What's waiting as it stands now, not as of the last refresh.
      await this.runRefresh(true);
      await this.startRun(session, now);
    }
    // Saved each time (watch.rs saves it with the next change): a background that stops when idle reads it back.
    await this.saveState();
    this.updateCountdown(now);
    if (over || starting) this.publish();
  }

  /** The items of the queues a session picks from: the ones it names, or every review queue. */
  private sessionItems(session: Session | undefined): EngineItem[] {
    // Only while a review time starts or ends, with the setup known.
    const { queues } = this.config!;
    const picks = (id: string) =>
      session && session.queues.length > 0
        ? session.queues.includes(id)
        : queues.some((q) => q.id === id && q.kind === "review");
    return this.items.filter(([id]) => picks(id)).flatMap(([, list]) => list);
  }

  /** Review time's own notification. */
  private chime(config: Config, title: string, body: string): void {
    (this.options.chime ?? this.options.notify)({ title, body, sound: config.sound });
  }

  /** Starts a review time: picks what fits and says so, with what waited for it. */
  private async startRun(session: Session, now: number): Promise<void> {
    const config = this.config!;
    const pace = paceFactor(this.options.pace ? await this.options.pace() : null);
    const ids = new Set<string>();
    const candidates = this.sessionItems(session)
      .filter((i) => (session.drafts || !i.pr.isDraft) && !ids.has(i.pr.id) && Boolean(ids.add(i.pr.id)))
      .map((i) =>
        candidate(
          i.pr,
          i.events.some((e) => e.kind === "rerequest"),
          pace,
        ),
      );
    const picked = plan(candidates, session.minutes, session.order, config.reviewTime.againFirst);
    const waited = this.takeHeld("review");
    const run = {
      session: session.id,
      name: session.name.trim() || this.reviewWords.reviewTime,
      minutes: session.minutes,
      startedAt: now,
      pulls: picked.picked,
      left: picked.left,
      overBy: picked.overBy,
    };
    if (run.pulls.length > 0 || !config.reviewTime.skipEmpty) {
      const { title, body } = offerWords(run, this.reviewWords);
      this.chime(config, title, body);
      this.release(waited, "waitedForReview", false);
    } else {
      this.release(waited, "waitedForReview", config.sound);
    }
    // Nothing to review: nothing to count down.
    if (run.pulls.length > 0) this.persisted.run = run;
    await this.saveState();
  }

  /** Ends the review time under way: its time is up (said, if asked), or it was ended by hand. What waited for the
   *  end of it shows now. */
  private async endRun(timeUp: boolean): Promise<void> {
    const { config } = this;
    const { run } = this.persisted;
    if (!config || !run) return;
    this.persisted.run = null;
    const waited = this.takeHeld("end");
    const told = timeUp && config.reviewTime.remindEnd && run.pulls.length > 0;
    if (told) {
      const session = config.reviewTime.sessions.find((s) => s.id === run.session);
      const waiting = new Set(this.sessionItems(session).map((i) => i.pr.id));
      const { title, body } = endWords(run, run.pulls.filter((p) => waiting.has(p.id)).length, this.reviewWords);
      this.chime(config, title, body);
    }
    this.release(waited, "cameInWhileReviewing", config.sound && !told);
    await this.saveState();
  }

  /** The minutes left, while a review time is under way. */
  private updateCountdown(now: number): void {
    const { run } = this.persisted;
    const minutes = run ? minutesLeft(run, now) : null;
    if (minutes === this.shownCountdown) return;
    this.shownCountdown = minutes;
    this.options.countdown?.(minutes);
  }

  // MARK: Clicks

  /** Clicking a card counts as having looked at it. */
  public markSeen(queueId: string, prId: string): Promise<void> {
    return this.change(() => {
      for (const e of this.itemOf(queueId, prId)?.events ?? []) this.persisted.seen[e.key] = true;
      this.arrivals.delete(prId);
    });
  }

  public markQueueSeen(queueId: string): Promise<void> {
    return this.change(() => {
      for (const [id, list] of this.items) {
        if (id === queueId) for (const item of list) for (const e of item.events) this.persisted.seen[e.key] = true;
      }
    });
  }

  /** Takes a pull request off a queue by hand (merged: seen; others: ignored), until it leaves the queue's search. */
  public dismiss(queueId: string, prId: string): Promise<void> {
    return this.change(() => {
      const item = this.itemOf(queueId, prId);
      if (item) {
        const fresh = item.events.map((e) => e.key).filter((key) => !Object.hasOwn(this.persisted.seen, key));
        for (const key of fresh) this.persisted.seen[key] = true;
        this.dismissedNow.push({ queueId, item, fresh });
        this.dismissedNow = this.dismissedNow.slice(Math.max(0, this.dismissedNow.length - MOST_UNDONE));
      }
      this.persisted.dismissed[`${queueId}:${prId}`] = true;
      this.arrivals.delete(prId);
      this.items = this.items.map(([id, list]) => [id, id === queueId ? list.filter((i) => i.pr.id !== prId) : list]);
    });
  }

  /** Undo for `dismiss`: the pull request back on its queue, as unread as it was. */
  public restore(queueId: string, prId: string): Promise<void> {
    return this.change(() => {
      delete this.persisted.dismissed[`${queueId}:${prId}`];
      const at = this.dismissedNow.findIndex((d) => d.queueId === queueId && d.item.pr.id === prId);
      if (at === -1) return;
      const { item, fresh } = this.dismissedNow.splice(at, 1)[0]!;
      for (const key of fresh) delete this.persisted.seen[key];
      const entry = this.items.find(([id]) => id === queueId);
      if (entry && !entry[1].some((i) => i.pr.id === prId)) entry[1] = [...entry[1], item];
    });
  }

  /** The panel showed what's new on a pull request. */
  public clearArrival(prId: string): void {
    if (this.arrivals.delete(prId)) this.publish();
  }

  private itemOf(queueId: string, prId: string): EngineItem | undefined {
    return this.items.find(([id]) => id === queueId)?.[1].find((i) => i.pr.id === prId);
  }

  /** Runs `change` on the state, then saves, updates the count and tells the panel. */
  private async change(change: () => void): Promise<void> {
    change();
    await this.saveState();
    this.updateBadge(false);
    this.publish();
  }

  private async saveState(): Promise<void> {
    await this.options.storage.saveState(this.persisted);
  }

  private updateBadge(animate: boolean): void {
    const { seen } = this.persisted;
    const unread = new Set(
      this.items
        .flatMap(([, list]) => list)
        .filter((i) => i.events.some((e) => !Object.hasOwn(seen, e.key)))
        .map((i) => i.pr.id),
    );
    if (this.lastCount === unread.size && !animate) return;
    this.lastCount = unread.size;
    this.options.badge?.(unread.size, animate);
  }

  private publish(): void {
    this.options.publish?.(this.snapshot());
  }
}
