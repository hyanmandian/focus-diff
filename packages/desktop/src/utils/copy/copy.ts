import type { EventKind } from "@/utils/config/config";
import type { Actor, Item } from "@/utils/engine/engine";
import type { T } from "@/utils/i18n/i18n";

export const firstName = (actor: Actor, t: T) =>
  [actor?.name?.trim().split(/\s+/u)[0], actor?.login].find(Boolean) ?? t("common.someone");

export const EVENT_TONES: Record<EventKind, string> = {
  new: "blue",
  commits: "purple",
  reply: "blue",
  mention: "blue",
  comment: "gray",
  rerequest: "amber",
  ready: "blue",
  approved: "green",
  changes: "red",
  "ci-failed": "red",
  "ci-passed": "green",
  conflict: "red",
};

export const STATUS_TONES: Record<NonNullable<Item["status"]>, string> = {
  APPROVED: "green",
  CHANGES_REQUESTED: "red",
  COMMENTED: "gray",
  MENTIONED: "blue",
};

export const POLL_SECONDS = [30, 60, 90, 180, 300, 600];

export const interval = (seconds: number, t: T) =>
  seconds < 120 ? t("common.seconds", { count: seconds }) : t("common.minutes", { count: seconds / 60 });
