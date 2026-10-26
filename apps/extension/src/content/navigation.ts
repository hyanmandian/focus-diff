import { i18n } from '#i18n';
import type { Conversation } from '@/components/conversations/conversations';
import type { Panel } from '@/components/panel/panel';
import type { FileInfo } from '@/content/files';
import { stepFrom } from '@/content/review';
import { flash, scrollToCenter, scrollToTop, waitFor } from '@/content/scroll';
import type { ConversationTarget, Provider } from '@/providers/provider';

/** Brings a file to the top of the screen. Files the site hasn't drawn are opened through the site first. */
export const goToFile = async (provider: Provider, file: FileInfo): Promise<HTMLElement | null> => {
  if (file.diff?.element.isConnected) {
    scrollToTop(file.diff.container, () => provider.coveredTop());
    return file.diff.element;
  }
  if (!file.anchor) return null;
  provider.reveal(file.anchor);
  return waitFor(() => provider.diffAt(file.anchor));
};

export const createNavigation = (provider: Provider, panel: Panel, schedule: () => void) => {
  /** 1-based position of the conversation the reader last jumped to, 0 before any jump. */
  let commentIndex = 0;
  /** Bumped by every jump, so one still waiting on the site gives way to a newer one instead of landing late. */
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
    panel.announceText(i18n.t('panelJumpedToComment', [String(commentIndex), String(targets.length), target.file.path]));
    schedule();
  };

  /**
   * Before the first jump, starts from the top (or the end). Conversations from the site's data go in order; ones read
   * from the page go from the middle of the screen.
   */
  const step = (shown: FileInfo[], complete: boolean, direction: 1 | -1) => {
    const targets = provider.conversations(shown, complete);
    if (!targets.length) return;
    if (complete) return goTo(targets, stepFrom(commentIndex, direction, targets.length));
    const middle = innerHeight / 2;
    const centre = ({ element }: ConversationTarget) => {
      const box = element?.getBoundingClientRect();
      return box ? box.top + box.height / 2 : 0;
    };
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
    /** How many conversations a set of files has, for sizing the count. */
    count: (list: FileInfo[], complete: boolean) => provider.conversations(list, complete).length,
    /** A new selection: back to before the first jump, and any jump still waiting on the site gives way. */
    reset: () => {
      commentIndex = 0;
      jump++;
    },
  };
};
