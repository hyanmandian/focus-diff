import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePull } from "@/hooks/use-pull/use-pull";
import { GitHubError } from "@/utils/bridge/bridge";
import type { CheckItem } from "@/utils/checks/checks";
import type { Commit, Commits } from "@/utils/commits/commits";
import type { Details } from "@/utils/details/details";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Manage } from "@/utils/manage/manage";
import type { MergeView } from "@/utils/merging/merging";
import type { PullRef, Thread } from "@/utils/review/review";
import type { TimelinePage } from "@/utils/timeline/timeline";

// The hook brings together the pull request's state, commits, checks, timeline and actions, each
// a util of its own (manage.ts, commits.ts, checks.ts, timeline.ts, merging.ts): here, what they
// answer, so what the hook does with them shows.
type Checks = {
  checks: CheckItem[];
  loaded: boolean;
  running: boolean;
  reload: (again?: boolean) => Promise<void>;
  setChecks: (update: (list: CheckItem[] | null) => CheckItem[] | null) => void;
};
const u = vi.hoisted(() => ({
  manage: null as unknown,
  commits: null as unknown,
  checks: null as unknown,
  initialChecks: null as CheckItem[] | null,
  reloadManage: vi.fn<(again?: boolean) => Promise<void>>(),
  patch: vi.fn<(change: (m: Manage) => Manage) => void>(),
  loadMergeState: vi.fn<(ref: unknown) => Promise<object>>(),
  mergeView: vi.fn<(input: { failing: number; pending: number; unresolved: number }) => unknown>(),
  awaitingApproval: vi.fn<(ref: unknown, head: string) => Promise<Array<{ id: number; name: string }>>>(),
  approveRun: vi.fn<(ref: unknown, id: number) => Promise<void>>(),
  rerunAll: vi.fn<(ref: unknown, run: number) => Promise<void>>(),
  rerunFailed: vi.fn<(ref: unknown, run: number) => Promise<void>>(),
  loadTimeline: vi.fn<(ref: unknown, before?: string | null) => Promise<unknown>>(),
  call: vi.fn<(name: string, ...args: unknown[]) => Promise<void>>(),
}));
vi.mock("@/utils/manage/manage", async (original) => ({
  ...(await original<object>()),
  useManage: () => ({ manage: u.manage, reload: u.reloadManage, patch: u.patch }),
  closePull: (id: string) => u.call("closePull", id),
  convertToDraft: (id: string) => u.call("convertToDraft", id),
  reopenPull: (id: string) => u.call("reopenPull", id),
}));
vi.mock("@/utils/commits/commits", async (original) => ({
  ...(await original<object>()),
  useCommits: () => u.commits,
}));
vi.mock("@/utils/checks/checks", async (original) => ({
  ...(await original<object>()),
  useChecks: (_ref: unknown, _head: unknown, initial: CheckItem[] | null) => {
    u.initialChecks = initial;
    return u.checks;
  },
  awaitingApproval: u.awaitingApproval,
  approveRun: u.approveRun,
  rerunAll: u.rerunAll,
  rerunFailed: u.rerunFailed,
}));
vi.mock("@/utils/details/details", async (original) => ({
  ...(await original<object>()),
  markReady: (d: { id: string }) => u.call("markReady", d.id),
}));
vi.mock("@/utils/merging/merging", () => ({
  loadMergeState: u.loadMergeState,
  mergeView: u.mergeView,
  mergePull: (d: { id: string }, method: string, text?: unknown) => u.call("mergePull", d.id, method, text),
  enableAutoMerge: (d: { id: string }, method: string) => u.call("enableAutoMerge", d.id, method),
  disableAutoMerge: (d: { id: string }) => u.call("disableAutoMerge", d.id),
  enqueue: (d: { id: string }) => u.call("enqueue", d.id),
  dequeue: (d: { id: string }) => u.call("dequeue", d.id),
  updateBranch: (d: { id: string }, how: string) => u.call("updateBranch", d.id, how),
  deleteBranch: (_m: unknown, branch: string) => u.call("deleteBranch", branch),
}));
vi.mock("@/utils/timeline/timeline", () => ({
  loadTimeline: u.loadTimeline,
  // Each node as an event of its own, to see their order.
  mapTimeline: (nodes: Array<{ id: string }>) => nodes.map((n) => n.id),
}));

