// What the review window's comments can do, wherever they're drawn (the Overview, or between a
// diff's lines, which @pierre/diffs draws apart from the rest): edit and delete your own, react,
// copy a link, apply suggestions (one, or a batch in one commit), reply into your pending review.
// One context rather than props through the diff, which redraws its items only when they change.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { bridge } from "@/lib/bridge";
import { commitSuggestions, defaultHeadline, StaleHead, type Applied } from "@/lib/commit";
import { edit as editOnGitHub, react as reactOnGitHub, remove as removeOnGitHub, type Reaction, type ReactionContent } from "@/lib/comments";
import { keepConversation, loadConversation, readKeptConversation, type Conversation } from "@/lib/conversation";
import type { Details } from "@/lib/details";
import type { Actor } from "@/lib/engine";
import { i18n } from "@/lib/i18n";
import { setResolved, type Draft, type PullRef, type ReviewFile, type Thread, type ThreadComment } from "@/lib/review";
import { SuggestionError } from "@/lib/suggestion";
import type { Person } from "@/lib/writing";
import type { Pending } from "./pending";

export type ConversationApi = {
  /** "owner/name", for previews and completions. */
  repo: string;
  /** The pull request on github.com. */
  url: string;
  me: string | null;
  /** The pull request's people, first among those offered for an @mention. */
  people: Person[];
  /** Whether you can commit suggestions to the pull request's branch, and its name. */
  canApplySuggestion: boolean;
  branch: string;
  /** A conversation as it is now (edited, reacted to) though the diff drew it before. */
  thread: (id: string) => Thread | undefined;
  /** A file's patch, for the lines a suggestion starts from. */
  patchOf: (path: string) => string | undefined;
  /** A pending comment as it is now (GitHub's HTML for it arrives after the diff drew it). */
  draft: (key: string) => Draft | undefined;
  /** Why GitHub refused a pending comment, if it did; whether it's still on its way. */
  draftError: (key: string) => string | undefined;
  draftSending: (key: string) => boolean;
  retryDrafts: () => void;
  /** A reply that goes with your review rather than now. */
  replyLater: (thread: Thread, body: string) => void;
  editComment: (comment: ThreadComment, body: string) => Promise<void>;
  deleteComment: (comment: ThreadComment) => Promise<void>;
  /** A conversation entry (a comment on the pull request, or a review's own text). */
  editEntry: (kind: "comment" | "review", id: string, body: string) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  editDescription: (body: string) => Promise<void>;
  react: (subject: string, content: ReactionContent, on: boolean, after: Reaction[]) => Promise<void>;
  copyLink: (url: string) => void;
  batch: Applied[];
  toggleBatch: (item: Applied) => void;
  clearBatch: () => void;
  commit: (items: Applied[], headline: string, body: string) => Promise<void>;
};

const Context = createContext<ConversationApi | null>(null);
export const ConversationProvider = Context.Provider;
/** Null outside a review window (and in tests): comments then only show. */
export const useConversationApi = () => useContext(Context);

/** Copies text, the page's way when it may, a hidden field's otherwise (an older web view). */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.append(field);
    field.select();
    document.execCommand("copy");
    field.remove();
  }
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Options = {
  prId: string;
  ref: PullRef;
  details: Details | null;
  threads: Thread[];
  setThreads: (update: (threads: Thread[]) => Thread[]) => void;
  files: ReviewFile[] | null;
  me: string | null;
  pending: Pending;
  /** Says something in the toolbar for a moment. */
  say: (message: string) => void;
  /** After a commit: everything again, the files included. */
  reloadAll: () => void;
};

