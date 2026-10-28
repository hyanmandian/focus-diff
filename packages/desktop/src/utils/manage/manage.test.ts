import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { mockCommands } from "@/utils/fake-platform/fake-platform";
import {
  addAssignees,
  addLabels,
  canTriage,
  canWrite,
  closePull,
  convertToDraft,
  labels,
  loadManage,
  milestones,
  people,
  removeAssignees,
  removeLabel,
  removeReviewRequests,
  reopenPull,
  requestReviews,
  reviewerList,
  setMilestone,
  teams,
  useManage,
  type Manage,
  type Permission,
} from "@/utils/manage/manage";
import type { Args } from "@/utils/platform/platform";
import { shelve, shelved } from "@/utils/shelf/shelf";

type Request = { method: string; path: string; body: string };

function sent(args: Args | undefined, key: string): unknown {
  if (args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array)
    return undefined;
  return args[key];
}

function github(answer: (request: Request) => unknown) {
  const asked: Request[] = [];
  mockCommands(async (_cmd, args) => {
    const request = {
      method: String(sent(args, "method")),
      path: String(sent(args, "path")),
      body: String(sent(args, "body")),
    };
    asked.push(request);
    return { status: 200, body: JSON.stringify(await answer(request)) };
  });
  return asked;
}

const ok = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

function heldAnswers() {
  const answers: Array<{ resolve: (value: unknown) => void; reject: (reason: Error) => void }> = [];
  mockCommands(
    () =>
      new Promise((resolve, reject) => {
        answers.push({ resolve, reject });
      }),
  );
  return answers;
}

const sentJson = (request: Request | undefined): unknown => JSON.parse(String(request?.body));

const ref = { owner: "acme", repo: "app", number: 7 };
const user = (login: string) => ({ __typename: "User" as const, login, avatarUrl: "" });

const raw = (pr: Record<string, unknown> = {}, repo: Record<string, unknown> = {}) => ({
  data: {
    repository: {
      viewerPermission: "WRITE",
      autoMergeAllowed: true,
      deleteBranchOnMerge: false,
      squashMergeCommitTitle: "PR_TITLE",
      squashMergeCommitMessage: "PR_BODY",
      mergeCommitTitle: "MERGE_MESSAGE",
      mergeCommitMessage: "PR_TITLE",
      owner: { __typename: "Organization" },
      ...repo,
      pullRequest: {
        body: "Fixes it",
        isMergeQueueEnabled: false,
        isInMergeQueue: false,
        mergeQueueEntry: null,
        viewerCanUpdateBranch: true,
        viewerCanEnableAutoMerge: true,
        viewerCanDisableAutoMerge: false,
        viewerCanMergeAsAdmin: false,
        viewerCanDeleteHeadRef: true,
        autoMergeRequest: null,
        headRef: { id: "REF_1" },
        headRefName: "fix",
        headRepository: { name: "app-fork", owner: { login: "bruno" } },
        baseRef: null,
        labels: { nodes: [{ id: "L1", name: "bug", color: "ff0000", description: null }] },
        assignees: { nodes: [user("ana")] },
        milestone: null,
        closingIssuesReferences: {
          nodes: [
            {
              id: "I1",
              number: 3,
              title: "Broken",
              state: "OPEN",
              stateReason: null,
              url: "https://github.com/acme/app/issues/3",
              repository: { nameWithOwner: "acme/app" },
            },
          ],
        },
        reviewRequests: { nodes: [] },
        latestReviews: { nodes: [{ author: user("carla"), state: "APPROVED" }] },
        commits: { nodes: [] },
        ...pr,
      },
    },
  },
});

