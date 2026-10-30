import type { SoundId } from "@/utils/sound/sound";

export const COMMANDS = [
  "next-filter",
  "previous-filter",
  "show-all",
  "next-unviewed",
  "next-comment",
  "previous-comment",
] as const;
type Command = (typeof COMMANDS)[number];

export type Message =
  | { type: "open-options"; repo?: string | null | undefined; section?: string | undefined }
  | { type: "open-welcome" }
  | { type: "command"; command: Command }
  | { type: "inbox-refresh" }
  | { type: "review-start-now"; minutes: number; session: string }
  | { type: "review-start" | "review-snooze" | "review-skip" | "review-end" }
  | { type: "review-open"; url: string; repo: string }
  | { type: "play-sound"; sound: SoundId; volume: number }
  | { type: "show-options"; repo?: string | null | undefined; section?: string | undefined };

const PULL_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/u;

export const isPullUrl = (url: unknown): url is string => typeof url === "string" && PULL_URL.test(url);
