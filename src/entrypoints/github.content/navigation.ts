import { i18n } from '#i18n';
import type { Conversation, Panel } from '@/components/panel';
import * as page from '@/utils/github';
import type { FileInfo } from './files';

const RENDER_TIMEOUT_MS = 2000;
const TOP_OF_SCREEN_PX = 110;

const waitFor = <T>(find: () => T | null, timeout = RENDER_TIMEOUT_MS): Promise<T | null> =>
  new Promise((resolve) => {
    const started = performance.now();
    const check = () => {
      const found = find();
      if (found || performance.now() - started > timeout) return resolve(found);
      requestAnimationFrame(check);
    };
    check();
  });

/** Brings a file to the top of the screen. Files GitHub hasn't rendered are opened through the file tree's link. */
const goToFile = async (file: FileInfo): Promise<HTMLElement | null> => {
  if (file.diff?.element.isConnected) {
    page.scrollToTop(file.diff.container);
    return file.diff.element;
  }
  const link = page.treeLink(file.digest);
  if (!link) return null;
  link.click();
  return waitFor(() => page.diffByDigest(file.digest));
};

/** The file at the top of the screen, or -1 before the first one. */
const currentIndex = (files: FileInfo[]): number => {
  if (scrollY < 10) return -1;
  return files.findLastIndex((file) => {
    const box = file.diff?.element.isConnected ? file.diff.container.getBoundingClientRect() : null;
    return box !== null && box.top <= TOP_OF_SCREEN_PX;
  });
};

export const createNavigation = (panel: Panel, schedule: () => void) => {
  /** 1-based position of the conversation the reader last jumped to, 0 before any jump. */
  let commentIndex = 0;

  const nextUnviewed = async (shown: FileInfo[]) => {
    const start = currentIndex(shown);
    const order = [...shown.slice(start + 1), ...shown.slice(0, start + 1)];
    const target = order.find((file) => !file.viewed);
    if (!target) return panel.announceText(i18n.t('panelNoMoreUnviewed'));
    const element = await goToFile(target);
    if (element) page.flash(element);
    const left = shown.filter((file) => !file.viewed).length;
    panel.announceText(i18n.t('panelJumpedToFile', [target.path, String(left)]));
  };

  /** Conversations known from GitHub's data, in file order then line order. */
  const knownThreads = (shown: FileInfo[]) => shown.flatMap((file) => file.threads.map((thread) => ({ file, thread })));

  const renderedThreads = (shown: FileInfo[]) => page.threads(shown.flatMap((file) => (file.diff ? [file.diff.element] : [])));

  const conversations = (shown: FileInfo[], complete: boolean): Conversation[] =>
    complete
      ? knownThreads(shown).map(({ file, thread }) => ({
          path: file.path,
          line: Number(thread.line.slice(1)) || null,
          resolved: thread.resolved,
        }))
      : renderedThreads(shown).map((thread) => ({
          path: shown.find((file) => file.diff?.element.contains(thread.element))?.path ?? '',
          line: null,
          resolved: thread.resolved,
        }));

  const announce = (total: number, path: string) => {
    panel.announceText(i18n.t('panelJumpedToComment', [String(commentIndex), String(total), path]));
    schedule();
  };

  /** Newer view: open the thread's file and centre its marker. */
  const goToKnown = async (shown: FileInfo[], index: number) => {
    const threads = knownThreads(shown);
    const target = threads[index];
    if (!target) return;
    commentIndex = index + 1;
    const element = await goToFile(target.file);
    const lines = [...new Set(target.file.threads.map((thread) => thread.line))];
    const marker = element
      ? ((await waitFor(() => page.commentIndicators(element)[lines.indexOf(target.thread.line)] ?? null, 600)) ?? element)
      : null;
    if (marker) {
      page.scrollToCenter(marker);
      page.flash(marker);
    }
    announce(threads.length, target.file.path);
  };

  /** Classic view: every conversation is already on the page. */
  const goToRendered = (shown: FileInfo[], index: number) => {
    const threads = renderedThreads(shown);
    const target = threads[index];
    if (!target) return;
    commentIndex = index + 1;
    page.scrollToCenter(target.element);
    page.flash(target.element);
    announce(threads.length, shown.find((file) => file.diff?.element.contains(target.element))?.path ?? '');
  };

  const goTo = (shown: FileInfo[], complete: boolean, index: number) => (complete ? goToKnown(shown, index) : goToRendered(shown, index));

  /** Before the first jump, starts from the top (or the end); in the classic view, from the middle of the screen. */
  const step = (shown: FileInfo[], complete: boolean, direction: 1 | -1) => {
    if (complete) {
      const total = knownThreads(shown).length;
      if (!total) return;
      const index = commentIndex === 0 ? (direction > 0 ? 0 : total - 1) : (commentIndex - 1 + direction + total) % total;
      return goToKnown(shown, index);
    }
    const threads = renderedThreads(shown);
    if (!threads.length) return;
    const middle = innerHeight / 2;
    const centre = (thread: page.Thread) => {
      const box = thread.element.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const index =
      commentIndex === 0 && scrollY < 10
        ? direction > 0
          ? 0
          : threads.length - 1
        : direction > 0
          ? threads.findIndex((thread) => centre(thread) > middle + 1)
          : threads.findLastIndex((thread) => centre(thread) < middle - 1);
    return goToRendered(shown, index === -1 ? (direction > 0 ? 0 : threads.length - 1) : index);
  };

  return {
    nextUnviewed,
    comment: step,
    goTo,
    position: (shown: FileInfo[], complete: boolean) => {
      const list = conversations(shown, complete);
      if (commentIndex > list.length) commentIndex = 0;
      return { current: commentIndex, list };
    },
    reset: () => {
      commentIndex = 0;
    },
  };
};