const manage = (viewerPermission: Permission | null): Manage => ({
  viewerPermission,
  autoMergeAllowed: false,
  deleteBranchOnMerge: false,
  squashTitle: "PR_TITLE",
  squashMessage: "PR_BODY",
  mergeTitle: "PR_TITLE",
  mergeMessage: "PR_BODY",
  orgOwned: false,
  body: "",
  isMergeQueueEnabled: false,
  isInMergeQueue: false,
  queuePosition: null,
  viewerCanUpdateBranch: false,
  viewerCanEnableAutoMerge: false,
  viewerCanDisableAutoMerge: false,
  viewerCanMergeAsAdmin: false,
  viewerCanDeleteHeadRef: false,
  autoMerge: null,
  headRefExists: true,
  headOwner: "acme",
  headRepo: "app",
  rule: null,
  labels: [],
  assignees: [],
  milestone: null,
  issues: [],
  reviewers: [],
  deployments: [],
});

describe("reviewers", () => {
  it("lists those asked, then those who answered, each once", () => {
    const list = reviewerList(
      [
        { asCodeOwner: false, requestedReviewer: user("ana") },
        {
          asCodeOwner: true,
          requestedReviewer: { __typename: "Team", name: "Core", slug: "core", combinedSlug: "acme/core" },
        },
        { asCodeOwner: false, requestedReviewer: null },
        { asCodeOwner: false, requestedReviewer: { __typename: "Mannequin" } },
      ],
      [
        { author: user("ana"), state: "CHANGES_REQUESTED" },
        { author: user("bruno"), state: "APPROVED" },
        { author: null, state: "COMMENTED" },
      ],
    );
    expect(list.map((r) => [r.key, r.state, r.requested, r.codeOwner])).toEqual([
      ["ana", "CHANGES_REQUESTED", true, false],
      ["team:core", null, true, true],
      ["bruno", "APPROVED", false, false],
    ]);
    expect(list[1]).toMatchObject({ actor: null, team: { slug: "core", name: "Core", combinedSlug: "acme/core" } });
  });
});

