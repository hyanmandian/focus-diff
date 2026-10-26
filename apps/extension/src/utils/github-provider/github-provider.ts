import { conversations } from "@/utils/github-conversations/github-conversations";
import * as page from "@/utils/github-page/github-page";
import type { Provider } from "@/utils/provider/provider";

/** GitHub's counters use English number formatting whatever the browser language. */
const formatCount = new Intl.NumberFormat("en-US").format;

export const github: Provider = {
  id: "github",
  matches: ["https://github.com/*"],
  repository: page.repository,
  diffs: page.diffs,
  summary: () => page.pullRequestData()?.files ?? null,
  containsDiff: page.containsDiff,
  // The newer view's Viewed toggle flips aria-pressed; the classic view's checkbox fires `change`, which is always watched.
  observedAttributes: ["aria-pressed"],
  isVirtualized: page.isVirtualized,
  closeUp: page.closeUp,
  reportedFileCount: page.reportedFileCount,
  counters: page.pageCounters,
  formatCount,
  tree: { files: page.treeFiles, folders: page.treeFolders, pathOf: page.treePathOf, anchorAt: page.treeAnchorAt },
  diffAt: page.diffAt,
  hashOf: (anchor) => `#diff-${anchor}`,
  reveal: page.reveal,
  coveredTop: page.coveredTop,
  conversations,
};
