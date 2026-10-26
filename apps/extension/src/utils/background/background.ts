import { i18n } from '#i18n';
import { browser } from 'wxt/browser';
import { fetchDetail, fetchNotifications, fetchPulls } from '@/utils/github-inbox/github-inbox';
import { checkInbox } from '@/utils/inbox-check/inbox-check';
import {
  endRun,
  hold,
  holding,
  initReviewTime,
  onReviewAlarm,
  onReviewNotification,
  openPull,
  readQueueFiles,
  recoverReviewTime,
  runBadge,
  scheduleReviewTime,
  snoozeRun,
  startNow,
  startRun,
} from '@/utils/review-scheduler/review-scheduler';
import { isSilent, play } from '@/utils/background-sound/background-sound';
import {
  inPopup,
  isDone,
  isQuiet,
  markAgain,
  pruneDone,
  type Delivery,
  type HeldEvent,
  type InboxEvent,
  type InboxSnapshot,
  type NotifySettings,
} from '@/utils/inbox/inbox';
import type { Command, Message } from '@/utils/messages/messages';
import {
  doneItem,
  inboxItem,
  inboxMemoryItem,
  loadNotify,
  loadPopup,
  notificationLinksItem,
  notifyItem,
  popupItem,
  queueHistoryItem,
  reviewSkipItem,
  reviewTimeItem,
  updateItem,
} from '@/utils/storage/storage';

/** Patch releases only fix things, so only a new minor or major version is worth telling the reader about. */
const isNotable = (previous: string, current: string) =>
  previous.split('.').slice(0, 2).join('.') !== current.split('.').slice(0, 2).join('.');

/**
 * Reuses an open settings tab instead of piling up copies that could overwrite each other. Finding the tab by its URL
 * would need the tabs permission, so the open page is asked to come forward instead.
 */
const openOptions = async (repo?: string | null, section?: string) => {
  const message: Message = { type: 'show-options', repo, section };
  const shown = await browser.runtime.sendMessage(message).catch(() => false);
  if (shown === true) return;
  const hash = repo ? `#repo=${encodeURIComponent(repo)}` : section ? `#${section}` : '';
  const url = browser.runtime.getURL(`/options.html${hash}`);
  await browser.tabs.create({ url });
};

const openWelcome = () => browser.tabs.create({ url: browser.runtime.getURL('/welcome.html') });

const ALARM = 'inbox';
/** Notifications shown from one look; past it, one more says how many others there are. */
const NOTIFICATION_LIMIT = 4;

const source = { pulls: fetchPulls, notifications: fetchNotifications, detail: fetchDetail };

/**
 * The icon counts the pull requests waiting for the reader's review, leaving out drafts and the ones they marked done,
 * or warns when they're signed out of GitHub. During review time, it counts down the minutes left instead.
 */
const updateBadge = async (settings: NotifySettings, snapshot: InboxSnapshot | null) => {
  const reviewing = await runBadge();
  if (reviewing) {
    await browser.action.setBadgeBackgroundColor({ color: reviewing.color });
    await browser.action.setBadgeText({ text: reviewing.text });
    return;
  }
  const [done, popup] = await Promise.all([doneItem.getValue(), loadPopup()]);
  // What the popup lists: the repositories the reader picked, without drafts or what they marked done.
  const waiting = snapshot?.reviews.filter((pull) => !pull.draft && !isDone(done, pull) && inPopup(popup, pull)).length ?? 0;
  const signedOut = snapshot?.problem === 'signed-out';
  const text = !settings.enabled ? '' : signedOut ? '!' : waiting ? String(waiting) : '';
  await browser.action.setBadgeBackgroundColor({ color: signedOut ? '#d29922' : '#1f6feb' });
  await browser.action.setBadgeText({ text });
};

