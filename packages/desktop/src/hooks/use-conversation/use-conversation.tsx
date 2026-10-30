import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { published, type Pending } from "@/hooks/use-pending/use-pending";
import { bridge } from "@/utils/bridge/bridge";
import {
  edit as editOnGitHub,
  react as reactOnGitHub,
  remove as removeOnGitHub,
  type Reaction,
  type ReactionContent,
} from "@/utils/comments/comments";
import { commitSuggestions, defaultHeadline, StaleHead, type Applied } from "@/utils/commit/commit";
import {
  keepConversation,
  loadConversation,
  readKeptConversation,
  type Conversation,
  type ConversationEntry,
} from "@/utils/conversation/conversation";
import type { Details } from "@/utils/details/details";
import type { Actor } from "@/utils/engine/engine";
import { errorText } from "@/utils/error/error";
import { i18n } from "@/utils/i18n/i18n";
import {
  setResolved,
  type Draft,
  type PullRef,
  type ReviewFile,
  type Thread,
  type ThreadComment,
} from "@/utils/review/review";
import { SuggestionError } from "@/utils/suggestion/suggestion";
import type { Person } from "@/utils/writing/writing";

export type ConversationApi = {
  repo: string;
  url: string;
  me: string | null;
  people: Person[];
  canApplySuggestion: boolean;
  branch: string;
  thread: (id: string) => Thread | undefined;
  patchOf: (path: string) => string | undefined;
  draft: (key: string) => Draft | undefined;
  draftError: (key: string) => string | undefined;
  draftSending: (key: string) => boolean;
  retryDrafts: () => void;
  replyLater: (thread: Thread, body: string) => void;
  editComment: (comment: ThreadComment, body: string) => Promise<void>;
  deleteComment: (comment: ThreadComment) => Promise<void>;
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
export const ConversationProvider = Context;
export const useConversationApi = () => useContext(Context);

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
    // oxlint-disable-next-line typescript/no-deprecated
    document.execCommand("copy");
    field.remove();
  }
}

const confirmDelete = () => {
  const t = i18n();
  return bridge.confirm(t("review.deleteConfirm"), t("review.deleteConfirmMessage"), t("review.deleteConfirmButton"));
};

type Options = {
  prId: string;
  ref: PullRef;
  details: Details | null;
  threads: Thread[];
  setThreads: (update: (threads: Thread[]) => Thread[]) => void;
  files: ReviewFile[] | null;
  me: string | null;
  pending: Pending;
  say: (message: string) => void;
  reloadAll: () => void;
};

