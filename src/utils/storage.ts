import { storage } from '#imports';
import type { AISettings } from '@/utils/ai';
import { ALL, normalize, type Config } from '@/utils/filters';
import type { Guide } from '@/utils/guide';

/** Selected filter ids per repository. An empty list means "All". */
export type Selections = Record<string, string[]>;

export const configItem = storage.defineItem<Config>('sync:config', {
  fallback: { global: [], repos: [] },
});

export const selectionsItem = storage.defineItem<Selections>('local:active', {
  fallback: {},
  version: 2,
  migrations: {
    2: (previous: Record<string, string | string[]>): Selections =>
      Object.fromEntries(Object.entries(previous ?? {}).map(([repo, ids]) => [repo, [ids].flat().filter((id) => id && id !== ALL)])),
  },
});

export const loadConfig = async (): Promise<Config> => normalize(await configItem.getValue());

export const saveConfig = (config: Config): Promise<void> => configItem.setValue(normalize(config));

export interface GuideEntry {
  /** SHA-256 of the diff the guide was written for, to tell when the pull request changed. */
  hash: string;
  guide: Guide;
  model: string;
  host: string;
  omitted: number;
  createdAt: number;
  open: boolean;
  chapter: number;
  reviewed: number[];
}

export const MAX_GUIDES = 30;

/** Review guides per pull request (`owner/name#number`). */
export const guidesItem = storage.defineItem<Record<string, GuideEntry>>('local:guides', { fallback: {} });

/** Provider settings, including the API key: local only, never synced. */
export const aiSettingsItem = storage.defineItem<AISettings>('local:ai');

/** Repositories whose diffs may be sent without asking each time. */
export const consentItem = storage.defineItem<Record<string, boolean>>('local:aiConsent', { fallback: {} });
