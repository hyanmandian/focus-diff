import type { FileInfo } from '@/content/files';
import { waitFor } from '@/content/scroll';
import type { ConversationTarget, ThreadSummary } from '@/providers/provider';
import {
  collapsedThreadToggle,
  commentIndicators,
  openThreads,
  threadById,
  threadComments,
  threadRemoved,
  threads,
  type Thread,
} from '@/providers/github/page';

const EXPAND_TIMEOUT_MS = 1500;
const MARKER_TIMEOUT_MS = 600;

const lineOf = (thread: ThreadSummary) => Number(thread.line.slice(1)) || 0;

/** The open, expanded conversation for a thread, once GitHub has rendered its comments. */
const openThread = (id: string) => {
  const thread = threadById(id);
  return thread && threadComments(thread).length ? thread : null;
};

/**
 * Newer view: conversations from GitHub's data, in file order then line order, kept current with the ones open on the
 * page: a new conversation joins them, a deleted one leaves, and a reply of the reader's marks one as answered.
 */
const knownThreads = (files: FileInfo[]) =>
  files.flatMap((file) => {
    const diff = file.diff?.element;
    const open = diff ? openThreads(diff) : [];
    const openIds = new Set(open.map((thread) => thread.id));
    const kept = diff ? file.threads.filter((thread) => openIds.has(thread.id) || !threadRemoved(diff, thread.line)) : file.threads;
    if (!open.length) return kept.map((thread) => ({ file, thread }));
    const answered = new Set(open.filter((thread) => thread.state === 'answered').map((thread) => thread.id));
    const known = new Set(file.threads.map((thread) => thread.id));
    return [
      ...kept.map((thread) => (thread.state === 'waiting' && answered.has(thread.id) ? { ...thread, state: 'answered' as const } : thread)),
      ...open.filter((thread) => !known.has(thread.id)),
    ]
      .toSorted((a, b) => lineOf(a) - lineOf(b))
      .map((thread) => ({ file, thread }));
  });

/**
 * Newer view: GitHub's own comment link opens the thread, resolved or not, wherever it is in the diff. Replacing the
 * hash keeps these jumps out of the reader's history. Without it, the file is opened and its marker found.
 */
const known = (file: FileInfo, thread: ThreadSummary): ConversationTarget => ({
  file,
  line: lineOf(thread) || null,
  state: thread.state,
  element: null,
  open: async ({ goToFile, stale }) => {
    if (thread.comment) {
      history.replaceState(history.state, '', `#r${thread.comment}`);
      dispatchEvent(new HashChangeEvent('hashchange'));
      const found = await waitFor(() => openThread(thread.id), EXPAND_TIMEOUT_MS);
      if (found || stale()) return found;
    }
    const element = await goToFile(file);
    if (!element || stale()) return null;
    const lines = [...new Set(file.threads.map(({ line }) => line))];
    return (await waitFor(() => commentIndicators(element)[lines.indexOf(thread.line)] ?? null, MARKER_TIMEOUT_MS)) ?? element;
  },
});

/** Classic view: every conversation is already on the page; a collapsed one, like a resolved one, is opened first. */
const rendered = (file: FileInfo, thread: Thread): ConversationTarget => ({
  file,
  line: thread.line,
  state: thread.state,
  element: thread.element,
  open: async () => {
    const toggle = collapsedThreadToggle(thread.element);
    if (toggle) {
      toggle.click();
      // GitHub loads a resolved thread's comments on demand; it's ready once they're in.
      await waitFor(() => (threadComments(thread.element).length ? thread.element : null), EXPAND_TIMEOUT_MS);
    }
    return thread.element;
  },
});

/** The conversations in `files`: from GitHub's data in the newer view, from the page in the classic one. */
export const conversations = (files: FileInfo[], complete: boolean): ConversationTarget[] =>
  complete
    ? knownThreads(files).map(({ file, thread }) => known(file, thread))
    : files.flatMap((file) => (file.diff ? threads(file.diff.element).map((thread) => rendered(file, thread)) : []));