export function useConversation({ prId, ref, details, threads, setThreads, files, me, pending, say, reloadAll }: Options) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [batch, setBatch] = useState<Applied[]>([]);

  const reload = useCallback(async () => {
    try {
      const fresh = await loadConversation(ref);
      setConversation(fresh);
      keepConversation(prId, fresh);
    } catch {
      // The details' latest comments stand in.
    }
  }, [prId, ref]);

  useEffect(() => {
    let fresh = false;
    void readKeptConversation(prId).then((kept) => !fresh && kept && setConversation(kept));
    void reload().then(() => (fresh = true));
  }, [prId, reload]);

  const byId = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);
  const patches = useMemo(() => new Map((files ?? []).map((f) => [f.path, f.patch])), [files]);
  const people = useMemo(() => {
    const all: Actor[] = [details?.author ?? null, ...(details?.reviewers.filter((r) => !r.team).map((r) => r.actor) ?? [])];
    for (const e of conversation?.entries ?? details?.entries ?? []) all.push(e.author);
    for (const t of threads) for (const c of t.comments) all.push(c.author);
    return all.flatMap((a): Person[] => (a?.login && a.login !== me ? [{ login: a.login, name: a.name, avatarUrl: a.avatarUrl }] : []));
  }, [details, conversation, threads, me]);

  const patchComment = (id: string, patch: Partial<ThreadComment> | null) =>
    setThreads((list) =>
      list.flatMap((t) => {
        if (!t.comments.some((c) => c.id === id)) return [t];
        const comments = patch ? t.comments.map((c) => (c.id === id ? { ...c, ...patch } : c)) : t.comments.filter((c) => c.id !== id);
        return comments.length ? [{ ...t, comments }] : [];
      }),
    );
  const patchEntry = (id: string, patch: Partial<Conversation["entries"][number]> | null) =>
    setConversation((c) => c && { ...c, entries: patch ? c.entries.map((e) => (e.id === id ? ({ ...e, ...patch } as typeof e) : e)) : c.entries.filter((e) => e.id !== id) });

  const confirmDelete = () => {
    const t = i18n();
    return bridge.confirm(t("review.deleteConfirm"), t("review.deleteConfirmMessage"), t("review.deleteConfirmButton"));
  };

  const api: ConversationApi = {
    repo: `${ref.owner}/${ref.repo}`,
    url: details?.url ?? `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`,
    me,
    people,
    canApplySuggestion: Boolean(conversation?.canApplySuggestion && conversation.headRepo && details?.state === "OPEN"),
    branch: details?.headRefName ?? "",
    thread: (id) => byId.get(id),
    patchOf: (path) => patches.get(path),
    draft: (key) => pending.drafts.find((d) => d.key === key),
    draftError: (key) => pending.errors[key],
    draftSending: (key) => pending.sending.has(key),
    retryDrafts: pending.retry,
    replyLater: (thread, body) => pending.add({ path: thread.path, side: thread.side, line: thread.line, body, replyTo: thread.id }),
    editComment: async (comment, body) => {
      const html = await editOnGitHub("review-comment", comment.id, body);
      patchComment(comment.id, { body, html, edited: true });
    },
    deleteComment: async (comment) => {
      if (!(await confirmDelete())) return;
      await removeOnGitHub("review-comment", comment.id);
      patchComment(comment.id, null);
      say(i18n()("review.commentDeleted"));
    },
    editEntry: async (kind, id, body) => {
      const html = await editOnGitHub(kind === "comment" ? "issue-comment" : "review", id, body);
      patchEntry(id, { body, html, edited: true });
    },
    deleteEntry: async (id) => {
      if (!(await confirmDelete())) return;
      await removeOnGitHub("issue-comment", id);
      patchEntry(id, null);
      say(i18n()("review.commentDeleted"));
    },
    editDescription: async (body) => {
      if (!details) return;
      const html = await editOnGitHub("pull", details.id, body);
      setConversation((c) => c && { ...c, body, html });
    },
    react: async (subject, content, on, after) => {
      try {
        await reactOnGitHub(subject, content, on);
      } catch (e) {
        say(message(e));
        throw e;
      }
      // Kept, so the next drawing shows it too.
      patchComment(subject, { reactions: after });
      setConversation((c) => {
        if (!c) return c;
        if (details?.id === subject) return { ...c, reactions: after };
        return c.entries.some((e) => e.id === subject) ? { ...c, entries: c.entries.map((e) => (e.id === subject ? { ...e, reactions: after } : e)) } : c;
      });
    },
    copyLink: (url) => void copyText(url).then(() => say(i18n()("review.linkCopied"))),
    batch,
    toggleBatch: (item) => setBatch((list) => (list.some((i) => i.comment === item.comment) ? list.filter((i) => i.comment !== item.comment) : [...list, item])),
    clearBatch: () => setBatch([]),
    commit: async (items, headline, body) => {
      if (!conversation?.headRepo || !details) return;
      const t = i18n();
      try {
        await commitSuggestions({ repo: conversation.headRepo, branch: details.headRefName, head: details.headRefOid, items, headline: headline.trim() || defaultHeadline(items), body, me });
      } catch (e) {
        if (e instanceof StaleHead) {
          // What's shown is behind the branch: it's brought up to date to try again on.
          reloadAll();
          throw new Error(t("review.branchMoved"));
        }
        if (e instanceof SuggestionError) throw new Error(t(e.reason === "overlap" ? "review.suggestionsOverlap" : "review.suggestionOutside"));
        throw new Error(message(e));
      }
      setBatch((list) => list.filter((i) => !items.some((x) => x.comment === i.comment)));
      // Applied, so done with, as on GitHub.
      await Promise.all([...new Set(items.map((i) => i.thread))].map((id) => byId.get(id)).flatMap((thread) => (thread && !thread.resolved ? [setResolved(thread, true).catch(() => {})] : [])));
      say(t("review.suggestionsCommitted", { count: items.length }));
      reloadAll();
    },
  };

  return { conversation, reload, api };
}
