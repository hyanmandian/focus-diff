import { createEstimator, normalizeLearned } from "@focus-diff/core/estimate";
import { browser, type Browser } from "wxt/browser";

import { i18n } from "#i18n";
import { isSilent, play } from "@/utils/background-sound/background-sound";
import { fetchFiles, type InboxProblem, type PullRequest } from "@/utils/github-inbox/github-inbox";
import { pool } from "@/utils/inbox-check/inbox-check";
import { isDone, type HeldEvent, type InboxEvent, type When } from "@/utils/inbox/inbox";
import {
  candidates,
  estimate,
  isScheduled,
  newSession,
  nextOccurrence,
  plan,
  runEndsAt,
  runPulls,
  sessionFilterIds,
  sessionMatchers,
  type FilesRecord,
  type Plan,
  type Planned,
  type ReviewRun,
  type ReviewSession,
  type ReviewTimeSettings,
} from "@/utils/review-sessions/review-sessions";
import { PACES } from "@/utils/review-time/review-time";
import {
  doneItem,
  heldItem,
  inboxItem,
  learnedItem,
  loadConfig,
  loadPopup,
  loadReviewTime,
  pullFilesItem,
  reviewRunItem,
  reviewSkipItem,
  selectionsItem,
} from "@/utils/storage/storage";

/**
 * Review time in the background: an alarm for the next one; when it comes, the pull requests that fit, offered in a
 * notification; once started, an alarm for when the time's up, and the icon counting down to it. Alarms don't always
 * survive a browser restart or an update, so what's stored is checked again then, and whenever it's read.
 */

/** The next review time's alarm carries its session, so it's offered even if the clock changed since, like for DST. */
const NEXT_ALARM = "review-time:next:";
const SNOOZE_ALARM = "review-time:snooze:";
const END_ALARM = "review-time:end";
const TICK_ALARM = "review-time:tick";
const OFFER_NOTIFICATION = "review-time:offer";
const END_NOTIFICATION = "review-time:end";

/** Files pages read for one plan at most; pull requests past it get a rough estimate this time. */
const FILES_LIMIT = 30;
/** Files pages read at once: a few hundred kilobytes each. */
const FILES_CONCURRENCY = 3;
/** Minutes given to a pull request whose files couldn't be read, on top of the time for any pull request. */
const UNREAD_MINUTES = 10;

interface Hooks {
  /** Reads the reader's lists again, unless they're fresh. */
  refreshLists: () => Promise<void>;
  /** The icon, which counts down while a review time is under way. */
  updateBadge: () => Promise<void>;
  /** Shows notifications kept for later; false when they can't show now, in quiet hours. */
  release: (events: InboxEvent[]) => Promise<boolean>;
}

let hooks: Hooks;
export const initReviewTime = (given: Hooks): void => {
  hooks = given;
};

/** The run as stored, or none once its time is past, whether or not its alarm went off. */
const liveRun = async (): Promise<ReviewRun | null> => {
  const run = await reviewRunItem.getValue();
  return run && runEndsAt(run) > Date.now() ? run : null;
};

/**
 * Held notifications are changed one at a time: a look holding new ones and a review time ending can overlap, and
 * each reads, changes and writes the whole list.
 */
let heldQueue: Promise<unknown> = Promise.resolve();
const changeHeld = <T>(change: (held: HeldEvent[]) => { held: HeldEvent[]; result: T }): Promise<T> => {
  const next = heldQueue.then(async () => {
    const { held, result } = change(await heldItem.getValue());
    await heldItem.setValue(held);
    return result;
  });
  heldQueue = next.catch(() => {});
  return next;
};

/** Shows held notifications; the ones that can't show yet, in quiet hours, wait for the next review time instead. */
const release = async (events: HeldEvent[]) => {
  if (events.length === 0) return;
  if (await hooks.release(events)) return;
  await hold(events.map((event) => ({ ...event, until: "review" as const })));
};

