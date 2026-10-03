import * as page from '@/utils/github/github';
import type { FileList, ReviewFile } from '@/content/review';

export interface FileInfo extends ReviewFile {
  /** Used for `#diff-<digest>` anchors; empty when unknown. */
  digest: string;
  /** The rendered diff, when GitHub has it in the page. */
  diff: { element: HTMLElement; container: HTMLElement } | null;
  /** Review threads, known up front only in the newer diff view. */
  threads: page.ThreadSummary[];
}

export type Files = FileList<FileInfo>;

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
  const data = page.pullRequestData();
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
