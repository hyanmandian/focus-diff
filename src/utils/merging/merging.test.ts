import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vite-plus/test";

import type { Manage } from "@/utils/manage/manage";
import {
  defaultMessage,
  deleteBranch,
  dequeue,
  disableAutoMerge,
  enableAutoMerge,
  enqueue,
  loadMergeState,
  mergePull,
  mergeView,
  updateBranch,
} from "@/utils/merging/merging";

type Call = { cmd: string; fields: Record<string, unknown> };
const fields = (args: InvokeArgs | undefined): Record<string, unknown> =>
  args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array ? {} : args;
const ok = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

/** Rust answering each call with the same reply, keeping what was asked. */
function rust(reply: unknown = ok({ data: {} })) {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    calls.push({ cmd, fields: fields(args) });
    return reply;
  });
  return calls;
}
/** What each call sent: its method, path and body. */
const sent = (calls: Call[]) =>
  calls.map((c) => [c.fields.method, c.fields.path, JSON.parse(String(c.fields.body)) as unknown]);

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
type Counts = { failing: number; pending: number; unresolved: number };
const view = (d: Partial<D> = {}, m: Partial<Manage> = {}, extra: Partial<Counts> = {}) =>
  mergeView({ details: details(d), manage: manage(m), failing: 0, pending: 0, unresolved: 0, ...extra });

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
    expect(view({ mergeMethods: [] })).toMatchObject({ canMerge: false, canBypass: false, canAutoMerge: false });
  });

  it("asks for approvals when the code owners who must review weren't asked", () => {
    const rule = { approvals: 1, codeOwners: true, checks: [], conversations: false, linear: false };
    const owner = {
      key: "user:bo",
      actor: { login: "bo", avatarUrl: "", name: null },
      team: null,
      state: null,
      requested: false,
      codeOwner: true,
    };
    const blocked = { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" } as const;
    expect(view(blocked, { rule, reviewers: [owner] }, { unresolved: 3 }).reasons).toEqual(["approvals"]);
    expect(view(blocked, { rule, reviewers: [{ ...owner, codeOwner: false, requested: true }] }).reasons).toEqual([
      "approvals",
    ]);
  });

  it("lets an admin bypass, but not while GitHub works it out or it's queued", () => {
    const admin = { viewerCanMergeAsAdmin: true };
    expect(view({ mergeStateStatus: "UNKNOWN" }, admin).canBypass).toBe(false);
    expect(view({}, { ...admin, isMergeQueueEnabled: true }).canBypass).toBe(true);
    expect(view({}, { ...admin, isMergeQueueEnabled: true, isInMergeQueue: true }).canBypass).toBe(false);
    expect(view({ mergeStateStatus: "BLOCKED" }, { ...admin, viewerPermission: "READ" })).toMatchObject({
      canBypass: true,
      canMerge: false,
    });
  });

  it("offers auto-merge only where the repository and the person can, and there's no queue", () => {
    const blocked = { mergeStateStatus: "BLOCKED" } as const;
    expect(view(blocked).canAutoMerge).toBe(true);
    expect(view({ mergeStateStatus: "BEHIND" }).canAutoMerge).toBe(true);
    expect(view({ mergeStateStatus: "UNKNOWN" }).canAutoMerge).toBe(true);
    expect(view(blocked, { autoMergeAllowed: false }).canAutoMerge).toBe(false);
    expect(view(blocked, { viewerCanEnableAutoMerge: false }).canAutoMerge).toBe(false);
    expect(view(blocked, { isMergeQueueEnabled: true }).canAutoMerge).toBe(false);
    expect(view({ mergeStateStatus: "BEHIND", mergeable: "CONFLICTING" }).canAutoMerge).toBe(false);
  });

  it("lets auto-merge be turned off only by who may", () => {
    expect(
      view({}, { autoMerge: { method: "SQUASH", by: "ana" }, viewerCanDisableAutoMerge: false }).canDisableAutoMerge,
    ).toBe(false);
    expect(view({ state: "MERGED" }, { autoMerge: null }).canDisableAutoMerge).toBe(false);
  });

  it("needs write access for the merge queue, and no conflicts to join it", () => {
    const queue = { isMergeQueueEnabled: true };
    expect(view({}, { ...queue, viewerPermission: "READ" })).toMatchObject({ canEnqueue: false, canDequeue: false });
    expect(view({ mergeable: "CONFLICTING" }, queue).canEnqueue).toBe(false);
    expect(view({}, { ...queue, isInMergeQueue: true, viewerPermission: "READ" }).canDequeue).toBe(false);
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
    expect(defaultMessage("squash", manage({ squashTitle: "COMMIT_OR_PR_TITLE" }), pr, commits).title).toBe(
      "Keep the code (#7)",
    );
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
    expect(defaultMessage("merge", manage({ mergeMessage: "BLANK" }), pr, commits).body).toBe("");
  });

  it("leaves rebasing to the commits' own messages", () => {
    expect(defaultMessage("rebase", manage(), pr, commits)).toEqual({ title: "", body: "" });
  });
});

