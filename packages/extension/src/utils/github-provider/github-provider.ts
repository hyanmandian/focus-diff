import { conversations } from "@/utils/github-conversations/github-conversations";
import {
  closeUp,
  containsDiff,
  coveredTop,
  diffAt,
  diffs,
  isVirtualized,
  pageCounters,
  pullRequestData,
  reportedFileCount,
  repository,
  reveal,
  treeAnchorAt,
  treeFiles,
  treeFolders,
  treePathOf,
} from "@/utils/github-page/github-page";
import type { Provider } from "@/utils/provider/provider";

/** GitHub's counters use English number formatting whatever the browser language. */
const counterFormat = new Intl.NumberFormat("en-US");
const formatCount = (value: number) => counterFormat.format(value);

export const github: Provider = {
  id: "github",
  matches: ["https://github.com/*"],
  repository: repository,
  diffs: diffs,
  summary: () => pullRequestData()?.files ?? null,
  containsDiff: containsDiff,
  // The newer view's Viewed toggle flips aria-pressed; the classic view's checkbox fires `change`, which is always watched.
  observedAttributes: ["aria-pressed"],
  isVirtualized: isVirtualized,
  closeUp: closeUp,
  reportedFileCount: reportedFileCount,
  counters: pageCounters,
  formatCount,
  tree: { files: treeFiles, folders: treeFolders, pathOf: treePathOf, anchorAt: treeAnchorAt },
  diffAt: diffAt,
  hashOf: (anchor) => `#diff-${anchor}`,
  reveal: reveal,
  coveredTop: coveredTop,
  conversations,
};
