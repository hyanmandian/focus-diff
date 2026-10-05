import { storage } from '#imports';
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from '@/utils/appearance/appearance';
import { ALL, normalize, type Config } from '@/utils/filters/filters';

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

/** The bar's theme and the reader's CSS for it, synced like the filters. */
export const appearanceItem = storage.defineItem<Appearance>('sync:appearance', { fallback: DEFAULT_APPEARANCE });

export const loadAppearance = async (): Promise<Appearance> => normalizeAppearance(await appearanceItem.getValue());

export const saveAppearance = (appearance: Appearance): Promise<void> => appearanceItem.setValue(normalizeAppearance(appearance));

/** The release whose notes the reader hasn't seen yet, set when the extension updates to a new minor or major version. */
export const updateItem = storage.defineItem<string | null>('local:update', { fallback: null });

export const loadConfig = async (): Promise<Config> => normalize(await configItem.getValue());

export const saveConfig = (config: Config): Promise<void> => configItem.setValue(normalize(config));
