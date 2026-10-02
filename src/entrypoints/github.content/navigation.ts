import { i18n } from '#i18n';
import type { Panel } from '@/components/panel';
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

  const conversationCount = (shown: FileInfo[], complete: boolean): number =>
    complete ? knownThreads(shown).length : page.threads(shown.flatMap((file) => (file.diff ? [file.diff.element] : []))).length;

  /** Newer view: step through the threads GitHub listed, opening each file and centring the thread's marker. */
  const stepKnown = async (shown: FileInfo[], step: 1 | -1) => {
    const threads = knownThreads(shown);
    if (!threads.length) return;
    commentIndex = commentIndex === 0 ? (step > 0 ? 1 : threads.length) : ((commentIndex - 1 + step + threads.length) % threads.length) + 1;
    const target = threads[commentIndex - 1];
    if (!target) return;
    const element = await goToFile(target.file);
    const lines = [...new Set(target.file.threads.map((thread) => thread.line))];
    const marker = element
      ? ((await waitFor(() => page.commentIndicators(element)[lines.indexOf(target.thread.line)] ?? null, 600)) ?? element)
      : null;
    if (marker) {
      page.scrollToCenter(marker);
      page.flash(marker);
    }
    panel.announceText(i18n.t('panelJumpedToComment', [String(commentIndex), String(threads.length), target.file.path]));
    schedule();
  };

  /** Classic view: step to the next conversation below the middle of the screen, or the previous one above it. */
  const stepRendered = (shown: FileInfo[], step: 1 | -1) => {
    const conversations = page.threads(shown.flatMap((file) => (file.diff ? [file.diff.element] : [])));
    if (!conversations.length) return;
    const middle = innerHeight / 2;
    const centre = (thread: page.Thread) => {
      const box = thread.element.getBoundingClientRect();
      return box.top + box.height / 2;
    };
    const index =
      commentIndex === 0 && scrollY < 10
        ? step > 0
          ? 0
          : conversations.length - 1
        : step > 0
          ? conversations.findIndex((thread) => centre(thread) > middle + 1)
          : conversations.findLastIndex((thread) => centre(thread) < middle - 1);
    const position = index === -1 ? (step > 0 ? 0 : conversations.length - 1) : index;
    const target = conversations[position];
    if (!target) return;
    commentIndex = position + 1;
    page.scrollToCenter(target.element);
    page.flash(target.element);
    const file = shown.find((item) => item.diff?.element.contains(target.element))?.path ?? '';
    panel.announceText(i18n.t('panelJumpedToComment', [String(commentIndex), String(conversations.length), file]));
    schedule();
  };

  return {
    nextUnviewed,
    comment: (shown: FileInfo[], complete: boolean, step: 1 | -1) => (complete ? stepKnown(shown, step) : stepRendered(shown, step)),
    position: (shown: FileInfo[], complete: boolean) => {
      const total = conversationCount(shown, complete);
      if (commentIndex > total) commentIndex = 0;
      return { current: commentIndex, total };
    },
    reset: () => {
      commentIndex = 0;
    },
  };
};
