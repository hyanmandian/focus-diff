import {
  collapsedThreadToggle,
  commentIndicators,
  openThreads,
  threadById,
  threadComments,
  threadRemoved,
  threads,
  type Thread,
} from "@/utils/github-page/github-page";
import type { ConversationTarget, ThreadSummary } from "@/utils/provider/provider";
import type { FileInfo } from "@/utils/review-files/review-files";
import { waitFor } from "@/utils/scroll/scroll";

const EXPAND_TIMEOUT_MS = 1500;
const MARKER_TIMEOUT_MS = 600;

const lineOf = (thread: ThreadSummary) => Number(thread.line.slice(1)) || 0;

const openThread = (id: string) => {
  const thread = threadById(id);
  return thread && threadComments(thread).length > 0 ? thread : null;
};

const knownThreads = (files: FileInfo[]) =>
  files.flatMap((file) => {
    const diff = file.diff?.element;
    const open = diff ? openThreads(diff) : [];
    const openIds = new Set(open.map((thread) => thread.id));
    const kept = diff
      ? file.threads.filter((thread) => openIds.has(thread.id) || !threadRemoved(diff, thread.line))
      : file.threads;
    if (open.length === 0) return kept.map((thread) => ({ file, thread }));
    const answered = new Set(open.filter((thread) => thread.state === "answered").map((thread) => thread.id));
    const known = new Set(file.threads.map((thread) => thread.id));
    return [
      ...kept.map((thread) =>
        thread.state === "waiting" && answered.has(thread.id) ? { ...thread, state: "answered" as const } : thread,
      ),
      ...open.filter((thread) => !known.has(thread.id)),
    ]
      .toSorted((a, b) => lineOf(a) - lineOf(b))
      .map((thread) => ({ file, thread }));
  });

const known = (file: FileInfo, thread: ThreadSummary): ConversationTarget => ({
  file,
  line: lineOf(thread) || null,
  state: thread.state,
  element: null,
  open: async ({ goToFile, stale }) => {
    if (thread.comment) {
      history.replaceState(history.state, "", `#r${thread.comment}`);
      dispatchEvent(new HashChangeEvent("hashchange"));
      const found = await waitFor(() => openThread(thread.id), EXPAND_TIMEOUT_MS);
      if (found || stale()) return found;
    }
    const element = await goToFile(file);
    if (!element || stale()) return null;
    const lines = [...new Set(file.threads.map(({ line }) => line))];
    return (
      (await waitFor(() => commentIndicators(element)[lines.indexOf(thread.line)] ?? null, MARKER_TIMEOUT_MS)) ??
      element
    );
  },
});

const rendered = (file: FileInfo, thread: Thread): ConversationTarget => ({
  file,
  line: thread.line,
  state: thread.state,
  element: thread.element,
  open: async () => {
    const toggle = collapsedThreadToggle(thread.element);
    if (toggle) {
      toggle.click();
      await waitFor(() => (threadComments(thread.element).length > 0 ? thread.element : null), EXPAND_TIMEOUT_MS);
    }
    return thread.element;
  },
});

export const conversations = (files: FileInfo[], complete: boolean): ConversationTarget[] =>
  complete
    ? knownThreads(files).map(({ file, thread }) => known(file, thread))
    : files.flatMap((file) => (file.diff ? threads(file.diff.element).map((thread) => rendered(file, thread)) : []));
