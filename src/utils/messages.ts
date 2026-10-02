export type Command = 'next-filter' | 'previous-filter' | 'show-all' | 'next-comment' | 'previous-comment';

export type Message =
  | { type: 'open-options'; repo?: string | null }
  | { type: 'open-welcome' }
  | { type: 'command'; command: Command }
  /** Sent to an open settings page, which brings itself forward and answers `true`. */
  | { type: 'show-options'; repo?: string | null };
