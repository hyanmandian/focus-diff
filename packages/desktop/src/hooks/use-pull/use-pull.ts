import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { bridge, GitHubError } from "@/utils/bridge/bridge";
import {
  allRuns,
  approveRun,
  awaitingApproval,
  failedRuns,
  rerunAll,
  rerunFailed,
  useChecks,
  type CheckItem,
} from "@/utils/checks/checks";
import { sinceReview, useCommits, type Range } from "@/utils/commits/commits";
import type { Details } from "@/utils/details/details";
import { markReady } from "@/utils/details/details";
import { errorText } from "@/utils/error/error";
import { i18n } from "@/utils/i18n/i18n";
import { canWrite, closePull, convertToDraft, reopenPull, useManage } from "@/utils/manage/manage";
import {
  deleteBranch,
  dequeue,
  disableAutoMerge,
  enableAutoMerge,
  enqueue,
  loadMergeState,
  mergePull,
  mergeView,
  updateBranch,
  type Method,
} from "@/utils/merging/merging";
import type { PullRef, Thread } from "@/utils/review/review";
import { loadTimeline, mapTimeline, type TimelinePage } from "@/utils/timeline/timeline";

type Options = {
  prId: string;
  ref: PullRef;
  details: Details | null;
  setDetails: Dispatch<SetStateAction<Details | null>>;
  threads: Thread[];
  say: (message: string) => void;
  reloadAll: () => void;
};

const fromDetails = (d: Details | null): CheckItem[] | null =>
  d
    ? d.checks.map((c, i) => ({
        id: `${i}:${c.name}`,
        kind: "run",
        name: c.name,
        workflow: null,
        state: c.state,
        detail: "",
        description: null,
        url: c.url,
        required: false,
        startedAt: null,
        completedAt: null,
        job: null,
        run: null,
      }))
    : null;

