import { browser, type Browser } from "wxt/browser";

import { i18n } from "#i18n";
import { isSilent, play } from "@/utils/background-sound/background-sound";
import { fetchDetail, fetchNotifications, fetchPulls } from "@/utils/github-inbox/github-inbox";
import { checkInbox, pool } from "@/utils/inbox-check/inbox-check";
import {
  inPopup,
  isDone,
  isIgnored,
  isQuiet,
  isWatching,
  markAgain,
  pruneDone,
  pruneIgnored,
  type Delivery,
  type HeldEvent,
  type InboxEvent,
  type InboxSnapshot,
  type NotifySettings,
} from "@/utils/inbox/inbox";
import { COMMANDS, type Message } from "@/utils/messages/messages";
import { readBranches } from "@/utils/pull-branches/pull-branches";
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
} from "@/utils/review-scheduler/review-scheduler";
import {
  doneItem,
  ignoredItem,
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
} from "@/utils/storage/storage";

const isNotable = (previous: string, current: string) =>
  previous.split(".").slice(0, 2).join(".") !== current.split(".").slice(0, 2).join(".");

const openOptions = async (repo?: string | null, section?: string) => {
  const message: Message = { type: "show-options", repo, section };
  const shown: unknown = await browser.runtime.sendMessage(message).catch(() => false);
  if (shown === true) return;
  const hash = repo ? `#repo=${encodeURIComponent(repo)}` : section ? `#${section}` : "";
  const url = browser.runtime.getURL(`/options.html${hash}`);
  await browser.tabs.create({ url });
};

const openWelcome = () => browser.tabs.create({ url: browser.runtime.getURL("/welcome.html") });

const ALARM = "inbox";
const NOTIFICATION_LIMIT = 4;

const source = { pulls: fetchPulls, notifications: fetchNotifications, detail: fetchDetail };

const updateBadge = async (settings: NotifySettings, snapshot: InboxSnapshot | null) => {
  const reviewing = await runBadge();
  if (reviewing) {
    await browser.action.setBadgeBackgroundColor({ color: reviewing.color });
    await browser.action.setBadgeText({ text: reviewing.text });
    return;
  }
  const [done, ignored, popup] = await Promise.all([doneItem.getValue(), ignoredItem.getValue(), loadPopup()]);
  const waiting =
    snapshot?.reviews.filter(
      (pull) => !pull.draft && !isDone(done, pull) && !isIgnored(ignored, "reviews", pull) && inPopup(popup, pull),
    ).length ?? 0;
  const signedOut = snapshot?.problem === "signed-out";
  const text = settings.enabled ? (signedOut ? "!" : waiting ? String(waiting) : "") : "";
  await browser.action.setBadgeBackgroundColor({ color: signedOut ? "#d29922" : "#1f6feb" });
  await browser.action.setBadgeText({ text });
};

const recount = async () => updateBadge(await loadNotify(), await inboxItem.getValue());

const TITLES: Record<InboxEvent["kind"], (actor: string, event: InboxEvent) => string> = {
  "review-requested": (actor, event) =>
    event.again
      ? i18n.t("notifyReviewAgain", [actor])
      : event.team
        ? i18n.t("notifyReviewRequestedTeam", [actor])
        : i18n.t("notifyReviewRequested", [actor]),
  "ready-for-review": (actor) => i18n.t("notifyReadyForReview", [actor]),
  "comment-mine": (actor) => i18n.t("notifyCommentMine", [actor]),
  "comment-reviewing": (actor) => i18n.t("notifyCommentReviewing", [actor]),
  mention: (actor) => i18n.t("notifyMention", [actor]),
  approved: (actor) => i18n.t("notifyApproved", [actor]),
  "changes-requested": (actor) => i18n.t("notifyChangesRequested", [actor]),
};

const linkFor = (event: InboxEvent) =>
  event.kind === "review-requested" || event.kind === "ready-for-review" ? `${event.url}/changes` : event.url;

const deliveryOptions = (delivery: Delivery) =>
  import.meta.env.FIREFOX ? {} : { silent: isSilent(delivery.sound), requireInteraction: delivery.sticky };

const titleOf = (event: InboxEvent) => TITLES[event.kind](event.actor || event.repo, event);