describe("merging on GitHub", () => {
  const pull = { owner: "acme", repo: "web", number: 7, id: "PR_7", headRefOid: "h1" };
  const message = { title: "Fix (#7)", body: "Why" };

  it("asks again for the merge state past Rust's memory", async () => {
    const state = { state: "OPEN", isDraft: false, mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
    const calls = rust(ok({ data: { repository: { pullRequest: state } } }));
    expect(await loadMergeState(pull)).toEqual(state);
    expect(String(calls[0]?.fields.body)).toMatch(/# \d+/u);
    expect(JSON.parse(String(calls[0]?.fields.body))).toMatchObject({
      variables: { owner: "acme", name: "web", number: 7 },
    });
  });

  it("merges the head that was looked at, with its message unless rebasing", async () => {
    const calls = rust(ok({ merged: true }));
    await mergePull(pull, "squash", message);
    await mergePull(pull, "rebase", message);
    await mergePull(pull, "merge");
    expect(sent(calls)).toEqual([
      [
        "PUT",
        "/repos/acme/web/pulls/7/merge",
        { merge_method: "squash", sha: "h1", commit_title: "Fix (#7)", commit_message: "Why" },
      ],
      ["PUT", "/repos/acme/web/pulls/7/merge", { merge_method: "rebase", sha: "h1" }],
      ["PUT", "/repos/acme/web/pulls/7/merge", { merge_method: "merge", sha: "h1" }],
    ]);
  });

  it("turns auto-merge on and off", async () => {
    const calls = rust();
    await enableAutoMerge(pull, "squash", message);
    await enableAutoMerge(pull, "merge");
    await enableAutoMerge(pull, "rebase", message);
    await disableAutoMerge(pull);
    expect(sent(calls).map(([, , body]) => body)).toMatchObject([
      { variables: { id: "PR_7", method: "SQUASH", head: "h1", title: "Fix (#7)", body: "Why" } },
      { variables: { id: "PR_7", method: "MERGE", head: "h1", title: null, body: null } },
      { variables: { id: "PR_7", method: "REBASE", head: "h1", title: null, body: null } },
      { variables: { id: "PR_7" } },
    ]);
    expect(String(calls[3]?.fields.body)).toContain("disablePullRequestAutoMerge");
  });

  it("joins and leaves the merge queue, and updates the branch", async () => {
    const calls = rust();
    await enqueue(pull);
    await dequeue(pull);
    await updateBranch(pull, "REBASE");
    expect(sent(calls).map(([, , body]) => body)).toMatchObject([
      { variables: { id: "PR_7", head: "h1" } },
      { variables: { id: "PR_7" } },
      { variables: { id: "PR_7", head: "h1", how: "REBASE" } },
    ]);
    expect(
      calls.map((c) => /(?:en|de)queuePullRequest|updatePullRequestBranch/u.exec(String(c.fields.body))?.[0]),
    ).toEqual(["enqueuePullRequest", "dequeuePullRequest", "updatePullRequestBranch"]);
  });

  it("deletes the head branch, its name encoded part by part", async () => {
    const calls = rust({ status: 204, body: "" });
    await deleteBranch({ headOwner: "ana", headRepo: "web" }, "ana/fix #2");
    expect(calls[0]?.fields).toMatchObject({ method: "DELETE", path: "/repos/ana/web/git/refs/heads/ana/fix%20%232" });
  });
});