const REF: PullRef = { owner: "acme", repo: "api", number: 42 };

const DETAILS: Details = {
  id: "PR_1",
  number: 42,
  title: "Rename the queue",
  url: "https://github.com/acme/api/pull/42",
  html: "",
  owner: "acme",
  repo: "api",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "rename",
  headRefOid: "abc123",
  updatedAt: "2026-10-26T10:00:00Z",
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  createdAt: "2026-10-25T10:00:00Z",
  author: { login: "mona" },
  reviewDecision: null,
  reviewers: [],
  checks: [{ name: "build", state: "success", url: "https://ci.example.com/1" }],
  files: [],
  entries: [],
  mergeMethods: ["squash", "merge"],
};

const MANAGE: Manage = {
  viewerPermission: "WRITE",
  autoMergeAllowed: true,
  deleteBranchOnMerge: false,
  squashTitle: "PR_TITLE",
  squashMessage: "PR_BODY",
  mergeTitle: "PR_TITLE",
  mergeMessage: "PR_BODY",
  orgOwned: true,
  body: "",
  isMergeQueueEnabled: false,
  isInMergeQueue: false,
  queuePosition: null,
  viewerCanUpdateBranch: true,
  viewerCanEnableAutoMerge: true,
  viewerCanDisableAutoMerge: true,
  viewerCanMergeAsAdmin: false,
  viewerCanDeleteHeadRef: true,
  autoMerge: null,
  headRefExists: true,
  headOwner: "acme",
  headRepo: "api",
  rule: null,
  labels: [],
  assignees: [],
  milestone: null,
  issues: [],
  reviewers: [],
  deployments: [],
};

const VIEW: MergeView = {
  status: "ready",
  tone: "success",
  reasons: [],
  canMerge: true,
  canBypass: false,
  canAutoMerge: false,
  canDisableAutoMerge: false,
  canEnqueue: false,
  canDequeue: false,
  canUpdateBranch: true,
};

const check = (name: string, state: CheckItem["state"], run: number | null, required = false): CheckItem => ({
  id: name,
  kind: "run",
  name,
  workflow: "CI",
  state,
  detail: "",
  description: null,
  url: null,
  required,
  startedAt: null,
  completedAt: null,
  job: run && run * 10,
  run,
});

const thread = (id: string, resolved: boolean): Thread => ({
  id,
  path: "a.ts",
  side: "additions",
  line: 1,
  resolved,
  outdated: false,
  comments: [],
});

const commit = (oid: string, parent: string | null): Commit => ({
  oid,
  short: oid,
  headline: oid,
  body: "",
  at: "",
  author: { login: "mona", name: "Mona", avatarUrl: null },
  verified: null,
  ci: null,
  parent,
});
const COMMITS: Commits = { commits: [commit("c1", null), commit("c2", "c1")], forcePushes: [], reviewed: "c1" };

/** The manage state as `patch` leaves it. */
let manageNow: Manage = MANAGE;
let checksNow: CheckItem[] | null = [];
let confirmAnswer = true;
const ipc: Array<[string, unknown]> = [];

function setChecks(checks: CheckItem[], running = false) {
  checksNow = checks;
  const made: Checks = {
    checks,
    loaded: true,
    running,
    reload: vi.fn<Checks["reload"]>().mockResolvedValue(),
    setChecks: (update) => {
      checksNow = update(checksNow);
    },
  };
  u.checks = made;
  return made;
}

type Props = { details: Details | null; threads?: Thread[] };

/** The hook in a review window that holds the details. */
function setup(initial: Details | null = DETAILS, threads: Thread[] = []) {
  const say = vi.fn<(message: string) => void>();
  const reloadAll = vi.fn<() => void>();
  const view = renderHook(
    (props: Props) => {
      const [details, setDetails] = useState(props.details);
      return {
        details,
        setDetails,
        pull: usePull({
          prId: "PR_1",
          ref: REF,
          details,
          setDetails,
          threads: props.threads ?? threads,
          say,
          reloadAll,
        }),
      };
    },
    { initialProps: { details: initial } },
  );
  return { ...view, say, reloadAll };
}

