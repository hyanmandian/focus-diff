// The review window's pending comments: what you write shows at once and goes to your pending review
// on GitHub on its own (src-tauri/src/drafts.rs); what's there (written here, or on github.com)
// comes back from GitHub. A copy is kept on this machine, so the window opens with them.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { bridge, type DraftsState } from "@/utils/bridge/bridge";
import type { Details } from "@/utils/details/details";
import {
  discardPending,
  loadPending,
  mergeDrafts,
  submitPending,
  toPut,
  unsent,
  type PendingReview,
} from "@/utils/pending/pending";
import type { Draft, PullRef, Thread } from "@/utils/review/review";

const keptKey = (prId: string) => `drafts:${prId}`;

function readKept(prId: string): Draft[] {
  try {
    return JSON.parse(localStorage.getItem(keptKey(prId)) ?? "[]") as Draft[];
  } catch {
    return [];
  }
}

/** Without the pending ones: a thread you started in your pending review is one of your pending
 *  comments, as is a pending reply in someone's conversation. */
export function published(threads: Thread[]): Thread[] {
  return threads
    .filter((t) => !t.pending)
    .map((t) => (t.comments.some((c) => c.pending) ? { ...t, comments: t.comments.filter((c) => !c.pending) } : t));
}

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function usePending(prId: string, ref: PullRef, threads: Thread[]) {
  // What was kept from last time, and what's been written since (the side a comment is on, which
  // GitHub doesn't say back).
  const [kept, setKept] = useState<Draft[]>(() => readKept(prId));
  const [github, setGithub] = useState<PendingReview | null>(null);
  const [state, setState] = useState<DraftsState>({ jobs: [], ids: {} });
  const drafts = useMemo(() => mergeDrafts(kept, github, state, threads), [kept, github, state, threads]);
  const asked = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(keptKey(prId), JSON.stringify(drafts));
    } catch {
      // Still shown in this window.
    }
  }, [prId, drafts]);

  /** What GitHub and Rust have now; only the latest asking counts. */
  const refresh = useCallback(async () => {
    const turn = ++asked.current;
    const [onGitHub, queued] = await Promise.all([
      loadPending(ref).catch(() => {}),
      bridge.draftsState(prId).catch(() => null),
    ]);
    if (turn !== asked.current) return null;
    if (onGitHub !== undefined) setGithub(onGitHub);
    if (queued) setState(queued);
    return { onGitHub, queued };
  }, [prId, ref]);

  const send = useCallback(
    (draft: Draft) => {
      const change = toPut(prId, draft);
      setState((s) => ({ ...s, jobs: [...s.jobs.filter((j) => j.change.key !== draft.key), { change, error: null }] }));
      const { op: _, ...put } = change;
      void bridge.draftPut(put).catch(() => {});
    },
    [prId],
  );

  useEffect(() => {
    void refresh().then((now) => {
      // Comments written before pending reviews lived on GitHub (or whose sending was lost) go now.
      if (!now?.queued || now.onGitHub === undefined) return;
      for (const draft of unsent(readKept(prId), now.onGitHub, now.queued)) send(draft);
    });
    const off = bridge.on<string>("drafts", (pull) => pull === prId && void refresh());
    return () =>
      void off.then((f) => {
        f();
      });
  }, [prId, refresh, send]);

  const add = (draft: Omit<Draft, "key">) => {
    const full = { ...draft, key: newKey() };
    setKept((list) => [...list, full]);
    send(full);
  };
  const edit = (key: string, body: string) => {
    const draft = drafts.find((d) => d.key === key);
    if (!draft) return;
    setKept((list) => list.map((d) => (d.key === key ? { ...d, body } : d)));
    send({ ...draft, body });
  };
  const remove = (key: string) => {
    const draft = drafts.find((d) => d.key === key);
    setKept((list) => list.filter((d) => d.key !== key));
    setState((s) => ({
      ...s,
      jobs: [
        ...s.jobs.filter((j) => j.change.key !== key),
        { change: { op: "remove", key, pull: prId, id: draft?.id }, error: null },
      ],
    }));
    void bridge.draftRemove(prId, key, draft?.id).catch(() => {});
  };
  const retry = () => void bridge.draftsRetry(prId).then(refresh);
  const after = async () => {
    setKept([]);
    setState({ jobs: [], ids: {} });
    setGithub(null);
    await refresh();
  };
  const submit = async (details: Details, event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT", body: string) => {
    await submitPending(details, event, body, drafts.length);
    await after();
  };
  const discard = async (details: Details) => {
    await discardPending(details);
    await after();
  };

  // Why GitHub refused a comment, and the ones still on their way, by key.
  const errors = useMemo(
    () => Object.fromEntries(state.jobs.flatMap((j) => (j.error ? [[j.change.key, j.error]] : []))),
    [state],
  );
  const sending = useMemo(() => new Set(state.jobs.filter((j) => !j.error).map((j) => j.change.key)), [state]);

  return { drafts, errors, sending, add, edit, remove, retry, submit, discard };
}

export type Pending = ReturnType<typeof usePending>;
