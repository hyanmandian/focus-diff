import { i18n } from '#i18n';
import type { Conversation } from '@/components/conversations/conversations';
import type { Panel } from '@/components/panel/panel';
import * as page from '@/utils/github';
import type { FileInfo } from '@/content/files';

const RENDER_TIMEOUT_MS = 2000;
const EXPAND_TIMEOUT_MS = 1500;

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
  if (!file.digest) return null;
  // With its folder collapsed or the tree closed, the file's anchor still takes GitHub there.
  const link = page.treeLink(file.digest);
  if (link) link.click();
  else location.hash = `diff-${file.digest}`;
  return waitFor(() => page.diffByDigest(file.digest));
};

export const createNavigation = (panel: Panel, schedule: () => void) => {
  /** 1-based position of the conversation the reader last jumped to, 0 before any jump. */
  let commentIndex = 0;
  /** Bumped by every jump, so one still waiting on GitHub gives way to a newer one instead of landing late. */
  let jump = 0;

  /**
   * Newer view: conversations from GitHub's data, in file order then line order, kept current with the ones open on the
   * page: a new conversation joins them, a deleted one leaves, and a reply of the reader's marks one as answered.
   */
  const knownThreads = (shown: FileInfo[]) =>
    shown.flatMap((file) => {
      const diff = file.diff?.element;
      const open = diff ? page.openThreads(diff) : [];
      const openIds = new Set(open.map((thread) => thread.id));
      const kept = diff ? file.threads.filter((thread) => openIds.has(thread.id) || !page.threadRemoved(diff, thread.line)) : file.threads;
      if (!open.length) return kept.map((thread) => ({ file, thread }));
      const answered = new Set(open.filter((thread) => thread.state === 'answered').map((thread) => thread.id));
      const known = new Set(file.threads.map((thread) => thread.id));
      return [
        ...kept.map((thread) =>
          thread.state === 'waiting' && answered.has(thread.id) ? { ...thread, state: 'answered' as const } : thread,
        ),
        ...open.filter((thread) => !known.has(thread.id)),
      ]
        .toSorted((a, b) => (Number(a.line.slice(1)) || 0) - (Number(b.line.slice(1)) || 0))
        .map((thread) => ({ file, thread }));
    });

  /** Classic view: the conversations GitHub rendered, with their file. */
  const renderedThreads = (shown: FileInfo[]) =>
    shown.flatMap((file) => (file.diff ? page.threads(file.diff.element).map((thread) => ({ file, thread })) : []));

  const conversations = (shown: FileInfo[], complete: boolean): Conversation[] =>
    complete
      ? knownThreads(shown).map(({ file, thread }) => ({
          path: file.path,
          line: Number(thread.line.slice(1)) || null,
          state: thread.state,
        }))
      : renderedThreads(shown).map(({ file, thread }) => ({ path: file.path, line: thread.line, state: thread.state }));

  const announce = (total: number, path: string) => {
    panel.announceText(i18n.t('panelJumpedToComment', [String(commentIndex), String(total), path]));
    schedule();
  };

  /** The open, expanded conversation for a thread, once GitHub has rendered its comments. */
  const openThread = (id: string) => {
    const thread = page.threadById(id);
    return thread && page.threadComments(thread).length ? thread : null;
  };

  /**
   * Newer view: GitHub's own comment link opens the thread, resolved or not, wherever it is in the diff. Replacing the
   * hash keeps these jumps out of the reader's history. Without it, the file is opened and its marker centred.
   */
  const goToKnown = async (shown: FileInfo[], index: number) => {
    const threads = knownThreads(shown);
    const target = threads[index];
    if (!target) return;
    commentIndex = index + 1;
    const mine = ++jump;
    const { thread, file } = target;
    let found: HTMLElement | null = null;
    if (thread.comment) {
      history.replaceState(history.state, '', `#r${thread.comment}`);
      dispatchEvent(new HashChangeEvent('hashchange'));
      found = await waitFor(() => openThread(thread.id), EXPAND_TIMEOUT_MS);
      if (mine !== jump) return;
    }
    if (!found) {
      const element = await goToFile(file);
      if (mine !== jump) return;
      const lines = [...new Set(file.threads.map(({ line }) => line))];
      found = element ? ((await waitFor(() => page.commentIndicators(element)[lines.indexOf(thread.line)] ?? null, 600)) ?? element) : null;
      if (mine !== jump) return;
    }
    if (found) {
      page.scrollToCenter(found);
      page.flash(found);
    }
    announce(threads.length, file.path);
  };

  /** Classic view: every conversation is already on the page; collapsed ones are opened so they can be read. */
  const goToRendered = async (shown: FileInfo[], index: number) => {
    const threads = renderedThreads(shown);
    const target = threads[index];
    if (!target) return;
    commentIndex = index + 1;
    const mine = ++jump;
    const { element } = target.thread;
    const toggle = page.collapsedThreadToggle(element);
    if (toggle) {
      toggle.click();
      // GitHub loads a resolved thread's comments on demand; centre it once they're in.
      await waitFor(() => (page.threadComments(element).length ? element : null), EXPAND_TIMEOUT_MS);
      if (mine !== jump) return;
    }
    page.scrollToCenter(element);
    page.flash(target.thread.element);
    announce(threads.length, target.file.path);
  };

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
    const centre = ({ thread }: { thread: page.Thread }) => {
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
    comment: step,
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