describe("permissions", () => {
  it("knows write from triage from read", () => {
    expect([
      canWrite(manage("ADMIN")),
      canWrite(manage("MAINTAIN")),
      canWrite(manage("WRITE")),
      canWrite(manage("TRIAGE")),
      canWrite(null),
    ]).toEqual([true, true, true, false, false]);
    expect([canTriage(manage("ADMIN")), canTriage(manage("TRIAGE")), canTriage(manage("READ"))]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("loading what's around a pull request", () => {
  it("reads the repository's settings and the pull request's state", async () => {
    const asked = github(() => raw());
    expect(await loadManage(ref)).toEqual({
      viewerPermission: "WRITE",
      autoMergeAllowed: true,
      deleteBranchOnMerge: false,
      squashTitle: "PR_TITLE",
      squashMessage: "PR_BODY",
      mergeTitle: "MERGE_MESSAGE",
      mergeMessage: "PR_TITLE",
      orgOwned: true,
      body: "Fixes it",
      isMergeQueueEnabled: false,
      isInMergeQueue: false,
      queuePosition: null,
      viewerCanUpdateBranch: true,
      viewerCanEnableAutoMerge: true,
      viewerCanDisableAutoMerge: false,
      viewerCanMergeAsAdmin: false,
      viewerCanDeleteHeadRef: true,
      autoMerge: null,
      headRefExists: true,
      headOwner: "bruno",
      headRepo: "app-fork",
      rule: null,
      labels: [{ id: "L1", name: "bug", color: "ff0000", description: null }],
      assignees: [user("ana")],
      milestone: null,
      issues: [
        {
          id: "I1",
          number: 3,
          title: "Broken",
          state: "OPEN",
          stateReason: null,
          url: "https://github.com/acme/app/issues/3",
          repo: "acme/app",
        },
      ],
      reviewers: [
        { key: "carla", actor: user("carla"), team: null, state: "APPROVED", requested: false, codeOwner: false },
      ],
      deployments: [],
    });
    expect(sentJson(asked[0])).toMatchObject({ variables: { owner: "acme", name: "app", number: 7 } });
  });

  it("reads the merge queue, auto-merge, branch rules and deployments", async () => {
    github(() =>
      raw(
        {
          isInMergeQueue: true,
          mergeQueueEntry: { position: 2 },
          autoMergeRequest: { mergeMethod: "SQUASH", enabledBy: { login: "ana" } },
          headRef: null,
          headRepository: null,
          baseRef: {
            refUpdateRule: {
              requiredApprovingReviewCount: 2,
              requiresCodeOwnerReviews: true,
              requiredStatusCheckContexts: ["ci", null],
              requiresConversationResolution: true,
              requiresLinearHistory: false,
            },
          },
          commits: {
            nodes: [
              {
                commit: {
                  deployments: {
                    nodes: [
                      {
                        id: "D1",
                        environment: "preview",
                        state: "ACTIVE",
                        createdAt: "2026-01-01T00:00:00Z",
                        latestStatus: { state: "SUCCESS", environmentUrl: "https://preview.acme.dev", logUrl: "" },
                      },
                      {
                        id: "D2",
                        environment: null,
                        state: "PENDING",
                        createdAt: "2026-01-02T00:00:00Z",
                        latestStatus: null,
                      },
                    ],
                  },
                },
              },
            ],
          },
        },
        { owner: { __typename: "User" } },
      ),
    );
    const m = await loadManage(ref);
    expect(m).toMatchObject({
      orgOwned: false,
      isInMergeQueue: true,
      queuePosition: 2,
      autoMerge: { method: "SQUASH", by: "ana" },
      headRefExists: false,
      headOwner: "acme",
      headRepo: "app",
      rule: { approvals: 2, codeOwners: true, checks: ["ci"], conversations: true, linear: false },
    });
    expect(m.deployments).toEqual([
      {
        id: "D1",
        environment: "preview",
        state: "SUCCESS",
        url: "https://preview.acme.dev",
        logUrl: null,
        at: "2026-01-01T00:00:00Z",
      },
      { id: "D2", environment: "", state: "PENDING", url: null, logUrl: null, at: "2026-01-02T00:00:00Z" },
    ]);
  });

  it("reads rules without counts or checks, auto-merge by no one, and commits without deployments", async () => {
    github(() =>
      raw({
        autoMergeRequest: { mergeMethod: "MERGE", enabledBy: null },
        baseRef: {
          refUpdateRule: {
            requiredApprovingReviewCount: null,
            requiresCodeOwnerReviews: false,
            requiredStatusCheckContexts: null,
            requiresConversationResolution: false,
            requiresLinearHistory: true,
          },
        },
        commits: { nodes: [{ commit: { deployments: null } }] },
      }),
    );
    expect(await loadManage(ref)).toMatchObject({
      autoMerge: { method: "MERGE", by: null },
      rule: { approvals: 0, checks: [], linear: true },
      deployments: [],
    });
  });

  it("asks past Rust's memory of the last answer when told to", async () => {
    const asked = github(() => raw());
    await loadManage(ref, true);
    expect(sentJson(asked[0])).toMatchObject({ query: expect.stringMatching(/# \d+$/u) as unknown });
  });
});

describe("the hook", () => {
  it("shows the copy kept from last time, then GitHub's", async () => {
    shelve("manage:PR_1", manage("READ"));
    github(() => raw());
    const { result } = renderHook(() => useManage("PR_1", ref));
    expect(result.current.manage).toMatchObject({ viewerPermission: "READ" });
    await waitFor(() => {
      expect(result.current.manage).toMatchObject({ viewerPermission: "WRITE" });
    });
    expect(shelved("manage:PR_1")).toMatchObject({ value: { viewerPermission: "WRITE" } });
    expect(result.current.error).toBeNull();
  });

  it("changes it at once with a patch, and only once there's something to change", async () => {
    mockCommands(() => {
      throw new Error("not yet");
    });
    const { result } = renderHook(() => useManage("PR_1", ref));
    act(() => {
      result.current.patch((m) => ({ ...m, body: "changed" }));
    });
    expect(result.current.manage).toBeNull();
    github(() => raw());
    await act(() => result.current.reload());
    act(() => {
      result.current.patch((m) => ({ ...m, body: "changed" }));
    });
    expect(result.current.manage).toMatchObject({ body: "changed" });
  });

  it("says what went wrong", async () => {
    mockCommands(() => {
      throw new Error("Bad credentials");
    });
    const { result } = renderHook(() => useManage("PR_1", ref));
    await waitFor(() => {
      expect(result.current.error).toBe("Bad credentials");
    });
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Rust's command errors reach the page as plain strings
    mockCommands(() => Promise.reject("offline"));
    await act(() => result.current.reload());
    expect(result.current.error).toBe("offline");
  });

  it("asks again for another pull request, not for the same one", async () => {
    const asked = github(() => raw());
    const { result, rerender } = renderHook(({ id, pull }) => useManage(id, pull), {
      initialProps: { id: "PR_1", pull: ref },
    });
    await waitFor(() => {
      expect(result.current.manage).not.toBeNull();
    });
    rerender({ id: "PR_1", pull: ref });
    expect(asked).toHaveLength(1);
    rerender({ id: "PR_2", pull: { ...ref, number: 8 } });
    await waitFor(() => {
      expect(asked).toHaveLength(2);
    });
    expect(sentJson(asked[1])).toMatchObject({ variables: { number: 8 } });
  });

  it("keeps only the latest answer when they come out of order", async () => {
    const answers = heldAnswers();
    const { result } = renderHook(() => useManage("PR_1", ref));
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    let second: Promise<void> | undefined;
    act(() => {
      second = result.current.reload();
    });
    answers[1]!.resolve(ok(raw({ body: "latest" })));
    await act(() => second);
    answers[0]!.resolve(ok(raw({ body: "stale" })));
    await act(() => vi.waitFor(() => {}));
    expect(result.current.manage).toMatchObject({ body: "latest" });
  });

  it("ignores a stale failure", async () => {
    const answers = heldAnswers();
    const { result } = renderHook(() => useManage("PR_1", ref));
    await waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    let second: Promise<void> | undefined;
    act(() => {
      second = result.current.reload(true);
    });
    answers[1]!.resolve(ok(raw()));
    await act(() => second);
    answers[0]!.reject(new Error("too late"));
    await act(() => vi.waitFor(() => {}));
    expect(result.current.error).toBeNull();
    expect(result.current.manage).not.toBeNull();
  });
});

const page = (n: number, hasNextPage: boolean) => ({
  data: {
    repository: {
      labels: {
        pageInfo: { hasNextPage, endCursor: `c${n}` },
        nodes: [{ id: `L${n}`, name: `l${n}`, color: "000000", description: null }],
      },
    },
  },
});

describe("lists to pick from", () => {
  it("lists the people, kept a day, and searches past them", async () => {
    const asked = github(() => ({ data: { repository: { assignableUsers: { nodes: [user("ana")] } } } }));
    const onValue = vi.fn<(list: unknown[]) => void>();
    await people(ref, "", onValue);
    await people(ref, "", onValue);
    expect(asked).toHaveLength(1);
    expect(sentJson(asked[0])).toMatchObject({ variables: { owner: "acme", name: "app", q: null } });
    await people(ref, "an", onValue);
    expect(sentJson(asked[1])).toMatchObject({ variables: { q: "an" } });
    expect(onValue).toHaveBeenCalledTimes(3);
    expect(onValue).toHaveBeenLastCalledWith([user("ana")]);
  });

  it("lists the organization's teams, kept a day, and searches past them", async () => {
    const core = { slug: "core", name: "Core", combinedSlug: "acme/core" };
    const asked = github(() => ({ data: { organization: { teams: { nodes: [core] } } } }));
    const onValue = vi.fn<(list: unknown[]) => void>();
    await teams(ref, "", onValue);
    await teams(ref, "", onValue);
    expect(asked).toHaveLength(1);
    expect(sentJson(asked[0])).toMatchObject({ variables: { org: "acme", q: null } });
    await teams(ref, "co", onValue);
    expect(sentJson(asked[1])).toMatchObject({ variables: { q: "co" } });
    expect(onValue).toHaveBeenLastCalledWith([core]);
  });

  it("has no teams outside an organization", async () => {
    github(() => ({ data: { organization: null } }));
    const onValue = vi.fn<(list: unknown[]) => void>();
    await teams(ref, "co", onValue);
    expect(onValue).toHaveBeenCalledWith([]);
  });

  it("lists every label, a page at a time", async () => {
    let n = 0;
    const asked = github(() => page(++n, n < 2));
    const onValue = vi.fn<(list: unknown[]) => void>();
    await labels(ref, onValue);
    expect(onValue).toHaveBeenCalledWith([
      { id: "L1", name: "l1", color: "000000", description: null },
      { id: "L2", name: "l2", color: "000000", description: null },
    ]);
    expect(sentJson(asked[1])).toMatchObject({ variables: { after: "c1" } });
  });

  it("stops after ten pages of labels", async () => {
    const asked = github(() => ({
      data: { repository: { labels: { pageInfo: { hasNextPage: true, endCursor: "c" }, nodes: [] } } },
    }));
    await labels(ref, () => {});
    expect(asked).toHaveLength(10);
  });

  it("lists the open milestones, kept an hour", async () => {
    const v1 = { id: "M1", number: 1, title: "v1", dueOn: null };
    const asked = github(() => ({ data: { repository: { milestones: { nodes: [v1] } } } }));
    const onValue = vi.fn<(list: unknown[]) => void>();
    await milestones(ref, onValue);
    await milestones(ref, onValue);
    expect(asked).toHaveLength(1);
    expect(onValue).toHaveBeenCalledWith([v1]);
  });
});

describe("changes", () => {
  it("asks and unasks reviewers, people and teams", async () => {
    const asked = github(() => ({}));
    await requestReviews(ref, ["ana"]);
    await requestReviews(ref, ["ana"], ["core"]);
    await removeReviewRequests(ref, ["ana"]);
    await removeReviewRequests(ref, [], ["core"]);
    expect(asked.map((r) => [r.method, r.path, sentJson(r)])).toEqual([
      ["POST", "/repos/acme/app/pulls/7/requested_reviewers", { reviewers: ["ana"], team_reviewers: [] }],
      ["POST", "/repos/acme/app/pulls/7/requested_reviewers", { reviewers: ["ana"], team_reviewers: ["core"] }],
      ["DELETE", "/repos/acme/app/pulls/7/requested_reviewers", { reviewers: ["ana"], team_reviewers: [] }],
      ["DELETE", "/repos/acme/app/pulls/7/requested_reviewers", { reviewers: [], team_reviewers: ["core"] }],
    ]);
  });

  it("changes assignees, labels and the milestone on the pull request's issue", async () => {
    const asked = github(() => ({}));
    await addAssignees(ref, ["ana"]);
    await removeAssignees(ref, ["ana"]);
    await addLabels(ref, ["bug"]);
    await removeLabel(ref, "needs review");
    await setMilestone(ref, 3);
    await setMilestone(ref, null);
    expect(asked.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/repos/acme/app/issues/7/assignees", '{"assignees":["ana"]}'],
      ["DELETE", "/repos/acme/app/issues/7/assignees", '{"assignees":["ana"]}'],
      ["POST", "/repos/acme/app/issues/7/labels", '{"labels":["bug"]}'],
      ["DELETE", "/repos/acme/app/issues/7/labels/needs%20review", "null"],
      ["PATCH", "/repos/acme/app/issues/7", '{"milestone":3}'],
      ["PATCH", "/repos/acme/app/issues/7", '{"milestone":null}'],
    ]);
  });

  it("closes, reopens and turns a pull request back into a draft", async () => {
    const asked = github(() => ({ data: {} }));
    await closePull("PR_1");
    await reopenPull("PR_1");
    await convertToDraft("PR_1");
    expect(asked.map((r) => sentJson(r))).toEqual([
      { query: expect.stringContaining("closePullRequest(") as unknown, variables: { id: "PR_1" } },
      { query: expect.stringContaining("reopenPullRequest(") as unknown, variables: { id: "PR_1" } },
      { query: expect.stringContaining("convertPullRequestToDraft(") as unknown, variables: { id: "PR_1" } },
    ]);
  });
});