/** The next review time's alarm, or none; with none to come, what was kept for one shows now. */
export const scheduleReviewTime = async (settings?: ReviewTimeSettings): Promise<void> => {
  const [current, skipUntil] = await Promise.all([settings ?? loadReviewTime(), reviewSkipItem.getValue()]);
  const next = nextOccurrence(current, Math.max(Date.now(), skipUntil - 1));
  const name = next ? `${NEXT_ALARM}${next.session.id}` : "";
  const stale = (await browser.alarms.getAll()).filter(
    (alarm) => alarm.name.startsWith(NEXT_ALARM) && (alarm.name !== name || alarm.scheduledTime !== next?.at),
  );
  await Promise.all(stale.map((alarm) => browser.alarms.clear(alarm.name)));
  if (next) {
    if ((await browser.alarms.get(name))?.scheduledTime !== next.at)
      await browser.alarms.create(name, { when: next.at });
    return;
  }
  if (isScheduled(current) || (await liveRun())) return;
  const waiting = await changeHeld((held) => ({
    held: held.filter((event) => event.until !== "review"),
    result: held.filter((event) => event.until === "review"),
  }));
  await release(waiting);
};

/**
 * After a restart or an update, and before anything reads it: a run whose time is past ends as it should have, and one
 * still going gets its alarms back.
 */
export const recoverReviewTime = async (): Promise<void> => {
  const run = await reviewRunItem.getValue();
  if (run && runEndsAt(run) <= Date.now()) await endRun(run.startedAt ? "time" : "lapsed");
  else if (run) {
    if (!(await browser.alarms.get(END_ALARM))) await browser.alarms.create(END_ALARM, { when: runEndsAt(run) });
    if (run.startedAt && !(await browser.alarms.get(TICK_ALARM)))
      await browser.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  }
  await scheduleReviewTime();
};

/**
 * Files read this recently are still right about which the reader marked viewed. Marking one doesn't change the pull
 * request's head, so when only unviewed files count, older ones are read again.
 */
const VIEWED_FRESH_MS = 30 * 60_000;

/**
 * Each pull request's files, read again after a new push, or when `viewed` says which files are viewed must be right,
 * after a while. One read at a time, since each writes the whole cache, and a plan right after a look finds the files
 * the look just read.
 */
let filesQueue: Promise<unknown> = Promise.resolve();
const filesOf = (pulls: PullRequest[], reviews: PullRequest[], viewed: boolean): Promise<(FilesRecord | null)[]> => {
  const next = filesQueue.then(() => readFiles(pulls, reviews, viewed));
  filesQueue = next.catch(() => {});
  return next;
};

const readFiles = async (pulls: PullRequest[], reviews: PullRequest[], viewed: boolean) => {
  const cache = await pullFilesItem.getValue();
  const queue = pool(FILES_CONCURRENCY);
  let budget = FILES_LIMIT;
  const fresh = (record: FilesRecord | undefined, pull: PullRequest) =>
    record &&
    pull.headSha &&
    record.sha === pull.headSha &&
    (!viewed || Date.now() - (record.readAt ?? 0) < VIEWED_FRESH_MS);
  const read = await Promise.all(
    pulls.map(async (pull) => {
      const cached = cache[pull.url];
      if (fresh(cached, pull)) return cached ?? null;
      // Past the budget, files from a while ago are better than none.
      if (budget <= 0) return cached?.sha === pull.headSha ? cached : null;
      budget -= 1;
      const files = await queue(() => fetchFiles(pull.repo, pull.number)).catch(() => null);
      if (!files) return null;
      return (cache[pull.url] = { sha: pull.headSha, files, readAt: Date.now() });
    }),
  );
  // Only the pull requests still waiting for review are kept, so the cache doesn't grow with every one ever estimated.
  const urls = new Set(reviews.map((pull) => pull.url));
  await pullFilesItem.setValue(Object.fromEntries(Object.entries(cache).filter(([url]) => urls.has(url))));
  return read;
};

/**
 * The files of every pull request on the review queue, for the popup to say how long each takes. Which files are viewed
 * can be a while old there; only a new push reads them again.
 */
export const readQueueFiles = async (reviews: PullRequest[]): Promise<void> => {
  const settings = await loadReviewTime();
  if (settings.queueEstimates) await filesOf(reviews, reviews, false).catch(() => {});
};

/**
 * What a session would pick now, from the review queue as it stands, leaving out what the reader marked done, and the
 * reviews asked of their teams when the queue leaves those out. A pull request whose files couldn't be read still
 * counts, at a rough guess, so a change on GitHub's side doesn't silence review time.
 */
