import { i18n } from '#i18n';
import type { BreakdownRow } from '@/components/breakdown/breakdown';
import type { PanelOption } from '@/components/filters/filters';
import type { NextFile } from '@/components/next-file/next-file';
import type { Panel } from '@/components/panel/panel';
import { isDone, type Totals } from '@/components/stats/stats';
import { ALL, type Matcher } from '@/utils/filters/filters';
import type { FileStats } from '@/providers/provider';
import { reviewMinutes } from '@/utils/review-time/review-time';

/**
 * What the bar shows for a pull request and a selection of filters, worked out from the files alone. The content script
 * feeds it a review site's page; the welcome page feeds it a sample pull request, so both show the same bar.
 */

/** A button in the bar: All, or a filter with the paths it matches. */
export interface Option {
  id: string;
  name: string;
  matches?: Matcher;
}

/** What the numbers need of a changed file. */
export interface ReviewFile {
  path: string;
  stats: FileStats | null;
  viewed: boolean;
}

export interface FileList<T extends ReviewFile = ReviewFile> {
  list: T[];
  /** True when the list covers every changed file, not only the rendered ones. */
  complete: boolean;
}

const everything: Matcher = () => true;

const totalsFor = ({ list, complete }: FileList, matches: Matcher, reported: number): Totals => {
  const total = complete ? list.length : Math.max(list.length, reported);
  const totals = { visible: 0, total, additions: 0, deletions: 0, pending: 0, minutes: 0, viewed: 0, minutesLeft: 0 };
  for (const file of list) {
    if (!matches(file.path)) continue;
    totals.visible++;
    if (!file.stats) totals.pending++;
    totals.additions += file.stats?.additions ?? 0;
    totals.deletions += file.stats?.deletions ?? 0;
    const minutes = reviewMinutes(file.path, file.stats);
    totals.minutes += minutes;
    if (file.viewed) totals.viewed++;
    else totals.minutesLeft += minutes;
  }
  if (complete) return totals;
  // Files the site hasn't loaded yet might match too, so with a filter the totals are partial: never Done.
  const unrendered = total - list.length;
  totals.pending += unrendered;
  if (matches === everything) {
    totals.visible = total;
    totals.minutes += unrendered * reviewMinutes('', null);
    totals.minutesLeft += unrendered * reviewMinutes('', null);
  }
  return totals;
};

/** The selection after a button is pressed: All clears it, a filter joins it or leaves it. */
export const toggled = (ids: string[], id: string): string[] =>
  id === ALL ? [] : ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id];

/** The 0-based index one step from `position`, 1-based with 0 for none yet, among `total`, wrapping around. */
export const stepFrom = (position: number, direction: 1 | -1, total: number): number =>
  position === 0 ? (direction > 0 ? 0 : total - 1) : (position - 1 + direction + total) % total;

/** The next filter in the bar, after the ones shown, that still has files to review. */
export const nextFilterWithWork = (list: ReviewFile[], filters: Option[], ids: string[]) => {
  const last = Math.max(-1, ...ids.map((id) => filters.findIndex((filter) => filter.id === id)));
  for (let offset = 1; offset <= filters.length; offset++) {
    const filter = filters[(last + offset) % filters.length];
    if (!filter || ids.includes(filter.id)) continue;
    const left = list.filter((file) => !file.viewed && filter.matches?.(file.path)).length;
    if (left) return { id: filter.id, name: filter.name, left };
  }
  return undefined;
};

export interface Review<T extends ReviewFile = ReviewFile> {
  filtering: boolean;
  matches: Matcher;
  /** The pressed buttons: the chosen filters, or All. */
  selection: string[];
  /** What the bar reads out for the selection, like "Frontend + Docs". */
  name: string;
  shown: T[];
  totals: Totals;
  /** The totals with every file shown, the most the numbers can be. */
  all: Totals;
  options: PanelOption[];
  nextFile: NextFile;
  /** Only worked out while the breakdown is open. */
  rows: () => BreakdownRow[];
}

/** `options` starts with All; `ids` are the chosen filters, `loading` says files may still arrive. */
export const review = <T extends ReviewFile>(
  files: FileList<T>,
  options: Option[],
  ids: string[],
  { reported = 0, loading = false } = {},
): Review<T> => {
  const selected = options.filter((option) => option.id !== ALL && ids.includes(option.id));
  const filtering = selected.length > 0;
  const matches: Matcher = filtering ? (path) => selected.some((option) => option.matches?.(path)) : everything;
  const totals = totalsFor(files, matches, reported);
  const left = totals.visible - totals.viewed;
  const filters = options.filter((option) => option.id !== ALL);
  return {
    filtering,
    matches,
    selection: filtering ? selected.map((option) => option.id) : [ALL],
    name: filtering ? selected.map((option) => option.name).join(' + ') : i18n.t('filterAll'),
    shown: files.list.filter((file) => matches(file.path)),
    totals,
    all: filtering ? totalsFor(files, everything, reported) : totals,
    options: options.map(({ id, name, matches: optionMatches }) => ({
      id,
      name,
      count: optionMatches ? files.list.filter((file) => optionMatches(file.path)).length : totals.total,
      loading,
    })),
    nextFile: { left, nextFilter: filtering && !left ? nextFilterWithWork(files.list, filters, ids) : undefined },
    rows: () =>
      options.map((option) => ({ id: option.id, name: option.name, ...totalsFor(files, option.matches ?? everything, reported) })),
  };
};

/**
 * Shows a review in the bar. A new selection is read out once; a selection whose last file gets marked as viewed is
 * celebrated, once. The conversations are left to the caller, which knows where they are.
 */
export const createReviewView = (panel: Panel) => {
  let unfinished = '';
  return (current: Review, key: string, { announce = false } = {}) => {
    panel.renderOptions(current.options, current.selection);
    panel.renderNextFile(current.nextFile);
    panel.renderStats(current.totals, current.all);
    panel.renderBreakdown(current.rows, current.selection);
    if (announce) panel.announce({ name: current.name, ...current.totals });
    const done = isDone(current.totals);
    if (done && unfinished === key) panel.celebrate(current.name);
    unfinished = done ? '' : key;
  };
};
