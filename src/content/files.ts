import type { FileList, ReviewFile } from '@/content/review';
import type { Provider, ThreadSummary } from '@/providers/provider';

export interface FileInfo extends ReviewFile {
  /** How the site points to the file, for its links and its tree; empty when unknown. */
  anchor: string;
  /** The drawn diff, when the site has it on the page. */
  diff: { element: HTMLElement; container: HTMLElement } | null;
  /** Conversations known before the file is drawn, from the site's data. */
  threads: ThreadSummary[];
}

export type Files = FileList<FileInfo>;

const viewedByPath = new Map<string, boolean>();
let viewedPathname = '';

/**
 * Every changed file the page knows about. A site's embedded data lists them all, with exact line counts; otherwise
 * there's only what it drew. Viewed toggles seen on the page win over the data, which is fixed when the page loads.
 */
export const collectFiles = (provider: Provider): Files => {
  if (viewedPathname !== location.pathname) {
    viewedByPath.clear();
    viewedPathname = location.pathname;
  }
  const rendered = new Map(
    provider.diffs().map((diff) => {
      const viewed = diff.viewed();
      if (viewed !== null) viewedByPath.set(diff.path, viewed);
      return [diff.path, diff] as const;
    }),
  );
  const summary = provider.summary();
  if (summary) {
    const list = summary.map((file) => {
      const diff = rendered.get(file.path);
      return {
        path: file.path,
        anchor: file.anchor,
        stats: { additions: file.additions, deletions: file.deletions },
        viewed: viewedByPath.get(file.path) ?? file.viewed,
        diff: diff ? { element: diff.element, container: diff.container } : null,
        threads: file.threads,
      };
    });
    return { list, complete: true };
  }
  const list = [...rendered.values()].map((diff) => ({
    path: diff.path,
    anchor: diff.anchor,
    // Only drawn diffs need their line counts read from the page; the data already has them.
    stats: diff.stats(),
    viewed: viewedByPath.get(diff.path) ?? false,
    diff: { element: diff.element, container: diff.container },
    threads: [],
  }));
  return { list, complete: false };
};