export function useConversation({
  prId,
  ref,
  details,
  threads,
  setThreads,
  files,
  me,
  pending,
  say,
  reloadAll,
}: Options) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [batch, setBatch] = useState<Applied[]>([]);

  const reload = useCallback(async () => {
    try {
      const fresh = await loadConversation(ref);
      setConversation(fresh);
      keepConversation(prId, fresh);
    } catch {}
  }, [prId, ref]);

  useEffect(() => {
    let fresh = false;
    const fromDisk = async () => {
      const kept = await readKeptConversation(prId);
      if (!fresh && kept) setConversation(kept);
    };
    const fromGitHub = async () => {
      await reload();
      fresh = true;
    };
    void fromDisk();
    void fromGitHub();
  }, [prId, reload]);

  const byId = useMemo(() => new Map(published(threads).map((t) => [t.id, t])), [threads]);
  const patches = useMemo(() => new Map((files ?? []).map((f) => [f.path, f.patch])), [files]);
  const people = useMemo(() => {
    const all: Actor[] = [
      details?.author ?? null,
      ...(details?.reviewers.filter((r) => !r.team).map((r) => r.actor) ?? []),
    ];
    for (const e of conversation?.entries ?? details?.entries ?? []) all.push(e.author);
    for (const t of threads) for (const c of t.comments) all.push(c.author);
    return all.flatMap((a): Person[] =>
      a?.login && a.login !== me ? [{ login: a.login, name: a.name, avatarUrl: a.avatarUrl }] : [],
    );
  }, [details, conversation, threads, me]);

  const patchComment = (id: string, patch: Partial<ThreadComment> | null) => {
    setThreads((list) =>
      list.flatMap((t) => {
        if (!t.comments.some((c) => c.id === id)) return [t];
        const comments = patch
          ? t.comments.map((c) => (c.id === id ? { ...c, ...patch } : c))
          : t.comments.filter((c) => c.id !== id);
        return comments.length > 0 ? [{ ...t, comments }] : [];
      }),
    );
  };
  const patchEntry = (id: string, patch: Pick<ConversationEntry, "body" | "html" | "edited"> | null) => {
    setConversation(
      (c) =>
        c && {
          ...c,
          entries: patch
            ? c.entries.map((e) => (e.id === id ? { ...e, ...patch } : e))
            : c.entries.filter((e) => e.id !== id),
        },
    );
  };

  const remove = async (kind: "review-comment" | "issue-comment", id: string, removed: () => void) => {
    if (!(await confirmDelete())) return;
    try {
      await removeOnGitHub(kind, id);
    } catch (e) {
      say(errorText(e));
      return;
    }
    removed();
    say(i18n()("review.commentDeleted"));
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
    replyLater: (thread, body) => {
      pending.add({ path: thread.path, side: thread.side, line: thread.line, body, replyTo: thread.id });
    },
    editComment: async (comment, body) => {
      const html = await editOnGitHub("review-comment", comment.id, body);
      patchComment(comment.id, { body, html, edited: true });
    },
    deleteComment: (comment) =>
      remove("review-comment", comment.id, () => {
        patchComment(comment.id, null);
      }),
    editEntry: async (kind, id, body) => {
      const html = await editOnGitHub(kind === "comment" ? "issue-comment" : "review", id, body);
      patchEntry(id, { body, html, edited: true });
    },
    deleteEntry: (id) =>
      remove("issue-comment", id, () => {
        patchEntry(id, null);
      }),
    editDescription: async (body) => {
      if (!details) return;
      const html = await editOnGitHub("pull", details.id, body);
      setConversation((c) => c && { ...c, body, html });
    },
    react: async (subject, content, on, after) => {
      try {
        await reactOnGitHub(subject, content, on);
      } catch (e) {
        say(errorText(e));
        throw e;
      }
      patchComment(subject, { reactions: after });
      setConversation((c) => {
        if (!c) return c;
        if (details?.id === subject) return { ...c, reactions: after };
        return c.entries.some((e) => e.id === subject)
          ? { ...c, entries: c.entries.map((e) => (e.id === subject ? { ...e, reactions: after } : e)) }
          : c;
      });
    },
    copyLink: (url) => {
      const copy = async () => {
        await copyText(url);
        say(i18n()("review.linkCopied"));
      };
      void copy();
    },
    batch,
    toggleBatch: (item) => {
      setBatch((list) =>
        list.some((i) => i.comment === item.comment) ? list.filter((i) => i.comment !== item.comment) : [...list, item],
      );
    },
    clearBatch: () => {
      setBatch([]);
    },
    commit: async (items, headline, body) => {
      if (!conversation?.headRepo || !details) return;
      const t = i18n();
      try {
        await commitSuggestions({
          repo: conversation.headRepo,
          branch: details.headRefName,
          head: details.headRefOid,
          items,
          headline: headline.trim() || defaultHeadline(items),
          body,
          me,
        });
      } catch (e) {
        if (e instanceof StaleHead) {
          reloadAll();
          throw new Error(t("review.branchMoved"), { cause: e });
        }
        if (e instanceof SuggestionError)
          throw new Error(t(e.reason === "overlap" ? "review.suggestionsOverlap" : "review.suggestionOutside"), {
            cause: e,
          });
        throw new Error(errorText(e), { cause: e });
      }
      setBatch((list) => list.filter((i) => !items.some((x) => x.comment === i.comment)));
      const applied = new Set(items.map((i) => i.thread));
      setThreads((list) => list.map((thread) => (applied.has(thread.id) ? { ...thread, resolved: true } : thread)));
      await Promise.all(
        [...applied]
          .map((id) => byId.get(id))
          .flatMap((thread) => (thread && !thread.resolved ? [setResolved(thread, true).catch(() => {})] : [])),
      );
      say(t("review.suggestionsCommitted", { count: items.length }));
      reloadAll();
    },
  };

  return { conversation, reload, api };
}
