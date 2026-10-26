// Tests only: a pull request as the review window holds it (usePull's result and the details it
// started from), every part typed and plain, every action a spy that resolves. Each test changes
// only what it's about.

import { vi } from "vite-plus/test";

import type { Pull } from "@/hooks/use-pull/use-pull";
import type { CheckItem } from "@/utils/checks/checks";
import type { Commit } from "@/utils/commits/commits";
import type { Details } from "@/utils/details/details";
import type { Manage } from "@/utils/manage/manage";
import type { MergeView } from "@/utils/merging/merging";

export const octocat = { __typename: "User", login: "octocat", name: "Ana Lima", avatarUrl: "https://a/octocat" };

export function fakeDetails(extra: Partial<Details> = {}): Details {
  return {
    id: "PR_1",
    number: 42,
    title: "Keep the promo code through checkout",
    url: "https://github.com/acme/shop/pull/42",
    html: "<p>Fixes the promo code.</p>",
    owner: "acme",
    repo: "shop",
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    viewerDidAuthor: false,
    viewerCanUpdate: true,
    baseRefName: "main",
    headRefName: "promo-keep",
    headRefOid: "abc1234def5678",
    updatedAt: "2026-10-20T10:00:00Z",
    additions: 12,
    deletions: 3,
    changedFiles: 2,
    createdAt: "2026-10-19T10:00:00Z",
    author: octocat,
    reviewDecision: null,
    reviewers: [],
    checks: [],
    files: [],
    entries: [],
    mergeMethods: ["squash", "merge", "rebase"],
    ...extra,
  };
}

export function fakeManage(extra: Partial<Manage> = {}): Manage {
  return {
    viewerPermission: "WRITE",
    autoMergeAllowed: true,
    deleteBranchOnMerge: false,
    squashTitle: "PR_TITLE",
    squashMessage: "PR_BODY",
    mergeTitle: "MERGE_MESSAGE",
    mergeMessage: "PR_TITLE",
    orgOwned: true,
    body: "Fixes the promo code.",
    isMergeQueueEnabled: false,
    isInMergeQueue: false,
    queuePosition: null,
    viewerCanUpdateBranch: false,
    viewerCanEnableAutoMerge: true,
    viewerCanDisableAutoMerge: false,
    viewerCanMergeAsAdmin: false,
    viewerCanDeleteHeadRef: true,
    autoMerge: null,
    headRefExists: true,
    headOwner: "acme",
    headRepo: "shop",
    rule: null,
    labels: [],
    assignees: [],
    milestone: null,
    issues: [],
    reviewers: [],
    deployments: [],
    ...extra,
  };
}

export function fakeView(extra: Partial<MergeView> = {}): MergeView {
  return {
    status: "ready",
    tone: "success",
    reasons: [],
    canMerge: true,
    canBypass: false,
    canAutoMerge: false,
    canDisableAutoMerge: false,
    canEnqueue: false,
    canDequeue: false,
    canUpdateBranch: false,
    ...extra,
  };
}

export function fakeCheck(extra: Partial<CheckItem> = {}): CheckItem {
  return {
    id: "build",
    kind: "run",
    name: "build",
    workflow: "CI",
    state: "success",
    detail: "success",
    description: null,
    url: "https://github.com/acme/shop/actions/runs/1/job/11",
    required: false,
    startedAt: "2026-10-20T10:00:00Z",
    completedAt: "2026-10-20T10:02:05Z",
    job: 11,
    run: 1,
    ...extra,
  };
}

export function fakeCommit(extra: Partial<Commit> = {}): Commit {
  return {
    oid: "abc1234def5678",
    short: "abc1234",
    headline: "Keep the promo code",
    body: "",
    at: "2026-10-20T10:00:00Z",
    author: { login: "octocat", name: "Ana Lima", avatarUrl: "https://a/octocat" },
    verified: null,
    ci: null,
    parent: "base000",
    ...extra,
  };
}

const resolved = () => Promise.resolve();

export function fakeActions(extra: Partial<Pull["actions"]> = {}): Pull["actions"] {
  return {
    merge: vi.fn<Pull["actions"]["merge"]>(resolved),
    autoMerge: vi.fn<Pull["actions"]["autoMerge"]>(resolved),
    disableAutoMerge: vi.fn<Pull["actions"]["disableAutoMerge"]>(resolved),
    enqueue: vi.fn<Pull["actions"]["enqueue"]>(resolved),
    dequeue: vi.fn<Pull["actions"]["dequeue"]>(resolved),
    updateBranch: vi.fn<Pull["actions"]["updateBranch"]>(resolved),
    ready: vi.fn<Pull["actions"]["ready"]>(resolved),
    draft: vi.fn<Pull["actions"]["draft"]>(resolved),
    close: vi.fn<Pull["actions"]["close"]>(resolved),
    reopen: vi.fn<Pull["actions"]["reopen"]>(resolved),
    deleteBranch: vi.fn<Pull["actions"]["deleteBranch"]>(resolved),
    rerun: vi.fn<Pull["actions"]["rerun"]>(),
    approve: vi.fn<Pull["actions"]["approve"]>(),
    ...extra,
  };
}

export function fakeChecks(extra: Partial<Pull["checks"]> = {}): Pull["checks"] {
  return {
    checks: [],
    loaded: true,
    running: false,
    reload: vi.fn<Pull["checks"]["reload"]>(resolved),
    setChecks: vi.fn<Pull["checks"]["setChecks"]>(),
    ...extra,
  };
}

export function fakePull(extra: Partial<Pull> = {}): Pull {
  return {
    manage: fakeManage(),
    patch: vi.fn<Pull["patch"]>(),
    reloadManage: vi.fn<Pull["reloadManage"]>(resolved),
    commits: null,
    since: null,
    checks: fakeChecks(),
    awaiting: [],
    range: null,
    setRange: vi.fn<Pull["setRange"]>(),
    view: fakeView(),
    busy: null,
    actions: fakeActions(),
    events: [],
    older: null,
    loadOlder: vi.fn<Pull["loadOlder"]>(resolved),
    unresolved: 0,
    allowed: {},
    menu: {},
    revalidate: vi.fn<Pull["revalidate"]>(resolved),
    ...extra,
  };
}