const TITLES: Record<InboxEvent['kind'], (actor: string, event: InboxEvent) => string> = {
  'review-requested': (actor, event) =>
    event.again
      ? i18n.t('notifyReviewAgain', [actor])
      : event.team
        ? i18n.t('notifyReviewRequestedTeam', [actor])
        : i18n.t('notifyReviewRequested', [actor]),
  'ready-for-review': (actor) => i18n.t('notifyReadyForReview', [actor]),
  'comment-mine': (actor) => i18n.t('notifyCommentMine', [actor]),
  'comment-reviewing': (actor) => i18n.t('notifyCommentReviewing', [actor]),
  mention: (actor) => i18n.t('notifyMention', [actor]),
  approved: (actor) => i18n.t('notifyApproved', [actor]),
  'changes-requested': (actor) => i18n.t('notifyChangesRequested', [actor]),
};

/** A review request opens on the files, where the bar is; anything else opens on the comment or review itself. */
const linkFor = (event: InboxEvent) =>
  event.kind === 'review-requested' || event.kind === 'ready-for-review' ? `${event.url}/changes` : event.url;

/**
 * Chrome alone can keep a notification quiet or on screen; Firefox turns down a notification that asks. It's kept
 * quiet whenever the sound is one of ours, which plays on its own, or none.
 */
const deliveryOptions = (delivery: Delivery) =>
  import.meta.env.FIREFOX ? {} : { silent: isSilent(delivery.sound), requireInteraction: delivery.sticky };

const showNotifications = async (events: InboxEvent[], delivery: Delivery) => {
  if (!events.length || !browser.notifications) return;
  if (!(await browser.permissions.contains({ permissions: ['notifications'] }))) return;
  const iconUrl = browser.runtime.getURL('/icon/128.png');
  const options = deliveryOptions(delivery);
  const links = await notificationLinksItem.getValue();
  const titleOf = (event: InboxEvent) => TITLES[event.kind](event.actor || event.repo, event);
  // A notification shown under an id already on screen, or still in the system's list, only replaces it, without popping
  // up; each one gets an id of its own.
  const stamp = Date.now();
  if (delivery.grouped && events.length > 1) {
    // One notification for the lot, a line each; it opens GitHub's own notifications, where they all are. A list
    // notification's lines don't show on macOS, so they're the message.
    const id = `inbox:group:${stamp}`;
    links[id] = 'https://github.com/notifications';
    const title = i18n.t('notifyGrouped', events.length, [events.length]);
    const message = events
      .slice(0, 5)
      .map((event) => `${titleOf(event)}: ${event.excerpt ? `“${event.excerpt}”` : event.title}`)
      .join('\n');
    await browser.notifications.create(id, { type: 'basic', iconUrl, title, message, ...options });
  } else {
    for (const event of events.slice(0, NOTIFICATION_LIMIT)) {
      const id = `inbox:${event.kind}:${event.url}:${stamp}`;
      links[id] = linkFor(event);
      // What a comment or review said, with the pull request under it; a request or a draft made ready, the pull request.
      const where = `${event.repo}#${event.number}`;
      await browser.notifications.create(id, {
        type: 'basic',
        iconUrl,
        title: titleOf(event),
        message: event.excerpt ? (import.meta.env.FIREFOX ? `“${event.excerpt}”\n${event.title}` : `“${event.excerpt}”`) : event.title,
        // Firefox doesn't show a context line.
        ...(import.meta.env.FIREFOX ? {} : { contextMessage: event.excerpt ? `${where} · ${event.title}` : where }),
        ...options,
      });
    }
    const more = events.length - NOTIFICATION_LIMIT;
    if (more > 0) {
      const id = `inbox:more:${stamp}`;
      links[id] = 'https://github.com/notifications';
      await browser.notifications.create(id, {
        type: 'basic',
        iconUrl,
        title: i18n.t('notifyMore', more, [more]),
        message: '',
        ...options,
      });
    }
  }
  // Only the latest ones can still be on screen.
  await notificationLinksItem.setValue(Object.fromEntries(Object.entries(links).slice(-50)));
  // One sound for the lot.
  await play(delivery.sound);
};