/** Lets the clock run on 2.5 seconds at a time, rendering in between. */
async function wait2500(times: number): Promise<void> {
  if (times === 0) return;
  await act(() => vi.advanceTimersByTimeAsync(2500));
  await wait2500(times - 1);
}

const settle = () => act(() => Promise.resolve());

beforeEach(() => {
  manageNow = MANAGE;
  confirmAnswer = true;
  ipc.length = 0;
  mockCommands((cmd, args) => {
    ipc.push([cmd, args]);
    return cmd === "confirm" ? confirmAnswer : null;
  });
  u.manage = MANAGE;
  u.commits = COMMITS;
  setChecks([]);
  u.reloadManage.mockReset().mockResolvedValue();
  u.patch.mockReset().mockImplementation((change) => {
    manageNow = change(manageNow);
  });
  u.loadMergeState.mockReset().mockResolvedValue({ mergeStateStatus: "CLEAN" });
  u.mergeView.mockReset().mockReturnValue(VIEW);
  u.awaitingApproval.mockReset().mockResolvedValue([]);
  u.approveRun.mockReset().mockResolvedValue();
  u.rerunAll.mockReset().mockResolvedValue();
  u.rerunFailed.mockReset().mockResolvedValue();
  u.loadTimeline.mockReset().mockResolvedValue({ nodes: [], older: null } satisfies TimelinePage);
  u.call.mockReset().mockResolvedValue();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePull", () => {
  it("brings the merge box's view together from the details, the state, the checks and the conversations", () => {
    setChecks([check("lint", "failure", 1), check("e2e", "pending", 2), check("docs", "success", null)]);
    const { result } = setup(DETAILS, [thread("T1", false), thread("T2", true)]);
    expect(result.current.pull.view).toBe(VIEW);
    expect(u.mergeView).toHaveBeenLastCalledWith({
      details: DETAILS,
      manage: MANAGE,
      failing: 1,
      pending: 1,
      unresolved: 1,
    });
    expect(result.current.pull.unresolved).toBe(1);
  });

  it("counts only the required checks when some are", () => {
    setChecks([check("lint", "failure", 1), check("build", "pending", 2, true)]);
    setup();
    expect(u.mergeView).toHaveBeenLastCalledWith(expect.objectContaining({ failing: 0, pending: 1 }));
  });

  it("has no view without the details or the state", () => {
    u.manage = null;
    expect(setup().result.current.pull.view).toBeNull();
    u.manage = MANAGE;
    expect(setup(null).result.current.pull.view).toBeNull();
  });

  it("asks GitHub again for what merging changes, and the panel too", async () => {
    u.loadMergeState.mockResolvedValue({ mergeStateStatus: "BEHIND" });
    const { result } = setup({ ...DETAILS, isDraft: true });
    await act(() => result.current.pull.actions.ready());
    await settle();
    expect(result.current.details?.mergeStateStatus).toBe("BEHIND");
    expect(u.reloadManage).toHaveBeenCalledWith(true);
    expect(ipc).toContainEqual(["refresh", { force: true }]);

    u.loadMergeState.mockRejectedValue(new Error("offline"));
    await act(() => result.current.pull.actions.draft());
    await settle();
    expect(result.current.details?.mergeStateStatus).toBe("BEHIND");
  });

  it("asks again, a few times, while GitHub works out whether it can be merged", async () => {
    vi.useFakeTimers();
    let n = 0;
    u.loadMergeState.mockImplementation(() => Promise.resolve({ updatedAt: `t${++n}` }));
    const { rerender } = setup({ ...DETAILS, mergeable: "UNKNOWN" });
    await wait2500(8);
    expect(u.loadMergeState).toHaveBeenCalledTimes(6);
    // Known again: counting starts over.
    rerender({ details: { ...DETAILS, mergeStateStatus: "CLEAN" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("tells apart checks the details name alike until the full list comes", () => {
    const twice = { name: "build", state: "success" as const, url: null };
    setup({ ...DETAILS, checks: [twice, twice] });
    const ids = u.initialChecks?.map((c) => c.id) ?? [];
    expect(new Set(ids).size).toBe(2);
  });

  it("asks again while GitHub still doesn't know, though nothing else changed", async () => {
    vi.useFakeTimers();
    u.loadMergeState.mockImplementation(() => Promise.resolve({ mergeable: "UNKNOWN", updatedAt: DETAILS.updatedAt }));
    setup({ ...DETAILS, mergeable: "UNKNOWN" });
    await wait2500(8);
    expect(u.loadMergeState).toHaveBeenCalledTimes(6);
  });

  it("starts the count over once it's known, and stops waiting when it goes", async () => {
    vi.useFakeTimers();
    const { result } = setup({ ...DETAILS, mergeStateStatus: "UNKNOWN" });
    await act(() => vi.advanceTimersByTimeAsync(2500));
    expect(u.loadMergeState).toHaveBeenCalledOnce();
    act(() => {
      result.current.setDetails({ ...DETAILS, mergeStateStatus: "CLEAN" });
    });
    act(() => {
      result.current.setDetails({ ...DETAILS, mergeStateStatus: "UNKNOWN", updatedAt: "later" });
    });
    act(() => {
      result.current.setDetails({ ...DETAILS, mergeStateStatus: "CLEAN", updatedAt: "later" });
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(u.loadMergeState).toHaveBeenCalledOnce();
  });

  it("looks at the merge state again when the checks finish", async () => {
    setChecks([check("build", "pending", 1)], true);
    const { rerender } = setup();
    expect(u.loadMergeState).not.toHaveBeenCalled();
    setChecks([check("build", "success", 1)], false);
    rerender({ details: DETAILS });
    await waitFor(() => {
      expect(u.loadMergeState).toHaveBeenCalledOnce();
    });
  });

  it("lists the fork runs waiting for approval, to someone who can approve them", async () => {
    u.awaitingApproval.mockResolvedValue([{ id: 7, name: "CI" }]);
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.pull.awaiting).toEqual([{ id: 7, name: "CI" }]);
    });
    expect(u.awaitingApproval).toHaveBeenCalledWith(REF, "abc123");
  });

  it("doesn't look for runs waiting without the right, an open pull request or a head", async () => {
    u.manage = { ...MANAGE, viewerPermission: "READ" };
    setup();
    await settle();
    expect(u.awaitingApproval).not.toHaveBeenCalled();
    u.manage = MANAGE;
    setup({ ...DETAILS, state: "CLOSED" });
    setup({ ...DETAILS, headRefOid: "" });
    setup(null);
    await settle();
    expect(u.awaitingApproval).not.toHaveBeenCalled();
  });

  it("keeps none waiting when GitHub can't say, or says after it's gone", async () => {
    u.awaitingApproval.mockRejectedValueOnce(new Error("offline"));
    const first = setup();
    await settle();
    expect(first.result.current.pull.awaiting).toEqual([]);
    u.awaitingApproval.mockResolvedValue([{ id: 7, name: "CI" }]);
    const second = setup();
    second.unmount();
    await settle();
    expect(second.result.current.pull.awaiting).toEqual([]);
  });

  it("loads the timeline's newest page, older pages on request, each event once, newest first", async () => {
    u.loadTimeline.mockResolvedValueOnce({ nodes: [{ id: "e3" }, { id: "e4" }], older: "cursor1" });
    const { result } = setup();
    await waitFor(() => {
      expect(result.current.pull.events).toEqual(["e4", "e3"]);
    });
    expect(result.current.pull.older).toBe("cursor1");
    u.loadTimeline.mockResolvedValueOnce({ nodes: [{ id: "e1" }, { id: "e2" }, { id: "e3" }], older: null });
    await act(() => result.current.pull.loadOlder());
    expect(u.loadTimeline).toHaveBeenLastCalledWith(REF, "cursor1");
    expect(result.current.pull.events).toEqual(["e4", "e3", "e2", "e1"]);
    expect(result.current.pull.older).toBeNull();
    await act(() => result.current.pull.loadOlder());
    expect(u.loadTimeline).toHaveBeenCalledTimes(2);

    // The pull request changing brings the newest page again, in place of the first.
    u.loadTimeline.mockResolvedValueOnce({ nodes: [{ id: "e4" }, { id: "e5" }], older: "cursor1" });
    act(() => {
      result.current.setDetails({ ...DETAILS, updatedAt: "later" });
    });
    await waitFor(() => {
      expect(result.current.pull.events).toEqual(["e5", "e4", "e3", "e2", "e1"]);
    });
  });

  it("has no timeline without the details, and keeps it when GitHub can't say or says late", async () => {
    setup(null);
    await settle();
    expect(u.loadTimeline).not.toHaveBeenCalled();
    u.loadTimeline.mockRejectedValueOnce(new Error("offline"));
    const failed = setup();
    await settle();
    expect(failed.result.current.pull.events).toEqual([]);
    u.loadTimeline.mockResolvedValueOnce({ nodes: [{ id: "e1" }], older: null });
    const late = setup();
    late.unmount();
    await settle();
    expect(late.result.current.pull.events).toEqual([]);
  });

  describe("merging", () => {
    it("asks first, naming how, then merges and says so", async () => {
      const { result, say } = setup();
      await act(() => result.current.pull.actions.merge("squash", { title: "T", body: "B" }));
      expect(ipc.find(([cmd]) => cmd === "confirm")?.[1]).toEqual({
        title: "Merge pull request #42?",
        message: "“Rename the queue” goes into main as one squashed commit. This can't be undone.",
        ok: "Squash and Merge",
      });
      expect(u.call).toHaveBeenCalledWith("mergePull", "PR_1", "squash", { title: "T", body: "B" });
      expect(result.current.details?.state).toBe("MERGED");
      expect(say).toHaveBeenCalledWith("Merged");
      expect(u.call).not.toHaveBeenCalledWith("deleteBranch", "rename");
      // Then what merging changed comes in again.
      expect(u.loadMergeState).toHaveBeenCalled();
      expect(result.current.pull.busy).toBeNull();
    });

    it("can bypass the rules, and delete the branch after", async () => {
      u.call.mockImplementation((name) =>
        name === "deleteBranch" ? Promise.reject(new Error("protected")) : Promise.resolve(),
      );
      const { result, say } = setup();
      await act(() => result.current.pull.actions.merge("merge", undefined, { bypass: true, deleteAfter: true }));
      expect(ipc.find(([cmd]) => cmd === "confirm")?.[1]).toMatchObject({
        title: "Merge #42 without waiting for its requirements?",
      });
      expect(u.call).toHaveBeenCalledWith("deleteBranch", "rename");
      // The branch staying isn't a failure to merge.
      expect(say).toHaveBeenCalledWith("Merged");
    });

    it("doesn't delete the branch without the state to say whose it is", async () => {
      u.manage = null;
      const { result } = setup();
      await act(() => result.current.pull.actions.merge("rebase", undefined, { deleteAfter: true }));
      expect(u.call.mock.calls.map(([name]) => name)).toEqual(["mergePull"]);
    });

    it("leaves a newer head's state alone", async () => {
      const { result } = setup();
      u.call.mockImplementation(() => {
        act(() => {
          result.current.setDetails({ ...DETAILS, headRefOid: "newer" });
        });
        return Promise.resolve();
      });
      await act(() => result.current.pull.actions.merge("squash"));
      expect(result.current.details?.state).toBe("OPEN");
    });

    it("does nothing when told no, or without the details", async () => {
      confirmAnswer = false;
      const { result } = setup();
      await act(() => result.current.pull.actions.merge("squash"));
      expect(u.call).not.toHaveBeenCalled();
      const none = setup(null);
      await act(() => none.result.current.pull.actions.merge("squash"));
      expect(ipc.filter(([cmd]) => cmd === "confirm")).toHaveLength(1);
    });

    it("leaves the details alone once they're gone", async () => {
      const { result } = setup();
      u.call.mockImplementation(() => {
        act(() => {
          result.current.setDetails(null);
        });
        return Promise.resolve();
      });
      await act(() => result.current.pull.actions.merge("squash"));
      expect(result.current.details).toBeNull();
    });

    it("is busy while merging", async () => {
      let done = () => {};
      u.call.mockReturnValue(
        new Promise<void>((resolve) => {
          done = resolve;
        }),
      );
      const { result } = setup();
      let merging = Promise.resolve();
      act(() => {
        merging = result.current.pull.actions.merge("squash");
      });
      await waitFor(() => {
        expect(result.current.pull.busy).toBe("merge");
      });
      done();
      await act(() => merging);
      expect(result.current.pull.busy).toBeNull();
    });
  });

  describe("when GitHub refuses", () => {
    it("loads what's new when the head moved", async () => {
      u.call.mockRejectedValue(new GitHubError(409, "Head moved"));
      const { result, say, reloadAll } = setup();
      await act(() => result.current.pull.actions.merge("squash"));
      expect(say).toHaveBeenCalledWith("New commits arrived: look at them before merging");
      expect(reloadAll).toHaveBeenCalledOnce();
    });

    it("says why otherwise", async () => {
      const { result, say, reloadAll } = setup();
      u.call.mockRejectedValueOnce(new GitHubError(422, "Not mergeable"));
      await act(() => result.current.pull.actions.merge("squash"));
      expect(say).toHaveBeenLastCalledWith("Not mergeable");
      u.call.mockRejectedValueOnce("Gone");
      await act(() => result.current.pull.actions.merge("squash"));
      expect(say).toHaveBeenLastCalledWith("Gone");
      expect(reloadAll).not.toHaveBeenCalled();
    });
  });

  it("turns auto-merge on, by its method, and off", async () => {
    const { result, say } = setup();
    await act(() => result.current.pull.actions.autoMerge("squash"));
    expect(manageNow.autoMerge).toEqual({ method: "SQUASH", by: null });
    await act(() => result.current.pull.actions.autoMerge("rebase"));
    expect(manageNow.autoMerge?.method).toBe("REBASE");
    await act(() => result.current.pull.actions.autoMerge("merge"));
    expect(manageNow.autoMerge?.method).toBe("MERGE");
    expect(u.call).toHaveBeenCalledWith("enableAutoMerge", "PR_1", "merge");
    expect(say).toHaveBeenCalledWith("Auto-merge enabled");
    await act(() => result.current.pull.actions.disableAutoMerge());
    expect(manageNow.autoMerge).toBeNull();
    expect(say).toHaveBeenLastCalledWith("Auto-merge disabled");
  });

  it("adds to the merge queue and takes off it", async () => {
    const { result, say } = setup();
    await act(() => result.current.pull.actions.enqueue());
    expect(manageNow.isInMergeQueue).toBe(true);
    expect(say).toHaveBeenLastCalledWith("Added to the merge queue");
    manageNow = { ...manageNow, queuePosition: 2 };
    await act(() => result.current.pull.actions.dequeue());
    expect(manageNow).toMatchObject({ isInMergeQueue: false, queuePosition: null });
    expect(say).toHaveBeenLastCalledWith("Removed from the merge queue");
  });

  it("updates the branch", async () => {
    const { result, say } = setup();
    await act(() => result.current.pull.actions.updateBranch("REBASE"));
    expect(u.call).toHaveBeenCalledWith("updateBranch", "PR_1", "REBASE");
    expect(manageNow.viewerCanUpdateBranch).toBe(false);
    expect(say).toHaveBeenCalledWith("Branch updated");
  });

  it("marks it ready or a draft, closes and reopens it", async () => {
    const { result, say } = setup({ ...DETAILS, isDraft: true });
    await act(() => result.current.pull.actions.ready());
    expect(result.current.details?.isDraft).toBe(false);
    expect(say).toHaveBeenLastCalledWith("Ready for review");
    await act(() => result.current.pull.actions.draft());
    expect(result.current.details?.isDraft).toBe(true);
    expect(say).toHaveBeenLastCalledWith("Converted to a draft");
    await act(() => result.current.pull.actions.close());
    expect(result.current.details?.state).toBe("CLOSED");
    expect(say).toHaveBeenLastCalledWith("Pull request closed");
    await act(() => result.current.pull.actions.reopen());
    expect(result.current.details?.state).toBe("OPEN");
    expect(say).toHaveBeenLastCalledWith("Pull request reopened");
    expect(u.call.mock.calls.map(([name]) => name)).toEqual(["markReady", "convertToDraft", "closePull", "reopenPull"]);
  });

  it("changes nothing once the details are gone", async () => {
    const { result } = setup();
    const { actions } = result.current.pull;
    for (const action of [actions.ready, actions.draft, actions.close, actions.reopen]) {
      act(() => {
        result.current.setDetails(null);
        void action();
      });
    }
    await settle();
    expect(result.current.details).toBeNull();
  });

  it("does none of those without the details", () => {
    const { result } = setup(null);
    const { actions } = result.current.pull;
    for (const action of [
      () => actions.autoMerge("squash"),
      actions.disableAutoMerge,
      actions.enqueue,
      actions.dequeue,
      () => actions.updateBranch("MERGE"),
      actions.ready,
      actions.draft,
      actions.close,
      actions.reopen,
    ])
      expect(action()).toBeNull();
  });

  it("deletes the branch after asking", async () => {
    const { result, say } = setup({ ...DETAILS, state: "MERGED" });
    confirmAnswer = false;
    await act(() => result.current.pull.actions.deleteBranch());
    expect(u.call).not.toHaveBeenCalled();
    expect(ipc.find(([cmd]) => cmd === "confirm")?.[1]).toEqual({
      title: "Delete the rename branch?",
      message: "Anyone still working on it loses it. GitHub can restore it from the pull request.",
      ok: "Delete Branch",
    });
    confirmAnswer = true;
    await act(() => result.current.pull.actions.deleteBranch());
    expect(u.call).toHaveBeenCalledWith("deleteBranch", "rename");
    expect(manageNow.headRefExists).toBe(false);
    expect(say).toHaveBeenCalledWith("Branch deleted");
  });

  it("doesn't delete the branch without the details or the state", async () => {
    u.manage = null;
    const noState = setup();
    await act(() => noState.result.current.pull.actions.deleteBranch());
    u.manage = MANAGE;
    const noDetails = setup(null);
    await act(() => noDetails.result.current.pull.actions.deleteBranch());
    expect(ipc.filter(([cmd]) => cmd === "confirm")).toEqual([]);
  });

  it("re-runs the failed checks' runs, showing them queued, and looks again after", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const checks = setChecks([
      check("lint", "failure", 1),
      check("test", "success", 1),
      check("build", "failure", 2),
      check("deploy", "success", 3),
      check("status", "failure", null),
    ]);
    const { result, say } = setup();
    await act(async () => {
      result.current.pull.actions.rerun("failed");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(u.rerunFailed.mock.calls.map(([, run]) => run)).toEqual([1, 2]);
    expect(checksNow?.map((c) => [c.name, c.state, c.detail])).toEqual([
      ["lint", "pending", "queued"],
      ["test", "success", ""],
      ["build", "pending", "queued"],
      ["deploy", "success", ""],
      ["status", "failure", ""],
    ]);
    expect(say).toHaveBeenCalledWith("Re-running");
    expect(checks.reload).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(checks.reload).toHaveBeenCalledWith(true);
  });

  it("re-runs every run, and nothing when there's none", async () => {
    setChecks([check("lint", "success", 1), check("e2e", "pending", 2)]);
    const { result } = setup();
    await act(async () => {
      result.current.pull.actions.rerun("all");
      await Promise.resolve();
    });
    expect(u.rerunAll.mock.calls.map(([, run]) => run)).toEqual([1]);
    expect(checksNow?.map((c) => c.state)).toEqual(["pending", "pending"]);
    result.current.pull.actions.rerun("failed");
    expect(u.rerunFailed).not.toHaveBeenCalled();
  });

  it("leaves the checks alone when there are none yet", async () => {
    setChecks([check("lint", "failure", 1)]);
    checksNow = null;
    const { result } = setup();
    await act(async () => {
      result.current.pull.actions.rerun("failed");
      await Promise.resolve();
    });
    expect(checksNow).toBeNull();
  });

  it("approves the runs waiting, and looks at the checks again after", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const checks = setChecks([]);
    u.awaitingApproval.mockResolvedValue([
      { id: 7, name: "CI" },
      { id: 8, name: "Lint" },
    ]);
    const { result, say } = setup();
    await waitFor(() => {
      expect(result.current.pull.awaiting).toHaveLength(2);
    });
    await act(async () => {
      result.current.pull.actions.approve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(u.approveRun.mock.calls.map(([, id]) => id)).toEqual([7, 8]);
    expect(result.current.pull.awaiting).toEqual([]);
    expect(say).toHaveBeenCalledWith("Approved to run");
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(checks.reload).toHaveBeenCalledWith(true);
  });

  describe("the menu bar's commands", () => {
    it("are allowed as the pull request and the state allow", () => {
      setChecks([check("lint", "failure", 1)]);
      const { result } = setup({ ...DETAILS, isDraft: true });
      expect(result.current.pull.allowed).toEqual({
        "update-branch": true,
        "auto-merge": false,
        ready: true,
        draft: false,
        close: true,
        reopen: false,
        "delete-branch": false,
        "rerun-failed": true,
        "all-changes": false,
        "since-review": true,
      });
    });

    it("allow reopening a closed one and deleting its branch", () => {
      u.mergeView.mockReturnValue({ ...VIEW, canUpdateBranch: false, canDisableAutoMerge: true });
      u.commits = null;
      const { result } = setup({ ...DETAILS, state: "CLOSED" });
      expect(result.current.pull.allowed).toMatchObject({
        "update-branch": false,
        "auto-merge": true,
        ready: false,
        draft: false,
        close: false,
        reopen: true,
        "delete-branch": true,
        "rerun-failed": false,
        "since-review": false,
      });
    });

    it("allow nothing that needs the details or the state without them", () => {
      u.manage = null;
      u.commits = null;
      const { result } = setup(null);
      expect(Object.values(result.current.pull.allowed).filter(Boolean)).toEqual([]);
    });

    it("run the actions", async () => {
      u.mergeView.mockReturnValue({ ...VIEW, canAutoMerge: true });
      setChecks([check("lint", "failure", 1)]);
      const { result } = setup();
      const { menu } = result.current.pull;
      await act(async () => {
        menu["update-branch"]?.();
        menu["auto-merge"]?.();
        menu.ready?.();
        menu.draft?.();
        menu.close?.();
        menu.reopen?.();
        menu["rerun-failed"]?.();
        await Promise.resolve();
      });
      expect(u.call.mock.calls.map(([name]) => name)).toEqual([
        "updateBranch",
        "enableAutoMerge",
        "markReady",
        "convertToDraft",
        "closePull",
        "reopenPull",
      ]);
      expect(u.call).toHaveBeenCalledWith("enableAutoMerge", "PR_1", "squash");
      expect(u.rerunFailed).toHaveBeenCalledOnce();
      await act(async () => {
        menu["delete-branch"]?.();
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(u.call).toHaveBeenCalledWith("deleteBranch", "rename");
      });
    });

    it("turn auto-merge off when it's on, and need a method to turn it on", async () => {
      u.mergeView.mockReturnValue({ ...VIEW, canDisableAutoMerge: true });
      const on = setup();
      await act(async () => {
        on.result.current.pull.menu["auto-merge"]?.();
        await Promise.resolve();
      });
      expect(u.call).toHaveBeenCalledWith("disableAutoMerge", "PR_1");
      u.call.mockClear();
      u.mergeView.mockReturnValue(VIEW);
      const none = setup({ ...DETAILS, mergeMethods: [] });
      none.result.current.pull.menu["auto-merge"]?.();
      expect(u.call).not.toHaveBeenCalled();
    });

    it("show all the changes or only those since your review", () => {
      const { result } = setup();
      act(() => {
        result.current.pull.menu["since-review"]?.();
      });
      expect(result.current.pull.range).toEqual({ from: "c1", to: "c2" });
      expect(result.current.pull.allowed["all-changes"]).toBe(true);
      act(() => {
        result.current.pull.menu["all-changes"]?.();
      });
      expect(result.current.pull.range).toBeNull();
    });

    it("show nothing new since your review when there's nothing", () => {
      u.commits = { ...COMMITS, reviewed: "c2" };
      const { result } = setup();
      act(() => {
        result.current.pull.menu["since-review"]?.();
      });
      expect(result.current.pull.range).toBeNull();
    });
  });
});
