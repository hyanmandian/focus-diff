import type { Learned } from "@focus-diff/core/estimate";

import { storage } from "#imports";
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from "@/utils/appearance/appearance";
import { ALL, normalize, type Config } from "@/utils/filters/filters";
import {
  DEFAULT_NOTIFY,
  DEFAULT_POPUP,
  normalizeNotify,
  normalizePopup,
  type DoneMarks,
  type HeldEvent,
  type InboxMemory,
  type InboxSnapshot,
  type NotifySettings,
  type PopupSettings,
  type QueueHistory,
} from "@/utils/inbox/inbox";
import {
  DEFAULT_REVIEW_TIME,
  normalizeReviewTime,
  type FilesRecord,
  type ReviewRun,
  type ReviewTimeSettings,
} from "@/utils/review-sessions/review-sessions";

/** Selected filter ids per repository. An empty list means "All". */
export type Selections = Record<string, string[]>;

export const configItem = storage.defineItem<Config>("sync:config", {
  fallback: { global: [], repos: [] },
});

export const selectionsItem = storage.defineItem<Selections>("local:active", {
  fallback: {},
  version: 2,
  migrations: {
    2: (previous: Record<string, string | string[]>): Selections =>
      Object.fromEntries(
        Object.entries(previous ?? {}).map(([repo, ids]) => [repo, [ids].flat().filter((id) => id && id !== ALL)]),
      ),
  },
});

/** The bar's theme and the reader's CSS for it, synced like the filters. */
export const appearanceItem = storage.defineItem<Appearance>("sync:appearance", { fallback: DEFAULT_APPEARANCE });

export const loadAppearance = async (): Promise<Appearance> => normalizeAppearance(await appearanceItem.getValue());

export const saveAppearance = (appearance: Appearance): Promise<void> =>
  appearanceItem.setValue(normalizeAppearance(appearance));

/** The release whose notes the reader hasn't seen yet, set when the extension updates to a new minor or major version. */
export const updateItem = storage.defineItem<string | null>("local:update", { fallback: null });

export const loadConfig = async (): Promise<Config> => normalize(await configItem.getValue());

export const saveConfig = (config: Config): Promise<void> => configItem.setValue(normalize(config));

/** Whether to watch the reader's pull requests on GitHub, and their rules for what to be told; synced like the filters. */
export const notifyItem = storage.defineItem<NotifySettings>("sync:notifications", { fallback: DEFAULT_NOTIFY });

export const loadNotify = async (): Promise<NotifySettings> => normalizeNotify(await notifyItem.getValue());

export const saveNotify = (settings: NotifySettings): Promise<void> => notifyItem.setValue(normalizeNotify(settings));

/** Which repositories the popup lists. */
export const popupItem = storage.defineItem<PopupSettings>("sync:popup", { fallback: DEFAULT_POPUP });

export const loadPopup = async (): Promise<PopupSettings> => normalizePopup(await popupItem.getValue());

export const savePopup = (settings: PopupSettings): Promise<void> => popupItem.setValue(normalizePopup(settings));

/** The reader's pull request lists as last read, for the popup to show at once. */
export const inboxItem = storage.defineItem<InboxSnapshot | null>("local:inbox", { fallback: null });

/** The pull requests the reader marked done in the popup, synced so they stay done on their other browsers. */
export const doneItem = storage.defineItem<DoneMarks>("sync:inboxDone", { fallback: {} });

/** What the background last saw, to tell what's new; cleared when notifications go off, so turning them on starts afresh. */
export const inboxMemoryItem = storage.defineItem<InboxMemory | null>("local:inboxMemory", { fallback: null });

/** Where each notification on screen leads, since the background may have restarted by the time one is clicked. */
export const notificationLinksItem = storage.defineItem<Record<string, string>>("local:notificationLinks", {
  fallback: {},
});

/** The reader's review times, and how review time estimates and reminds; synced like the filters. */
export const reviewTimeItem = storage.defineItem<ReviewTimeSettings>("sync:reviewTime", {
  fallback: DEFAULT_REVIEW_TIME,
});

export const loadReviewTime = async (): Promise<ReviewTimeSettings> =>
  normalizeReviewTime(await reviewTimeItem.getValue());

export const saveReviewTime = (settings: ReviewTimeSettings): Promise<void> =>
  reviewTimeItem.setValue(normalizeReviewTime(settings));

/** The review time offered or under way, if any. */
export const reviewRunItem = storage.defineItem<ReviewRun | null>("local:reviewRun", { fallback: null });

/** Each pull request's files as last read for an estimate, by url, so they're read again only after a push. */
export const pullFilesItem = storage.defineItem<Record<string, FilesRecord>>("local:pullFiles", { fallback: {} });

/** The reader's pace as learned from the files they review, on this device. */
export const learnedItem = storage.defineItem<Learned | null>("local:learnedPace", { fallback: null });

/** Notifications kept for the next review time, or for the end of the one under way. */
export const heldItem = storage.defineItem<HeldEvent[]>("local:heldNotifications", { fallback: [] });

/** Review times before this moment are skipped, like the next one or the rest of today, from the popup; 0 for none. */
export const reviewSkipItem = storage.defineItem<number>("local:reviewSkipUntil", { fallback: 0 });

/** When pull requests left the review queue, to know the ones back on it were asked to be reviewed again. */
export const queueHistoryItem = storage.defineItem<QueueHistory>("local:reviewQueueHistory", { fallback: {} });
