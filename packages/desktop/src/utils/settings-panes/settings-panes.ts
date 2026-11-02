import { CircleUserRound, Inbox, ListFilter, ScanSearch, Settings as SettingsIcon, Timer, Zap } from "lucide-react";

export type PaneId = "queues" | "review" | "filters" | "actions" | "ai" | "account" | "general";

export const PANE_META: Record<PaneId, { icon: typeof Inbox; tile: string }> = {
  account: { icon: CircleUserRound, tile: "gray" },
  queues: { icon: Inbox, tile: "blue" },
  review: { icon: Timer, tile: "green" },
  filters: { icon: ListFilter, tile: "indigo" },
  actions: { icon: Zap, tile: "orange" },
  ai: { icon: ScanSearch, tile: "purple" },
  general: { icon: SettingsIcon, tile: "gray" },
};
