import type { Totals } from '@/components/panel';
import type { Matcher } from '@/utils/filters';
import * as page from '@/utils/github';
import type { FileStats } from '@/utils/github';
import { pullRequestData, type ThreadSummary } from '@/utils/github-data';
import { reviewMinutes } from '@/utils/review-time';

export interface FileInfo {
  path: string;
  /** Used for `#diff-<digest>` anchors; empty when unknown. */
  digest: string;
  stats: FileStats | null;
  viewed: boolean;
  /** The rendered diff, when GitHub has it in the page. */
  diff: { element: HTMLElement; container: HTMLElement } | null;
  /** Review threads, known up front only in the newer diff view. */
  threads: ThreadSummary[];
}

export interface Files {
  list: FileInfo[];
  /** True when the list covers every changed file, not only the rendered ones. */
  complete: boolean;
}

const viewedByPath = new Map<string, boolean>();
let viewedPathname = '';

/**
 * Every changed file the page knows about. GitHub's embedded data lists them all, with exact line counts; the classic
 * view only has what it rendered. Viewed toggles seen in the page win over the embedded data, which is fixed at load.
 */
export const collectFiles = (): Files => {
  if (viewedPathname !== location.pathname) {
    viewedByPath.clear();
    viewedPathname = location.pathname;
  }
  const rendered = new Map(
    page.diffs().map((diff) => {
      const viewed = page.viewed(diff);
      if (viewed !== null) viewedByPath.set(diff.path, viewed);
      return [diff.path, { element: diff.element as HTMLElement, container: diff.container, stats: diff.stats }] as const;
    }),
  );
  const data = pullRequestData();
  if (data) {
    const list = data.files.map((file) => ({
      path: file.path,
      digest: file.digest,
      stats: { additions: file.additions, deletions: file.deletions },
      viewed: viewedByPath.get(file.path) ?? file.viewed,
      diff: rendered.get(file.path) ?? null,
      threads: file.threads,
    }));
    return { list, complete: true };
  }
  const list = [...rendered].map(([path, diff]) => ({
    path,
    digest: diff.element.id.startsWith('diff-') ? diff.element.id.slice('diff-'.length) : '',
    // Only the classic view reads line counts from the page; the embedded data already has them.
    stats: diff.stats(),
    viewed: viewedByPath.get(path) ?? false,
    diff: { element: diff.element, container: diff.container },
    threads: [],
  }));
  return { list, complete: false };
};

export const everything: Matcher = () => true;

export const totalsFor = ({ list, complete }: Files, matches: Matcher, reported: number): Totals => {
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
  if (matches === everything && !complete) {
    const unrendered = total - list.length;
    totals.pending += unrendered;
    totals.visible = total;
    totals.minutes += unrendered * reviewMinutes('', null);
    totals.minutesLeft += unrendered * reviewMinutes('', null);
  }
  return totals;
};