const planFor = async (
  session: ReviewSession,
  settings: ReviewTimeSettings,
): Promise<{ result: Plan; problem: InboxProblem | null }> => {
  await hooks.refreshLists();
  const [snapshot, done, config, learned, popup] = await Promise.all([
    inboxItem.getValue(),
    doneItem.getValue(),
    loadConfig(),
    learnedItem.getValue(),
    loadPopup(),
  ]);
  const reviews = snapshot?.reviews ?? [];
  const waiting = candidates(
    session,
    reviews.filter((pull) => !isDone(done, pull) && (popup.teams || !pull.team)),
  );
  const files = await filesOf(waiting, reviews, settings.unviewedOnly);
  const estimator = createEstimator(PACES[settings.pace], settings.learn ? normalizeLearned(learned) : null);
  const items: Planned[] = waiting.map((pull, index) => {
    const record = files[index];
    if (!record) return { pull, estimate: { minutes: settings.perPull + UNREAD_MINUTES, files: 0, guessed: true } };
    return {
      pull,
      estimate: estimate(record.files, sessionMatchers(config, pull.repo, session.filters), settings, estimator),
    };
  });
  return {
    result: plan(items, session.minutes, session.order, settings.againFirst),
    problem: snapshot?.problem ?? null,
  };
};

const name = (session: ReviewSession) => session.name || i18n.t("reviewTimeName");

const runFrom = (session: ReviewSession, result: Plan, startedAt: number | null): ReviewRun => ({
  session: session.id,
  name: name(session),
  minutes: session.minutes,
  offeredAt: Date.now(),
  startedAt,
  pulls: runPulls(result.picked),
  left: result.left.length,
  overBy: result.overBy,
  filters: session.filters,
});

const iconUrl = () => browser.runtime.getURL("/icon/128.png");

const notify = async (
  id: string,
  options: Browser.notifications.NotificationCreateOptions,
  settings: ReviewTimeSettings,
) => {
  if (!browser.notifications || !(await browser.permissions.contains({ permissions: ["notifications"] }))) return;
  await browser.notifications.clear(id);
  const chrome = import.meta.env.FIREFOX ? {} : { silent: isSilent(settings.sound) };
  await browser.notifications.create(id, { ...options, ...chrome });
  // Not waited on: a sound that can't play mustn't hold up what comes after it.
  void play(settings.sound);
};

const offerMessage = (run: ReviewRun, held: number) => {
  const lines = run.pulls.map((pull) => `${pull.title} · ~${pull.minutes} min`);
  if (run.overBy) lines.unshift(i18n.t("reviewTimeOver", [run.pulls[0]?.minutes ?? 0, run.overBy, run.minutes]));
  if (held) lines.push(i18n.t("reviewTimeHeld", held, [held]));
  return lines.join("\n");
};

/** Offers a review time: what fits, in a notification to start it or put it off. */
const offer = async (session: ReviewSession, settings: ReviewTimeSettings) => {
  const { result, problem } = await planFor(session, settings);
  // Signed out, there's no queue to read: say so, rather than that there's nothing to review.
  if (problem === "signed-out") {
    await notify(
      OFFER_NOTIFICATION,
      {
        type: "basic",
        iconUrl: iconUrl(),
        title: i18n.t("reviewTimeSignedOut"),
        message: i18n.t("popupSignedOut"),
        contextMessage: name(session),
      },
      settings,
    );
    return;
  }
  const held = (await heldItem.getValue()).filter((event) => event.until === "review").length;
  if (result.picked.length === 0 && settings.skipEmpty && !held) return;
  // Planning takes a few seconds; one started from the popup meanwhile wins.
  if (await liveRun()) return;
  const run = runFrom(session, result, null);
  await reviewRunItem.setValue(run);
  // Not started by the time it would have ended, the offer lapses.
  await browser.alarms.create(END_ALARM, { when: runEndsAt(run) });
  await hooks.updateBadge();
  const total = run.pulls.reduce((sum, pull) => sum + pull.minutes, 0);
  await notify(
    OFFER_NOTIFICATION,
    {
      type: "basic",
      iconUrl: iconUrl(),
      title:
        run.pulls.length > 0
          ? i18n.t("reviewTimeOffer", run.pulls.length, [run.pulls.length, total])
          : i18n.t("reviewTimeNothing"),
      message: offerMessage(run, held),
      contextMessage: run.name,
      ...(import.meta.env.FIREFOX
        ? {}
        : {
            requireInteraction: true,
            buttons:
              run.pulls.length > 0
                ? [
                    { title: i18n.t("reviewTimeStart") },
                    { title: i18n.t("reviewTimeLater", settings.snooze, [settings.snooze]) },
                  ]
                : [],
          }),
    },
    settings,
  );
};

