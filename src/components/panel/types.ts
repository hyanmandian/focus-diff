import type { ThreadState } from '@/utils/github';

export interface Totals {
  visible: number;
  total: number;
  additions: number;
  deletions: number;
  pending: number;
  /** Estimated review time, see utils/review-time.ts. */
  minutes: number;
  /** Files marked as viewed on GitHub, and the estimate for the rest. */
  viewed: number;
  minutesLeft: number;
}

export interface PanelOption {
  id: string;
  name: string;
  /** Files this option shows. */
  count?: number;
}

export interface BreakdownRow extends PanelOption, Totals {}

export interface Conversation {
  path: string;
  /** Line in the new version of the file, when known. */
  line: number | null;
  state: ThreadState;
}

export interface Conversations {
  list: Conversation[];
  /** The one the reader last jumped to, 1-based; 0 before the first jump. */
  current: number;
}

/** What every part of the panel shares: where it's mounted, when it's torn down, and what has focus inside it. */
export interface PanelContext {
  host: HTMLElement;
  signal: AbortSignal;
  focused: () => HTMLElement | null;
}