const show = async (events: InboxEvent[], delivery: Delivery) => {
  if (events.length === 0 || !browser.notifications) return;
  if (!(await browser.permissions.contains({ permissions: ["notifications"] }))) return;
  const iconUrl = browser.runtime.getURL("/icon/128.png");
  const options = deliveryOptions(delivery);
  const links = { ...(await notificationLinksItem.getValue()) };
  const stamp = Date.now();
  if (delivery.grouped && events.length > 1) {
    const id = `inbox:group:${stamp}`;
    links[id] = "https://github.com/notifications";
    const title = i18n.t("notifyGrouped", events.length, [events.length]);
    const message = events
      .slice(0, 5)
      .map((event) => `${titleOf(event)}: ${event.excerpt ? `“${event.excerpt}”` : event.title}`)
      .join("\n");
    await browser.notifications.create(id, { type: "basic", iconUrl, title, message, ...options });
  } else {
    for (const event of events.slice(0, NOTIFICATION_LIMIT)) {
      const id = `inbox:${event.kind}:${event.url}:${stamp}`;
      links[id] = linkFor(event);
      const where = `${event.repo}#${event.number}`;
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, so the system lists them in order.
      await browser.notifications.create(id, {
        type: "basic",
        iconUrl,
        title: titleOf(event),
        message: event.excerpt
          ? import.meta.env.FIREFOX
            ? `“${event.excerpt}”\n${event.title}`
            : `“${event.excerpt}”`
          : event.title,
        ...(import.meta.env.FIREFOX ? {} : { contextMessage: event.excerpt ? `${where} · ${event.title}` : where }),
        ...options,
      });
    }
    const more = events.length - NOTIFICATION_LIMIT;
    if (more > 0) {
      const id = `inbox:more:${stamp}`;
      links[id] = "https://github.com/notifications";
      await browser.notifications.create(id, {
        type: "basic",
        iconUrl,
        title: i18n.t("notifyMore", more, [more]),
        message: "",
        ...options,
      });
    }
  }
  await notificationLinksItem.setValue(Object.fromEntries(Object.entries(links).slice(-50)));
  await play(delivery.sound);
};

const oneShowing = pool(1);
const showNotifications = (events: InboxEvent[], delivery: Delivery) => oneShowing(() => show(events, delivery));

let running: Promise<void> | null = null;
const look = (full: boolean): Promise<void> =>
  (running ??= (async () => {
    const [settings, memory, previous] = await Promise.all([
      loadNotify(),
      inboxMemoryItem.getValue(),
      inboxItem.getValue(),
    ]);
    const { teams, updates, merged } = await loadPopup();
    const result = await checkInbox(source, full ? settings : { ...settings, enabled: false }, memory, {
      skipTeams: !teams,
      updates,
      merged,
    });
    const failed = result.snapshot.problem;
    let snapshot = failed && failed !== "signed-out" && previous ? { ...previous, problem: failed } : result.snapshot;
    if (!failed) {
      const before = previous && previous.problem !== "signed-out" ? previous.reviews : null;
      const marked = markAgain(before, snapshot.reviews, await queueHistoryItem.getValue(), Date.now());
      snapshot = {
        ...snapshot,
        reviews: marked.reviews,
        updates: snapshot.updates ?? (updates ? previous?.updates : undefined),
        merged: snapshot.merged ?? (merged ? previous?.merged : undefined),
      };
      await queueHistoryItem.setValue(marked.history);
    }
    await inboxItem.setValue(snapshot);
    if (result.memory) await inboxMemoryItem.setValue(result.memory);
    if (!failed) {
      const lists = [snapshot.reviews, snapshot.mine, snapshot.updates ?? [], snapshot.merged ?? []];
      const done = await doneItem.getValue();
      const kept = pruneDone(done, lists.flat());
      if (Object.keys(kept).length !== Object.keys(done).length) await doneItem.setValue(kept);
      const ignored = await ignoredItem.getValue();
      const stillIgnored = pruneIgnored(ignored, snapshot);
      if (JSON.stringify(stillIgnored) !== JSON.stringify(ignored)) await ignoredItem.setValue(stillIgnored);
      void readBranches(lists);
    }
    await updateBadge(settings, snapshot);
    const waitsUntil = await holding();
    const held: HeldEvent[] = [];
    const now: InboxEvent[] = [];
    const again = new Set(snapshot.reviews.filter((pull) => pull.again).map((pull) => pull.url));
    for (const found of result.events) {
      const event = found.kind === "review-requested" && again.has(found.url) ? { ...found, again: true } : found;
      const until = waitsUntil(settings.events[event.kind].when);
      if (until) held.push({ ...event, until, heldAt: Date.now() });
      else now.push(event);
    }
    await hold(held);
    if (settings.enabled && !isQuiet(settings, new Date())) await showNotifications(now, settings.delivery);
    if (!failed) void readQueueFiles(snapshot.reviews);
  })().finally(() => {
    running = null;
  }));

