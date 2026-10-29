import { i18n } from "#i18n";
import type { Conversation } from "@/components/conversations/conversations";
import type { Panel } from "@/components/panel/panel";
import type { ConversationTarget, Provider } from "@/utils/provider/provider";
import type { FileInfo } from "@/utils/review-files/review-files";
import { stepFrom } from "@/utils/review/review";
import { flash, scrollToCenter, scrollToTop, waitFor } from "@/utils/scroll/scroll";

export const goToFile = (provider: Provider, file: FileInfo): Promise<HTMLElement | null> => {
  if (file.diff?.element.isConnected) {
    scrollToTop(file.diff.container, () => provider.coveredTop());
    return Promise.resolve(file.diff.element);
  }
  if (!file.anchor) return Promise.resolve(null);
  provider.reveal(file.anchor);
  return waitFor(() => provider.diffAt(file.anchor));
};

const centre = ({ element }: ConversationTarget) => {
  const box = element?.getBoundingClientRect();
  return box ? box.top + box.height / 2 : 0;
};

export const createNavigation = (provider: Provider, panel: Panel, schedule: () => void) => {
  let commentIndex = 0;
  let jump = 0;

  const conversations = (shown: FileInfo[], complete: boolean): Conversation[] =>
    provider.conversations(shown, complete).map(({ file, line, state }) => ({ path: file.path, line, state }));

  const goTo = async (targets: ConversationTarget[], index: number) => {
    const target = targets[index];
    if (!target) return;
    commentIndex = index + 1;
    const mine = ++jump;
    const stale = () => mine !== jump;
    const found = await target.open({ goToFile: (file) => goToFile(provider, file), stale });
    if (stale()) return;
    if (found) {
      scrollToCenter(found, () => provider.coveredTop(found));
      flash(found, panel.accent());
    }
    panel.announceText(
      i18n.t("panelJumpedToComment", [String(commentIndex), String(targets.length), target.file.path]),
    );
    schedule();
  };

  const step = (shown: FileInfo[], complete: boolean, direction: 1 | -1) => {
    const targets = provider.conversations(shown, complete);
    if (complete) return goTo(targets, stepFrom(commentIndex, direction, targets.length));
    const middle = innerHeight / 2;
    const index =
      commentIndex === 0 && scrollY < 10
        ? direction > 0
          ? 0
          : targets.length - 1
        : direction > 0
          ? targets.findIndex((target) => centre(target) > middle + 1)
          : targets.findLastIndex((target) => centre(target) < middle - 1);
    return goTo(targets, index === -1 ? (direction > 0 ? 0 : targets.length - 1) : index);
  };

  return {
    comment: step,
    position: (shown: FileInfo[], complete: boolean) => {
      const list = conversations(shown, complete);
      if (commentIndex > list.length) commentIndex = 0;
      return { current: commentIndex, list };
    },
    count: (list: FileInfo[], complete: boolean) => provider.conversations(list, complete).length,
    reset: () => {
      commentIndex = 0;
      jump++;
    },
  };
};