export function usePull({ prId, ref, details, setDetails, threads, say, reloadAll }: Options) {
  const { manage, reload: reloadManage, patch } = useManage(prId, ref);
  const commits = useCommits(prId, ref, details?.headRefOid);
  const checks = useChecks(ref, details?.headRefOid, fromDetails(details));
  const [range, setRange] = useState<Range>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const revalidate = useCallback(async () => {
    void bridge.refresh(true);
    const [state] = await Promise.allSettled([loadMergeState(ref), reloadManage(true)]);
    if (state.status === "fulfilled") setDetails((d) => (d ? { ...d, ...state.value } : d));
  }, [ref, reloadManage, setDetails]);

  const unknown =
    details?.state === "OPEN" && (details.mergeable === "UNKNOWN" || details.mergeStateStatus === "UNKNOWN");
  const tries = useRef(0);
  useEffect(() => {
    if (!unknown) {
      tries.current = 0;
      return;
    }
    if (tries.current >= 6) return;
    const timer = window.setTimeout(() => {
      tries.current++;
      void revalidate();
    }, 2500);
    return () => {
      window.clearTimeout(timer);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [unknown, revalidate, details]);
  const wasRunning = useRef(checks.running);
  useEffect(() => {
    if (wasRunning.current && !checks.running) void revalidate();
    wasRunning.current = checks.running;
  }, [checks.running, revalidate]);

  const [awaiting, setAwaiting] = useState<Array<{ id: number; name: string }>>([]);
  const write = canWrite(manage);
  const head = details?.headRefOid;
  useEffect(() => {
    if (!write || !head || details?.state !== "OPEN") return;
    let live = true;
    const look = async () => {
      try {
        const runs = await awaitingApproval(ref, head);
        if (live) setAwaiting(runs);
      } catch {}
    };
    void look();
    return () => {
      live = false;
    };
  }, [write, head, ref, details?.state]);

  const [pages, setPages] = useState<TimelinePage[]>([]);
  const updatedAt = details?.updatedAt;
  useEffect(() => {
    if (!updatedAt) return;
    let live = true;
    const look = async () => {
      try {
        const page = await loadTimeline(ref);
        if (live) setPages((old) => [page, ...old.slice(1)]);
      } catch {}
    };
    void look();
    return () => {
      live = false;
    };
  }, [ref, updatedAt]);
  const older = pages.at(-1)?.older ?? null;
  const loadOlder = useCallback(async () => {
    if (!older) return;
    const page = await loadTimeline(ref, older);
    setPages((p) => [...p, page]);
  }, [ref, older]);
  const events = useMemo(() => {
    const seen = new Set<unknown>();
    const nodes = pages
      .toReversed()
      .flatMap((p) => p.nodes)
      .filter((n) => !seen.has(n.id) && Boolean(seen.add(n.id)));
    return mapTimeline(nodes).toReversed();
  }, [pages]);

  const unresolved = threads.filter((t) => !t.resolved).length;
  const counted = checks.checks.some((c) => c.required) ? checks.checks.filter((c) => c.required) : checks.checks;
  const view =
    details && manage
      ? mergeView({
          details,
          manage,
          failing: counted.filter((c) => c.state === "failure").length,
          pending: counted.filter((c) => c.state === "pending").length,
          unresolved,
        })
      : null;

  const act = async (
    name: string,
    call: () => Promise<unknown>,
    optimistic: (() => void) | undefined,
    done: string,
  ) => {
    setBusy(name);
    optimistic?.();
    try {
      await call();
      say(done);
    } catch (e) {
      if (e instanceof GitHubError && e.status === 409) {
        say(i18n()("manage.headMoved"));
        reloadAll();
      } else say(errorText(e));
    } finally {
      setBusy(null);
      void revalidate();
    }
  };

  const actions = {
    merge: async (
      method: Method,
      text?: { title: string; body: string },
      options: { bypass?: boolean; deleteAfter?: boolean } = {},
    ) => {
      if (!details) return;
      const ok = await bridge.confirm(
        i18n()(options.bypass ? "manage.bypassConfirm" : "review.mergeConfirm", { number: String(details.number) }),
        i18n()(`review.mergeConfirm.${method}`, { title: details.title, base: details.baseRefName }),
        i18n()(`review.mergeMethod.${method}`),
      );
      if (!ok) return;
      await act(
        "merge",
        async () => {
          await mergePull(details, method, text);
          setDetails((d) => (d && d.headRefOid === details.headRefOid ? { ...d, state: "MERGED" } : d));
          if (options.deleteAfter && manage) await deleteBranch(manage, details.headRefName).catch(() => {});
        },
        undefined,
        i18n()("review.merged"),
      );
    },
    autoMerge: (method: Method, text?: { title: string; body: string }) =>
      details &&
      act(
        "auto",
        () => enableAutoMerge(details, method, text),
        () => {
          patch((m) => ({
            ...m,
            autoMerge: { method: method === "squash" ? "SQUASH" : method === "rebase" ? "REBASE" : "MERGE", by: null },
          }));
        },
        i18n()("manage.autoMergeOn"),
      ),
    disableAutoMerge: () =>
      details &&
      act(
        "auto",
        () => disableAutoMerge(details),
        () => {
          patch((m) => ({ ...m, autoMerge: null }));
        },
        i18n()("manage.autoMergeOff"),
      ),
    enqueue: () =>
      details &&
      act(
        "queue",
        () => enqueue(details),
        () => {
          patch((m) => ({ ...m, isInMergeQueue: true }));
        },
        i18n()("manage.queued"),
      ),
    dequeue: () =>
      details &&
      act(
        "queue",
        () => dequeue(details),
        () => {
          patch((m) => ({ ...m, isInMergeQueue: false, queuePosition: null }));
        },
        i18n()("manage.dequeued"),
      ),
    updateBranch: (how: "MERGE" | "REBASE") =>
      details &&
      act(
        "update",
        () => updateBranch(details, how),
        () => {
          patch((m) => ({ ...m, viewerCanUpdateBranch: false }));
        },
        i18n()("manage.branchUpdated"),
      ),
    ready: () =>
      details &&
      act(
        "ready",
        () => markReady(details),
        () => {
          setDetails((d) => (d ? { ...d, isDraft: false } : d));
        },
        i18n()("review.readyNotice"),
      ),
    draft: () =>
      details &&
      act(
        "ready",
        () => convertToDraft(details.id),
        () => {
          setDetails((d) => (d ? { ...d, isDraft: true } : d));
        },
        i18n()("manage.draftNotice"),
      ),
    close: () =>
      details &&
      act(
        "close",
        () => closePull(details.id),
        () => {
          setDetails((d) => (d ? { ...d, state: "CLOSED" } : d));
        },
        i18n()("manage.closedNotice"),
      ),
    reopen: () =>
      details &&
      act(
        "close",
        () => reopenPull(details.id),
        () => {
          setDetails((d) => (d ? { ...d, state: "OPEN" } : d));
        },
        i18n()("manage.reopenedNotice"),
      ),
    deleteBranch: async () => {
      if (!details || !manage) return;
      if (
        !(await bridge.confirm(
          i18n()("manage.deleteBranchConfirm", { branch: details.headRefName }),
          i18n()("manage.deleteBranchMessage"),
          i18n()("manage.deleteBranch"),
        ))
      )
        return;
      await act(
        "branch",
        () => deleteBranch(manage, details.headRefName),
        () => {
          patch((m) => ({ ...m, headRefExists: false }));
        },
        i18n()("manage.branchDeleted"),
      );
    },
    rerun: (which: "failed" | "all") => {
      const runs = which === "failed" ? failedRuns(checks.checks) : allRuns(checks.checks);
      if (runs.length === 0) return;
      void act(
        "rerun",
        () => Promise.all(runs.map((run) => (which === "failed" ? rerunFailed(ref, run) : rerunAll(ref, run)))),
        () => {
          checks.setChecks(
            (list) =>
              list?.map((c) =>
                c.run && runs.includes(c.run) && (which === "all" || c.state === "failure")
                  ? { ...c, state: "pending", detail: "queued" }
                  : c,
              ) ?? list,
          );
        },
        i18n()("manage.rerunning"),
      ).then(() => window.setTimeout(() => void checks.reload(true), 3000));
    },
    approve: () => {
      const runs = awaiting;
      void act(
        "approve",
        () => Promise.all(runs.map((r) => approveRun(ref, r.id))),
        () => {
          setAwaiting([]);
        },
        i18n()("manage.approved"),
      ).then(() => window.setTimeout(() => void checks.reload(true), 3000));
    },
  };

  const open = details?.state === "OPEN";
  const failed = failedRuns(checks.checks).length > 0;
  const since = commits ? sinceReview(commits) : null;
  const allowed: Record<string, boolean> = {
    "update-branch": Boolean(view?.canUpdateBranch),
    "auto-merge": view ? view.canAutoMerge || view.canDisableAutoMerge : false,
    ready: open && details.isDraft && details.viewerCanUpdate,
    draft: open && !details.isDraft && details.viewerCanUpdate,
    close: open && details.viewerCanUpdate,
    reopen: details?.state === "CLOSED" && details.viewerCanUpdate,
    "delete-branch": Boolean(
      details && details.state !== "OPEN" && manage?.headRefExists && manage.viewerCanDeleteHeadRef,
    ),
    "rerun-failed": write && failed,
    "all-changes": range !== null,
    "since-review": since !== null,
  };
  const menu: Record<string, () => void> = {
    "update-branch": () => void actions.updateBranch("MERGE"),
    "auto-merge": () => {
      const method = details?.mergeMethods[0];
      if (view?.canDisableAutoMerge) void actions.disableAutoMerge();
      else if (method) void actions.autoMerge(method);
    },
    ready: () => void actions.ready(),
    draft: () => void actions.draft(),
    close: () => void actions.close(),
    reopen: () => void actions.reopen(),
    "delete-branch": () => void actions.deleteBranch(),
    "rerun-failed": () => {
      actions.rerun("failed");
    },
    "all-changes": () => {
      setRange(null);
    },
    "since-review": () => {
      if (since) setRange(since.range);
    },
  };

  return {
    manage,
    patch,
    reloadManage,
    commits,
    since,
    checks,
    awaiting,
    range,
    setRange,
    view,
    busy,
    actions,
    events,
    older,
    loadOlder,
    unresolved,
    allowed,
    menu,
  };
}

export type Pull = ReturnType<typeof usePull>;
