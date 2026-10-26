// The settings panes: each on a tile in a system color, as System Settings and Raycast draw them, in
// the sidebar and, large, at the top of the pane. Their names and what a search finds in them are in
// settings.pane.* and settings.keywords.*, their one-line subtitles in settings.subtitle.*.

import { CircleUserRound, Inbox, ListFilter, Settings as SettingsIcon, Sparkles, Timer, Zap } from "lucide-react";

export type PaneId = "queues" | "review" | "filters" | "actions" | "ai" | "account" | "general";

export const PANE_META: Record<PaneId, { icon: typeof Inbox; tile: string }> = {
  account: { icon: CircleUserRound, tile: "gray" },
  queues: { icon: Inbox, tile: "blue" },
  review: { icon: Timer, tile: "green" },
  filters: { icon: ListFilter, tile: "indigo" },
  actions: { icon: Zap, tile: "orange" },
  ai: { icon: Sparkles, tile: "purple" },
  general: { icon: SettingsIcon, tile: "gray" },
};
