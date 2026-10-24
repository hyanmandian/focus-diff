// The words for what happens on a pull request: short tags on cards, full sentences in
// notifications and tooltips. One place, so they stay consistent.

import type { EventKind } from "./config";
import type { Actor, Item } from "./engine";

export const firstName = (actor: Actor) => actor?.name?.trim().split(/\s+/)[0] || actor?.login || "Someone";

type Copy = { tag: string; many?: string; long: string; say: (who: string) => string; tone: string };

export const EVENTS: Record<EventKind, Copy> = {
  new: { tag: "New", long: "New in this queue", say: () => "New in your queue", tone: "blue" },
  commits: { tag: "Commits", long: "New commits since you last looked", say: (w) => `${w} pushed changes`, tone: "purple" },
  reply: { tag: "Reply", long: "Someone replied to you", say: (w) => `${w} replied to you`, tone: "blue" },
  mention: { tag: "Mention", long: "You were mentioned", say: (w) => `${w} mentioned you`, tone: "blue" },
  comment: { tag: "Comment", many: "comments", long: "New comments", say: (w) => `${w} commented`, tone: "gray" },
  rerequest: { tag: "Re-review", long: "Your review was requested again", say: () => "Your review was requested again", tone: "amber" },
  approved: { tag: "Approved", long: "Approved", say: (w) => `${w} approved`, tone: "green" },
  changes: { tag: "Changes", long: "Changes requested", say: (w) => `${w} requested changes`, tone: "red" },
  "ci-failed": { tag: "CI failed", long: "CI failed", say: () => "CI failed", tone: "red" },
  "ci-passed": { tag: "CI passed", long: "CI passed", say: () => "CI passed", tone: "green" },
  conflict: { tag: "Conflict", long: "Conflicts with the base branch", say: () => "Merge conflict", tone: "red" },
};

export const EVENT_LABELS: Record<EventKind, string> = {
  new: "Enters the queue",
  commits: "New commits",
  reply: "Replies to you",
  mention: "Mentions you",
  comment: "Comments",
  rerequest: "Review requested again",
  approved: "Approvals",
  changes: "Changes requested",
  "ci-failed": "CI fails",
  "ci-passed": "CI passes again",
  conflict: "Merge conflicts",
};

export const STATUS: Record<NonNullable<Item["status"]>, { tag: string; long: string; tone: string }> = {
  APPROVED: { tag: "Approved", long: "You approved", tone: "green" },
  CHANGES_REQUESTED: { tag: "Changes", long: "You requested changes", tone: "red" },
  COMMENTED: { tag: "Commented", long: "You commented", tone: "gray" },
  MENTIONED: { tag: "Mention", long: "You were mentioned", tone: "blue" },
};

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 30))}mo`;
}
