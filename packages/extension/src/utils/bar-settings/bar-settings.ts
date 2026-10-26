// What the bar on github.com reads of the app's setup, from the browser's storage as the background keeps it
// (utils/app-files): the filters, the theme and the language from the setup (config.json's text), the review pace
// learned from the files marked viewed (pace.json's), and which filters are chosen in each repository.

import { normalize, type Config } from "@focus-diff/app/utils/config";
import { learnFile, normalizeLearned, type Learned } from "@focus-diff/core/estimate";

import { storage } from "#imports";

/** The chosen filters, by repository; none is All. */
export type Selections = Record<string, string[]>;

/** Before filters could be combined, "all" was a filter of its own. */
const ALL = "all";

export const selectionsItem = storage.defineItem<Selections>("local:active", {
  fallback: {},
  version: 2,
  // WXT migrates only a value that's stored, never a missing one.
  migrations: {
    2: (previous: Record<string, string | string[]>): Selections =>
      Object.fromEntries(
        Object.entries(previous).map(([repo, ids]) => [repo, [ids].flat().filter((id) => id && id !== ALL)]),
      ),
  },
});

/** The setup and the pace, as the text the desktop keeps in its files. */
const configItem = storage.defineItem<string | null>("local:file.config", { fallback: null });
const paceItem = storage.defineItem<string | null>("local:file.pace", { fallback: null });

const parsed = (text: string | null): unknown => {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
};

/** The setup from its text, as the app reads it: the defaults for what's missing or doesn't read. */
export const readConfig = (text: string | null): Config => normalize(parsed(text));

export const loadConfig = async (): Promise<Config> => readConfig(await configItem.getValue());

/** Calls `changed` with the setup each time it's saved. */
export const watchConfig = (changed: (config: Config) => void) =>
  configItem.watch((text) => {
    changed(readConfig(text));
  });

export const readLearned = (text: string | null): Learned => normalizeLearned(parsed(text));

export const loadLearned = async (): Promise<Learned> => readLearned(await paceItem.getValue());

export const watchLearned = (changed: (learned: Learned) => void) =>
  paceItem.watch((text) => {
    changed(readLearned(text));
  });

/** Learns from files just reviewed, on top of what's kept (the review window, or another tab, may have learned
 *  something since), and keeps it. */
export const learn = async (samples: Array<{ path: string; expected: number; actual: number }>): Promise<Learned> => {
  let latest = await loadLearned();
  for (const sample of samples) latest = learnFile(latest, sample.path, sample.expected, sample.actual);
  await paceItem.setValue(JSON.stringify(latest));
  return latest;
};
