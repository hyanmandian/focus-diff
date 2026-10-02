import type { AIErrorCode } from '@/utils/ai';

export type Command = 'next-filter' | 'previous-filter' | 'show-all';

export type Message =
  | { type: 'open-options'; repo?: string | null; section?: 'ai' }
  | { type: 'open-welcome' }
  | { type: 'command'; command: Command };

/** Name of the long-lived port the content script opens to prepare and write guides. */
export const GUIDE_PORT = 'guide';

export interface PullRequestRef {
  repo: string;
  number: number;
}

export type GuideRequest =
  | ({ type: 'prepare' } & PullRequestRef)
  | ({ type: 'generate'; title: string; description: string; locale: string; otherTitle: string } & PullRequestRef);

export type GuidePhase = 'reading' | 'thinking' | 'writing';

export type GuideResponse =
  | { type: 'setup' }
  | { type: 'prepared'; hash: string; files: number; tokens: number; host: string; model: string }
  | { type: 'progress'; phase: GuidePhase; characters?: number }
  | { type: 'done' }
  | { type: 'error'; code: AIErrorCode | 'unknown'; detail: string };