/** Turns on the session's filters in the bar for the pull request's repository, then opens it on its files. */
export const openPull = async (url: string, repo: string, active: boolean): Promise<void> => {
  const [run, settings, config, selections] = await Promise.all([
    liveRun(),
    loadReviewTime(),
    loadConfig(),
    selectionsItem.getValue(),
  ]);
  const ids = run && settings.applyFilters ? sessionFilterIds(config, repo, run.filters) : [];
  if (ids.length > 0) await selectionsItem.setValue({ ...selections, [repo]: ids });
  await browser.tabs.create({ url: `${url}/changes`, active });
};

/** Starts the review time offered: its clock, and what the reader asked to open. */
export const startRun = async ({ fromPopup = false } = {}): Promise<void> => {
  const run = await liveRun();
  if (!run || run.startedAt || run.pulls.length === 0) return;
  const settings = await loadReviewTime();
  const started = { ...run, startedAt: Date.now() };
  await reviewRunItem.setValue(started);
  await afterStart(started, settings, fromPopup);
};

const afterStart = async (run: ReviewRun, settings: ReviewTimeSettings, fromPopup: boolean) => {
  await browser.notifications?.clear(OFFER_NOTIFICATION);
  await browser.alarms.create(END_ALARM, { when: runEndsAt(run) });
  await browser.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await hooks.updateBadge();
  const opened = settings.opens === "all" ? run.pulls : settings.opens === "first" ? run.pulls.slice(0, 1) : [];
  // From the popup, tabs open behind it; from a notification, the first comes to the front.
  // oxlint-disable-next-line eslint/no-await-in-loop -- the tabs open in the queue's order.
  for (const [index, pull] of opened.entries()) await openPull(pull.url, pull.repo, !fromPopup && index === 0);
};

/** Starts one now, from the popup: false, and nothing started, when nothing is waiting for review. */
export const startNow = async (minutes: number, sessionId: string): Promise<boolean> => {
  const settings = await loadReviewTime();
  const like = settings.sessions.find((session) => session.id === sessionId);
  const session: ReviewSession = { ...(like ?? newSession()), id: like?.id ?? "", name: like?.name ?? "", minutes };
  const { result } = await planFor(session, settings);
  if (result.picked.length === 0) return false;
  const run = runFrom(session, result, Date.now());
  await reviewRunItem.setValue(run);
  await afterStart(run, settings, true);
  return true;
};

/** Puts the offer off a few minutes; it's made again then, with what's waiting by that time. */
export const snoozeRun = async (): Promise<void> => {
  const [run, settings] = await Promise.all([liveRun(), loadReviewTime()]);
  if (!run || run.startedAt) return;
  await clearRun();
  await browser.alarms.create(`${SNOOZE_ALARM}${run.session}`, { delayInMinutes: settings.snooze });
};

const clearRun = async () => {
  await reviewRunItem.setValue(null);
  await browser.alarms.clear(END_ALARM);
  await browser.alarms.clear(TICK_ALARM);
  await browser.notifications?.clear(OFFER_NOTIFICATION);
  await hooks.updateBadge();
};

/**
 * Why a review time is over: its time is up, the reader ended it or skipped the offer, or the offer lapsed unstarted.
 * What was kept for review time and offered with it is let go, since the reader saw it there; anything kept since, or
 * from an offer that lapsed without them looking, waits for the next. What waited for the end of it shows now.
 */
export type Ending = "time" | "ended" | "skipped" | "lapsed";

