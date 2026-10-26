// The queues, as the desktop's Rust keeps them (watch.rs) and the panel reads them: core's QueueWatch, run by the
// background on alarms, its state in the browser's local storage, what's new as the browser's notifications, and
// the toolbar button's badge as the tray icon's count (or, while a review time is under way, its minutes left).

import { parseConfig, type Config } from "@focus-diff/core/queue-config";
import { readReply, type Cache } from "@focus-diff/core/queue-engine";
import { QueueWatch, type Note, type Persisted } from "@focus-diff/core/queue-watch";
import { ENGLISH, PORTUGUESE, type Words } from "@focus-diff/core/queue-words";
import { ENGLISH_REVIEW, PORTUGUESE_REVIEW, type ReviewWords } from "@focus-diff/core/review-time";
import { browser } from "wxt/browser";

import { storage } from "#imports";
import { readAppFile } from "@/utils/app-files/app-files";
import type { CommandServer, Commands } from "@/utils/command-server/command-server";
import { language } from "@/utils/words/words";

/** One call to the GitHub API, as the background makes them: its status and body. */
export type Request = (
  method: string,
  path: string,
  body: string | null,
  accept: string | null,
) => Promise<{ status: number; body: string }>;

export interface QueueOptions {
  request: Request;
  /** Who's signed in: null when no one is; rejects when GitHub can't be reached to tell. */
  login: () => Promise<string | null>;
  server: Pick<CommandServer, "broadcast">;
  now?: () => number;
}

export interface Queues {
  watch: QueueWatch;
  /** The panel's commands: snapshot, refresh, mark_seen, mark_queue_seen, dismiss, restore, clear_arrival, end_review. */
  commands: Commands;
  /** Last time's state read back and GitHub asked (unless it answered lately): the background's start. */
  started: Promise<void>;
  /** config.json changed: its rules now, and the refresh alarm on its rhythm. */
  configChanged: () => Promise<void>;
  /** Signed in or out. */
  authChanged: () => Promise<void>;
  /** One of the background's alarms went off: the queues' if it's theirs. */
  onAlarm: (alarm: { name: string }) => Promise<void>;
}

export const REFRESH_ALARM = "queues-refresh";
export const TICK_ALARM = "queues-tick";
/** The browser's shortest alarm (Chrome's), in minutes. */
const SHORTEST = 0.5;

const stateItem = storage.defineItem<Persisted | null>("local:watch.state", { fallback: null });
const cacheItem = storage.defineItem<Cache | null>("local:watch.cache", { fallback: null });

/** The badge's colours: the count, and review time's minutes left. */
export const COUNT_COLOR = "#0a84ff";
export const COUNTDOWN_COLOR = "#30d158";

/** A set of words that follows the language in use, word by word. */
const live = <T extends object>(pick: () => T, sample: T): T => {
  const words = {};
  for (const key of Object.keys(sample)) {
    Object.defineProperty(words, key, { enumerable: true, get: (): unknown => Reflect.get(pick(), key) });
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every key of `sample` has a getter for the word of the same type
  return words as T;
};

/** Runs `job` without waiting for GitHub, as the desktop's commands only send the watch a message. */
const later = (job: Promise<void>) => {
  job.catch(() => {
    // The watch shows what went wrong in its status.
  });
};

const ids = (args: Record<string, unknown>) => [String(args.queueId), String(args.prId)] as const;

const parse = (text: string | null): unknown => {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return null;
  }
};

/** The person's setup from config.json, null without one. */
export const readConfig = async (): Promise<Config | null> => parseConfig(parse(await readAppFile("config")));

/** A notification, with its sound or without; a browser that can't say (Firefox) uses its own setting. */
export const showNotification = async ({ title, body, sound }: Note): Promise<void> => {
  const options = {
    type: "basic" as const,
    iconUrl: browser.runtime.getURL("/icon/128.png"),
    title,
    message: body,
  };
  try {
    await browser.notifications.create({ ...options, silent: !sound });
  } catch {
    await browser.notifications.create(options).catch(() => {
      // Notifications are off for the browser: the panel still shows what's new.
    });
  }
};

/** Starts the queues: reads last time's state, asks GitHub, and keeps the alarms. */
export const startQueues = ({ request, login, server, now = Date.now }: QueueOptions): Queues => {
  const words: Words = live(() => (language() === "pt-BR" ? PORTUGUESE : ENGLISH), ENGLISH);
  const reviewWords: ReviewWords = live(
    () => (language() === "pt-BR" ? PORTUGUESE_REVIEW : ENGLISH_REVIEW),
    ENGLISH_REVIEW,
  );
  let count = 0;
  let countdown: number | null = null;
  const showBadge = async () => {
    const counting = countdown !== null;
    await browser.action.setBadgeBackgroundColor({ color: counting ? COUNTDOWN_COLOR : COUNT_COLOR });
    await browser.action.setBadgeText({ text: counting ? `${countdown}m` : count > 0 ? String(count) : "" });
  };

  const watch = new QueueWatch({
    gql: {
      query: async (query, variables) => {
        const reply = await request("POST", "/graphql", JSON.stringify({ query, variables }), null);
        return readReply(reply.status, reply.body, words);
      },
    },
    login,
    config: readConfig,
    now,
    storage: {
      loadState: () => stateItem.getValue(),
      saveState: (state) => stateItem.setValue(state),
      loadCache: () => cacheItem.getValue(),
      saveCache: (cache) => cacheItem.setValue(cache),
    },
    notify: (note) => void showNotification(note),
    chime: (note) => void showNotification(note),
    words,
    reviewWords,
    pace: async () => parse(await readAppFile("pace")),
    publish: (snapshot) => {
      server.broadcast("snapshot", snapshot);
    },
    badge: (unread) => {
      count = unread;
      void showBadge();
    },
    countdown: (minutes) => {
      countdown = minutes;
      void showBadge();
    },
  });

  const keepAlarms = async () => {
    await browser.alarms.create(REFRESH_ALARM, { periodInMinutes: Math.max(watch.pollMs() / 60_000, SHORTEST) });
    if (!(await browser.alarms.get(TICK_ALARM))) await browser.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  };

  // A click on one of its notifications opens the panel, where the browser lets it.
  browser.notifications.onClicked.addListener((id) => {
    void browser.notifications.clear(id);
    void browser.action.openPopup?.().catch(() => {
      // Only from a click on the toolbar in this browser.
    });
  });

  // The background stops when it's idle and starts again for an alarm or a page: GitHub is asked only when its last
  // answer is older than the rhythm.
  const started = watch.boot({ force: false }).then(keepAlarms);

  return {
    watch,
    started,
    commands: {
      snapshot: () => watch.snapshot(),
      refresh: ({ force }) => {
        later(watch.refresh(force === true));
      },
      mark_seen: (args) => watch.markSeen(...ids(args)),
      mark_queue_seen: ({ queueId }) => watch.markQueueSeen(String(queueId)),
      dismiss: (args) => watch.dismiss(...ids(args)),
      restore: (args) => watch.restore(...ids(args)),
      clear_arrival: ({ prId }) => {
        watch.clearArrival(String(prId));
      },
      end_review: () => {
        later(watch.endReview());
      },
    },
    configChanged: async () => {
      await watch.configChanged();
      await keepAlarms();
    },
    authChanged: () => watch.authChanged(),
    onAlarm: async ({ name }) => {
      if (name === REFRESH_ALARM) await watch.refresh();
      if (name === TICK_ALARM) await watch.reviewTick();
    },
  };
};
