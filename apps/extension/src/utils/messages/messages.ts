import type { SoundId } from "@/utils/sound/sound";

export type Command =
  | "next-filter"
  | "previous-filter"
  | "show-all"
  | "next-unviewed"
  | "next-comment"
  | "previous-comment";

export type Message =
  | { type: "open-options"; repo?: string | null; section?: string }
  | { type: "open-welcome" }
  | { type: "command"; command: Command }
  /** From the popup: read GitHub now. Answered once the lists in storage are up to date. */
  | { type: "inbox-refresh" }
  /** From the popup: start a review time now, of `minutes`, like the session `session` or with the defaults. */
  | { type: "review-start-now"; minutes: number; session: string }
  /** From the popup: start the review time offered, put it off a few minutes, skip it, or end the one under way. */
  | { type: "review-start" | "review-snooze" | "review-skip" | "review-end" }
  /** From the popup: open a pull request of the review time under way, with its filters on in the bar. */
  | { type: "review-open"; url: string; repo: string }
  /** To the offscreen document, which plays it: the service worker has no audio. */
  | { type: "play-sound"; sound: SoundId; volume: number }
  /** Sent to an open settings page, which brings itself forward and answers `true`. */
  | { type: "show-options"; repo?: string | null; section?: string };