let running: Promise<void> | null = null;
/**
 * One look at GitHub; asked again while it's running, it's the same look. A full look, the alarm's, also reads the
 * notifications and tells what's new; the popup's reads only the two lists, about 55 KB to the full one's megabyte or
 * more, and leaves telling what's new to the next full one.
 */
const look = (full: boolean): Promise<void> =>
  (running ??= (async () => {
    const [settings, memory, previous] = await Promise.all([loadNotify(), inboxMemoryItem.getValue(), inboxItem.getValue()]);
    // The queue, and what the reader is told about it, can leave out the reviews asked of their teams.
    const { teams } = await loadPopup();
    const result = await checkInbox(source, full ? settings : { ...settings, enabled: false }, memory, { skipTeams: !teams });
    // A failed look keeps the lists from the last one, and when they're from, except when signed out, when they're no
    // longer the reader's.
    const failed = result.snapshot.problem;
    let snapshot = failed && failed !== 'signed-out' && previous ? { ...previous, problem: failed } : result.snapshot;
    if (!failed) {
      // Signed out, the last list read was empty, which tells nothing about what left it.
      const before = previous && previous.problem !== 'signed-out' ? previous.reviews : null;
      const marked = markAgain(before, snapshot.reviews, await queueHistoryItem.getValue(), Date.now());
      snapshot = { ...snapshot, reviews: marked.reviews };
      await queueHistoryItem.setValue(marked.history);
    }
    await inboxItem.setValue(snapshot);
    if (result.memory) await inboxMemoryItem.setValue(result.memory);
    if (!failed) {
      // A mark is let go once its pull request is off the lists, or back on them with something new.
      const done = await doneItem.getValue();
      const kept = pruneDone(done, [...snapshot.reviews, ...snapshot.mine]);
      if (Object.keys(kept).length !== Object.keys(done).length) await doneItem.setValue(kept);
    }
    await updateBadge(settings, snapshot);
    // What the reader keeps for review time, or everything while they review if they asked, waits; the rest shows now.
    const waitsUntil = await holding();
    const held: HeldEvent[] = [];
    const now: InboxEvent[] = [];
    const again = new Set(snapshot.reviews.filter((pull) => pull.again).map((pull) => pull.url));
    for (const found of result.events) {
      // A request for a pull request the reader reviewed before is a request to review it again.
      const event = found.kind === 'review-requested' && again.has(found.url) ? { ...found, again: true } : found;
      const until = waitsUntil(settings.events[event.kind].when);
      if (until) held.push({ ...event, until, heldAt: Date.now() });
      else now.push(event);
    }
    await hold(held);
    // In quiet hours the lists and the count still update; only nothing pops up.
    if (settings.enabled && !isQuiet(settings, new Date())) await showNotifications(now, settings.delivery);
    // Not waited on: the files pages take a few seconds, and the lists are already there to show.
    if (!failed) void readQueueFiles(snapshot.reviews);
  })().finally(() => (running = null)));

const refresh = () => look(true);

/** The lists read this recently are fresh enough for the popup to show without reading them again. */
const FRESH_MS = 30_000;
const refreshLists = async () => {
  const previous = await inboxItem.getValue();
  if (running || !previous || previous.problem || Date.now() - previous.checkedAt > FRESH_MS) await (running ?? look(false));
};

/** Looks at GitHub every few minutes while notifications are on. Turned off, it forgets what it saw, so turning them back on doesn't bring up everything since. */
const schedule = async () => {
  const settings = await loadNotify();
  if (!settings.enabled) {
    await browser.alarms.clear(ALARM);
    await inboxMemoryItem.setValue(null);
    await updateBadge(settings, null);
    return;
  }
  // As often as the reader picked; a new pick replaces the alarm.
  const alarm = await browser.alarms.get(ALARM);
  if (alarm?.periodInMinutes !== settings.interval) await browser.alarms.create(ALARM, { periodInMinutes: settings.interval });
  await refresh();
};