const FRESH_MS = 30_000;
const refreshLists = async () => {
  const previous = await inboxItem.getValue();
  if (running || !previous || previous.problem || Date.now() - previous.checkedAt > FRESH_MS)
    await (running ?? look(false));
};

const schedule = async () => {
  const settings = await loadNotify();
  if (!isWatching(settings)) await inboxMemoryItem.setValue(null);
  if (!settings.enabled) {
    await browser.alarms.clear(ALARM);
    await updateBadge(settings, null);
    return;
  }
  const alarm = await browser.alarms.get(ALARM);
  if (alarm?.periodInMinutes !== settings.interval)
    await browser.alarms.create(ALARM, { periodInMinutes: settings.interval });
  await look(true);
};

const openLink = async (id: string) => {
  if (await onReviewNotification(id)) return;
  const url = (await notificationLinksItem.getValue())[id];
  if (url) await browser.tabs.create({ url });
  await browser.notifications?.clear(id);
};

let listening = false;
const listenToNotifications = () => {
  if (listening || !browser.notifications) return;
  listening = true;
  browser.notifications.onClicked.addListener((id) => void openLink(id));
  browser.notifications.onButtonClicked?.addListener((id, button) => void onReviewNotification(id, button));
};

const onAlarm = async (alarm: Browser.alarms.Alarm) => {
  if (alarm.name === ALARM) void look(true);
  else await onReviewAlarm(alarm);
};

const onCommand = async (command: string, tab?: Browser.tabs.Tab) => {
  const target = tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!target?.id) return;
  const known = COMMANDS.find((each) => each === command);
  if (!known) return;
  const message: Message = { type: "command", command: known };
  await browser.tabs.sendMessage(target.id, message).catch(() => {});
};

const reviewTimeAction = (message: Message): (() => Promise<boolean | void>) | null => {
  const type = message?.type;
  if (type === "review-start-now") return () => startNow(message.minutes, message.session);
  if (type === "review-start") return () => startRun({ fromPopup: true });
  if (type === "review-snooze") return () => snoozeRun();
  if (type === "review-end") return () => endRun("ended");
  if (type === "review-skip") return () => endRun("skipped");
  if (type === "review-open") return () => openPull(message.url, message.repo, false);
  return null;
};

export const startBackground = (): void => {
  initReviewTime({
    refreshLists,
    updateBadge: recount,
    release: async (events) => {
      const settings = await loadNotify();
      if (!settings.enabled) return true;
      if (isQuiet(settings, new Date())) return false;
      await showNotifications(events, settings.delivery);
      return true;
    },
  });
  browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
    if (reason === "install") void openWelcome();
    const { version } = browser.runtime.getManifest();
    if (reason === "update" && previousVersion && isNotable(previousVersion, version))
      void updateItem.setValue(version);
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
  doneItem.watch(() => void recount());
  ignoredItem.watch(() => void recount());
  popupItem.watch((next, previous) => {
    const added = (list: "updates" | "merged") => next?.[list] && !previous?.[list];
    if ((!next?.teams && previous?.teams) || added("updates") || added("merged")) void look(false);
    else void recount();
  });
  browser.alarms.onAlarm.addListener((alarm) => void onAlarm(alarm));
  listenToNotifications();
  browser.permissions.onAdded?.addListener(listenToNotifications);

  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    if (message?.type === "open-options") void openOptions(message.repo, message.section);
    if (message?.type === "open-welcome") void openWelcome();
    if (message?.type === "inbox-refresh") {
      void recoverReviewTime()
        .then(refreshLists)
        .then(
          () => {
            sendResponse(true);
          },
          () => {
            sendResponse(false);
          },
        );
      // oxlint-disable-next-line typescript/strict-void-return -- true keeps the channel open for sendResponse, as the browser asks.
      return true;
    }
    const reviewTime = reviewTimeAction(message);
    if (reviewTime) {
      void reviewTime().then(
        (answer) => {
          sendResponse(answer ?? true);
        },
        () => {
          sendResponse(false);
        },
      );
      // oxlint-disable-next-line typescript/strict-void-return -- true keeps the channel open for sendResponse, as the browser asks.
      return true;
    }
  });

  browser.commands.onCommand.addListener((command, tab) => void onCommand(command, tab));
};