export const endRun = async (ending: Ending): Promise<void> => {
  const [run, settings] = await Promise.all([reviewRunItem.getValue(), loadReviewTime()]);
  await clearRun();
  const seen = (event: HeldEvent) => ending !== "lapsed" && run !== null && event.heldAt <= run.offeredAt;
  const ended = await changeHeld((held) => ({
    held: held.filter((event) => event.until === "review" && !seen(event)),
    result: held.filter((event) => event.until === "end"),
  }));
  await release(ended);
  if (ending !== "time" || !run || !settings.remindEnd || run.pulls.length === 0) return;
  await hooks.refreshLists();
  const [snapshot, done] = await Promise.all([inboxItem.getValue(), doneItem.getValue()]);
  const total = run.pulls.length;
  const waiting = new Set(snapshot?.reviews.filter((pull) => !isDone(done, pull)).map((pull) => pull.url));
  const reviewed = run.pulls.filter((pull) => !waiting.has(pull.url)).length;
  // Without the queue as it stands now, there's no telling how far the reader got.
  const message = snapshot?.problem
    ? i18n.t("reviewTimeUpUnknown")
    : reviewed === total
      ? i18n.t("reviewTimeAllDone")
      : i18n.t("reviewTimeReviewed", total, [reviewed, total]);
  await notify(
    END_NOTIFICATION,
    { type: "basic", iconUrl: iconUrl(), title: i18n.t("reviewTimeUp"), message, contextMessage: run.name },
    settings,
  );
};

/** What decides whether a notification waits: for the reader's next review time, or for the end of the one under way. */
export const holding = async (): Promise<(when: When) => HeldEvent["until"] | null> => {
  const [settings, run, skipUntil] = await Promise.all([loadReviewTime(), liveRun(), reviewSkipItem.getValue()]);
  const scheduled = Boolean(nextOccurrence(settings, Math.max(Date.now(), skipUntil - 1)));
  return (when) =>
    run?.startedAt && settings.holdWhileReviewing ? "end" : when === "review" && scheduled ? "review" : null;
};

/** One held event per kind of event on a pull request. */
const heldKey = (event: HeldEvent) => `${event.kind} ${event.url}`;

/** Keeps notifications for later, the latest fifty; one kept for the end of a review time that's over shows now. */
export const hold = async (events: HeldEvent[]): Promise<void> => {
  if (events.length === 0) return;
  const reviewing = Boolean((await liveRun())?.startedAt);
  const late = reviewing ? [] : events.filter((event) => event.until === "end");
  const kept = events.filter((event) => !late.includes(event));
  await changeHeld((held) => {
    const merged = new Map([...held, ...kept].map((event) => [heldKey(event), event]));
    return { held: [...merged.values()].slice(-50), result: null };
  });
  await release(late);
};

const offerSession = async (id: string, since: number) => {
  const settings = await loadReviewTime();
  const session = settings.sessions.find((each) => each.id === id);
  // A computer asleep through the whole of it has nothing to offer when it wakes up.
  if (settings.enabled && session?.on && !(await liveRun()) && Date.now() - since < session.minutes * 60_000)
    await offer(session, settings);
};

export const onReviewAlarm = async (alarm: { name: string; scheduledTime: number }): Promise<boolean> => {
  if (alarm.name.startsWith(NEXT_ALARM)) {
    await scheduleReviewTime();
    await offerSession(alarm.name.slice(NEXT_ALARM.length), alarm.scheduledTime);
    return true;
  }
  if (alarm.name.startsWith(SNOOZE_ALARM)) {
    await offerSession(alarm.name.slice(SNOOZE_ALARM.length), alarm.scheduledTime);
    return true;
  }
  if (alarm.name === END_ALARM) {
    const run = await reviewRunItem.getValue();
    await endRun(run?.startedAt ? "time" : "lapsed");
    return true;
  }
  if (alarm.name === TICK_ALARM) {
    await recoverReviewTime();
    await hooks.updateBadge();
    return true;
  }
  return false;
};

/** Clicking the offer starts it; its buttons start it or put it off. The end's only goes away. */
export const onReviewNotification = async (id: string, button?: number): Promise<boolean> => {
  if (id === OFFER_NOTIFICATION) {
    if (button === 1) await snoozeRun();
    else await startRun();
    await browser.notifications?.clear(id);
    return true;
  }
  if (id === END_NOTIFICATION) {
    await browser.notifications?.clear(id);
    return true;
  }
  return false;
};

/** The icon while a review time is offered, a play sign, and while under way, the minutes left. */
export const runBadge = async (): Promise<{ text: string; color: string } | null> => {
  const run = await liveRun();
  if (!run) return null;
  if (!run.startedAt) return { text: "▶", color: "#1a7f37" };
  const left = Math.max(0, Math.ceil((runEndsAt(run) - Date.now()) / 60_000));
  return { text: `${left}m`, color: "#1a7f37" };
};
