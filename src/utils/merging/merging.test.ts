import { describe, expect, it } from "vitest";

import type { Manage } from "@/utils/manage/manage";
import { defaultMessage, mergeView } from "@/utils/merging/merging";

const manage = (over: Partial<Manage> = {}): Manage => ({
  viewerPermission: "WRITE",
  autoMergeAllowed: true,
  deleteBranchOnMerge: false,
  squashTitle: "PR_TITLE",
  squashMessage: "COMMIT_MESSAGES",
  mergeTitle: "MERGE_MESSAGE",
  mergeMessage: "PR_TITLE",
  orgOwned: true,
  body: "The body",
  isMergeQueueEnabled: false,
  isInMergeQueue: false,
  queuePosition: null,
  viewerCanUpdateBranch: false,
  viewerCanEnableAutoMerge: true,
  viewerCanDisableAutoMerge: true,
  viewerCanMergeAsAdmin: false,
  viewerCanDeleteHeadRef: true,
  autoMerge: null,
  headRefExists: true,
  headOwner: "ana",
  headRepo: "web",
  rule: null,
  labels: [],
  assignees: [],
  milestone: null,
  issues: [],
  reviewers: [],
  deployments: [],
  ...over,
});
type D = Parameters<typeof mergeView>[0]["details"];
const details = (over: Partial<D> = {}): D => ({
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: "APPROVED",
  mergeMethods: ["squash", "merge"],
  ...over,
});
const view = (d: Partial<D> = {}, m: Partial<Manage> = {}, extra = { failing: 0, pending: 0, unresolved: 0 }) =>
  mergeView({ details: details(d), manage: manage(m), ...extra });

describe("merge state", () => {
  it("lets anyone with write access merge a clean pull request, not only its author", () => {
    expect(view()).toMatchObject({ status: "ready", tone: "success", canMerge: true, canAutoMerge: false });
    expect(view({}, { viewerPermission: "TRIAGE" }).canMerge).toBe(false);
    expect(view({}, { viewerPermission: "MAINTAIN" }).canMerge).toBe(true);
  });

  it("merges with pre-receive hooks and with failing checks that aren't required", () => {
    expect(view({ mergeStateStatus: "HAS_HOOKS" })).toMatchObject({ status: "ready", canMerge: true });
    expect(view({ mergeStateStatus: "UNSTABLE" })).toMatchObject({
      status: "unstable",
      tone: "warning",
      canMerge: true,
      canAutoMerge: true,
    });
  });

  it("says why it's blocked and offers auto-merge, or bypassing to an admin", () => {
    const blocked = view(
      { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" },
      {},
      { failing: 1, pending: 2, unresolved: 0 },
    );
    expect(blocked).toMatchObject({ status: "blocked", canMerge: false, canAutoMerge: true, canBypass: false });
    expect(blocked.reasons).toEqual(["approvals", "failing", "pending"]);
    expect(view({ mergeStateStatus: "BLOCKED" }, { viewerCanMergeAsAdmin: true }).canBypass).toBe(true);
    expect(view({ mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }).reasons).toEqual(["changes"]);
  });

  it("names a code owner's review and unresolved conversations when the rules ask for them", () => {
    const m = {
      rule: { approvals: 1, codeOwners: true, checks: [], conversations: true, linear: false },
      reviewers: [
        {
          key: "team:core",
          actor: null,
          team: { slug: "core", name: "Core", combinedSlug: "a/core" },
          state: null,
          requested: true,
          codeOwner: true,
        },
      ],
    };
    expect(
      view({ mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }, m, {
        failing: 0,
        pending: 0,
        unresolved: 2,
      }).reasons,
    ).toEqual(["codeOwners", "conversations"]);
  });

  it("offers updating an out-of-date branch, and shows conflicts", () => {
    expect(view({ mergeStateStatus: "BEHIND" }, { viewerCanUpdateBranch: true })).toMatchObject({
      status: "behind",
      canMerge: false,
      canUpdateBranch: true,
      reasons: ["behind"],
    });
    expect(
      view({ mergeStateStatus: "DIRTY", mergeable: "CONFLICTING" }, { viewerCanMergeAsAdmin: true }),
    ).toMatchObject({
      status: "conflicts",
      tone: "destructive",
      canMerge: false,
      canBypass: false,
      canAutoMerge: false,
    });
  });

  it("goes through the merge queue when the branch has one", () => {
    expect(view({}, { isMergeQueueEnabled: true })).toMatchObject({ canMerge: false, canEnqueue: true });
    expect(view({}, { isMergeQueueEnabled: true, isInMergeQueue: true, queuePosition: 2 })).toMatchObject({
      status: "queued",
      canEnqueue: false,
      canDequeue: true,
    });
  });

  it("shows auto-merge that's on, and lets it be turned off", () => {
    expect(view({ mergeStateStatus: "BLOCKED" }, { autoMerge: { method: "SQUASH", by: "ana" } })).toMatchObject({
      status: "auto",
      canAutoMerge: false,
      canDisableAutoMerge: true,
    });
  });

  it("waits while GitHub works it out, and offers nothing on drafts, merged or closed ones", () => {
    expect(view({ mergeStateStatus: "UNKNOWN", mergeable: "UNKNOWN" })).toMatchObject({
      status: "checking",
      canMerge: false,
    });
    expect(view({ isDraft: true })).toMatchObject({ status: "draft", canMerge: false, canAutoMerge: false });
    expect(view({ state: "MERGED" })).toMatchObject({ status: "merged", canMerge: false });
    expect(view({ state: "CLOSED" })).toMatchObject({ status: "closed", canUpdateBranch: false });
  });

  it("can't merge where the repository allows no method", () => {
    expect(view({ mergeMethods: [] }).canMerge).toBe(false);
  });
});

describe("commit message", () => {
  const pr = { number: 7, title: "Keep the code", headRefName: "ana/keep" };
  const commits = [
    { headline: "First", body: "" },
    { headline: "Second", body: "Why it changed" },
  ];

  it("writes a squash commit as the repository's settings ask", () => {
    expect(defaultMessage("squash", manage(), pr, commits)).toEqual({
      title: "Keep the code (#7)",
      body: "* First\n\n* Second\n\nWhy it changed",
    });
    expect(defaultMessage("squash", manage({ squashMessage: "PR_BODY" }), pr, commits).body).toBe("The body");
    expect(defaultMessage("squash", manage({ squashMessage: "BLANK" }), pr, commits).body).toBe("");
    expect(defaultMessage("squash", manage({ squashTitle: "COMMIT_OR_PR_TITLE" }), pr, [commits[1]!])).toEqual({
      title: "Second (#7)",
      body: "Why it changed",
    });
  });

  it("writes a merge commit as the repository's settings ask", () => {
    expect(defaultMessage("merge", manage(), pr, commits)).toEqual({
      title: "Merge pull request #7 from ana/ana/keep",
      body: "Keep the code",
    });
    expect(defaultMessage("merge", manage({ mergeTitle: "PR_TITLE", mergeMessage: "PR_BODY" }), pr, commits)).toEqual({
      title: "Keep the code (#7)",
      body: "The body",
    });
  });

  it("leaves rebasing to the commits' own messages", () => {
    expect(defaultMessage("rebase", manage(), pr, commits)).toEqual({ title: "", body: "" });
  });
});
