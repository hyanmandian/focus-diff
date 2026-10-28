import type { Provider, ThreadSummary } from "@/utils/provider/provider";
import type { FileList, ReviewFile } from "@/utils/review/review";

export interface FileInfo extends ReviewFile {
  anchor: string;
  diff: { element: HTMLElement; container: HTMLElement } | null;
  threads: ThreadSummary[];
}

export type Files = FileList<FileInfo>;

const viewedByPath = new Map<string, boolean>();
let viewedPathname = "";

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
    stats: diff.stats(),
    viewed: viewedByPath.get(diff.path) ?? false,
    diff: { element: diff.element, container: diff.container },
    threads: [],
  }));
  return { list, complete: false };
};