const openLink = async (id: string) => {
  if (await onReviewNotification(id)) return;
  const links = await notificationLinksItem.getValue();
  const url = links[id];
  if (url) await browser.tabs.create({ url });
  await browser.notifications?.clear(id);
};

/** The notifications API only exists once the reader has allowed it, so its listener goes on when it does. */
let listening = false;
const listenToNotifications = () => {
  if (listening || !browser.notifications) return;
  listening = true;
  browser.notifications.onClicked.addListener((id) => void openLink(id));
  // Chrome's notifications have buttons; the review time offer's start it or put it off.
  browser.notifications.onButtonClicked?.addListener((id, button) => void onReviewNotification(id, button));
};

/** The background: checks GitHub on its alarms, sends notifications, keeps the badge and runs review time. */
export const startBackground = (): void => {
  initReviewTime({
    refreshLists: () => refreshLists(),
    updateBadge: async () => updateBadge(await loadNotify(), await inboxItem.getValue()),
    // Kept while the reader reviewed: shown once the time's up, unless that's in quiet hours.
    release: async (events) => {
      const settings = await loadNotify();
      if (!settings.enabled) return true;
      if (isQuiet(settings, new Date())) return false;
      await showNotifications(events, settings.delivery);
      return true;
    },
  });
  browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    if (reason === 'install') void openWelcome();
    const { version } = browser.runtime.getManifest();
    if (reason === 'update' && previousVersion && isNotable(previousVersion, version)) void updateItem.setValue(version);
    void schedule();
    void recoverReviewTime();
  });
  browser.runtime.onStartup.addListener(() => {
    void schedule();
    void recoverReviewTime();
  });
  notifyItem.watch(() => void schedule());
  reviewTimeItem.watch(() => void scheduleReviewTime());
  reviewSkipItem.watch(() => void scheduleReviewTime());
  doneItem.watch(async () => updateBadge(await loadNotify(), await inboxItem.getValue()));
  // Leaving out the reviews asked of the reader's teams takes reading the lists again, to tell which those are.
  popupItem.watch((next, previous) => {
    if (next?.teams === false && previous?.teams !== false) void look(false);
    else void loadNotify().then(async (settings) => updateBadge(settings, await inboxItem.getValue()));
  });
  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM) void refresh();
    else await onReviewAlarm(alarm);
  });
  listenToNotifications();
  browser.permissions.onAdded?.addListener(listenToNotifications);

  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message?.type === 'open-options') void openOptions(message.repo, message.section);
    if (message?.type === 'open-welcome') void openWelcome();
    if (message?.type === 'inbox-refresh') {
      // The popup is opening: a review time whose alarm was lost, like over a restart, is put right first.
      void recoverReviewTime()
        .then(refreshLists)
        .then(() => sendResponse(true));
      return true;
    }
    // Answered once done, so the popup can say so; a failure answers too, with false.
    const reviewTime = {
      'review-start-now': () => (message.type === 'review-start-now' ? startNow(message.minutes, message.session) : undefined),
      'review-start': () => startRun({ fromPopup: true }),
      'review-snooze': () => snoozeRun(),
      'review-end': () => endRun('ended'),
      'review-skip': () => endRun('skipped'),
      'review-open': () => (message.type === 'review-open' ? openPull(message.url, message.repo, false) : undefined),
    }[message?.type as string];
    if (reviewTime) {
      void Promise.resolve(reviewTime()).then(
        (answer) => sendResponse(answer ?? true),
        () => sendResponse(false),
      );
      return true;
    }
  });

  browser.commands.onCommand.addListener(async (command, tab) => {
    const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    if (!target?.id) return;
    const message: Message = { type: 'command', command: command as Command };
    await browser.tabs.sendMessage(target.id, message).catch(() => {});
  });
};
