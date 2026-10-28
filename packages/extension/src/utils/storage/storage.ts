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
  type IgnoredMarks,
  type InboxMemory,
  type InboxSnapshot,
  type NotifySettings,
  type PopupSettings,
  type QueueHistory,
} from "@/utils/inbox/inbox";
import type { BranchesRecord } from "@/utils/pull-branches/pull-branches";
import {
  DEFAULT_REVIEW_TIME,
  normalizeReviewTime,
  type FilesRecord,
  type ReviewRun,
  type ReviewTimeSettings,
} from "@/utils/review-sessions/review-sessions";

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
        Object.entries(previous).map(([repo, ids]) => [repo, [ids].flat().filter((id) => id && id !== ALL)]),
      ),
  },
});

export const appearanceItem = storage.defineItem<Appearance>("sync:appearance", { fallback: DEFAULT_APPEARANCE });

export const loadAppearance = async (): Promise<Appearance> => normalizeAppearance(await appearanceItem.getValue());

export const saveAppearance = (appearance: Appearance): Promise<void> =>
  appearanceItem.setValue(normalizeAppearance(appearance));

export const updateItem = storage.defineItem<string | null>("local:update", { fallback: null });

export const loadConfig = async (): Promise<Config> => normalize(await configItem.getValue());

export const saveConfig = (config: Config): Promise<void> => configItem.setValue(normalize(config));

export const notifyItem = storage.defineItem<NotifySettings>("sync:notifications", { fallback: DEFAULT_NOTIFY });

export const loadNotify = async (): Promise<NotifySettings> => normalizeNotify(await notifyItem.getValue());

export const saveNotify = (settings: NotifySettings): Promise<void> => notifyItem.setValue(normalizeNotify(settings));

export const popupItem = storage.defineItem<PopupSettings>("sync:popup", { fallback: DEFAULT_POPUP });

export const loadPopup = async (): Promise<PopupSettings> => normalizePopup(await popupItem.getValue());

export const savePopup = (settings: PopupSettings): Promise<void> => popupItem.setValue(normalizePopup(settings));

export const inboxItem = storage.defineItem<InboxSnapshot | null>("local:inbox", { fallback: null });

export const doneItem = storage.defineItem<DoneMarks>("sync:inboxDone", { fallback: {} });

export const ignoredItem = storage.defineItem<IgnoredMarks>("sync:inboxIgnored", { fallback: {} });

export const inboxMemoryItem = storage.defineItem<InboxMemory | null>("local:inboxMemory", { fallback: null });

export const notificationLinksItem = storage.defineItem<Record<string, string>>("local:notificationLinks", {
  fallback: {},
});

export const reviewTimeItem = storage.defineItem<ReviewTimeSettings>("sync:reviewTime", {
  fallback: DEFAULT_REVIEW_TIME,
});

export const loadReviewTime = async (): Promise<ReviewTimeSettings> =>
  normalizeReviewTime(await reviewTimeItem.getValue());

export const saveReviewTime = (settings: ReviewTimeSettings): Promise<void> =>
  reviewTimeItem.setValue(normalizeReviewTime(settings));

export const reviewRunItem = storage.defineItem<ReviewRun | null>("local:reviewRun", { fallback: null });

export const pullFilesItem = storage.defineItem<Record<string, FilesRecord>>("local:pullFiles", { fallback: {} });

export const pullBranchesItem = storage.defineItem<Record<string, BranchesRecord>>("local:pullBranches", {
  fallback: {},
});

export const learnedItem = storage.defineItem<Learned | null>("local:learnedPace", { fallback: null });

export const heldItem = storage.defineItem<HeldEvent[]>("local:heldNotifications", { fallback: [] });

export const reviewSkipItem = storage.defineItem<number>("local:reviewSkipUntil", { fallback: 0 });

export const queueHistoryItem = storage.defineItem<QueueHistory>("local:reviewQueueHistory", { fallback: {} });
