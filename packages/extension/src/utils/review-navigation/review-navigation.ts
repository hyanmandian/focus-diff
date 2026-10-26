import type { Provider } from "@/utils/provider/provider";
import type { FileInfo } from "@/utils/review-files/review-files";
import { scrollToTop, waitFor } from "@/utils/scroll/scroll";

/** Brings a file to the top of the screen. Files the site hasn't drawn are opened through the site first. */
export const goToFile = (provider: Provider, file: FileInfo): Promise<HTMLElement | null> => {
  if (file.diff?.element.isConnected) {
    scrollToTop(file.diff.container, () => provider.coveredTop());
    return Promise.resolve(file.diff.element);
  }
  if (!file.anchor) return Promise.resolve(null);
  provider.reveal(file.anchor);
  return waitFor(() => provider.diffAt(file.anchor));
};
