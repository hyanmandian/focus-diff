// The words for what happens on a pull request: short tags on cards, full sentences in tooltips
// (the notifications say it in Rust, watch.rs). Their text is in src/locales (events.*); here is
// what isn't words: each one's colour.

import type { EventKind } from "@/utils/config/config";
import type { Actor, Item } from "@/utils/engine/engine";
import type { T } from "@/utils/i18n/i18n";

/** Someone by their first name, as people say it; their login without one. */
export const firstName = (actor: Actor, t: T) =>
  [actor?.name?.trim().split(/\s+/u)[0], actor?.login].find(Boolean) ?? t("common.someone");

/** Each event's colour: t(`events.tag.${kind}`) is its tag, t(`events.long.${kind}`) its tooltip,
 *  t(`events.label.${kind}`) its name among a queue's notifications. */
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

/** Where you stand on a pull request: t(`events.status.${status}`) is its tag,
 *  t(`events.statusLong.${status}`) its tooltip. */
export const STATUS_TONES: Record<NonNullable<Item["status"]>, string> = {
  APPROVED: "green",
  CHANGES_REQUESTED: "red",
  COMMENTED: "gray",
  MENTIONED: "blue",
};

/** "30 seconds", "3 minutes": a refresh interval. */
export const interval = (seconds: number, t: T) =>
  seconds < 120 ? t("common.seconds", { count: seconds }) : t("common.minutes", { count: seconds / 60 });
