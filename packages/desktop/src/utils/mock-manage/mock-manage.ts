// Development only: the sample pull request's state around it (mock.ts has the rest), so merging,
// checks with their logs, commits and ranges, reviewers, labels and the timeline can be worked on
// and screenshotted in a plain browser. Writes succeed and change what's asked next.

import { type Args, isRecord, json, str, strings, wait } from "../mock-ipc/mock-ipc";

type Reply = { status: number; body: string };

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const person = (login: string, name: string) => ({
  __typename: "User",
  login,
  name,
  avatarUrl: `https://avatars.githubusercontent.com/${login}?s=64`,
});
const people = {
  me: person("you", "You"),
  ana: person("octocat", "Ana Lima"),
  bruno: person("defunkt", "Bruno Costa"),
  carla: person("mojombo", "Carla Dias"),
  dev: person("pjhyett", "Devon Hart"),
};
const ok = (data: unknown): Reply => ({ status: 200, body: JSON.stringify(data) });

// What changes as the sample is acted on.
const pr = {
  state: "OPEN",
  isDraft: false,
  mergeable: "MERGEABLE",
  mergeStateStatus: "BLOCKED",
  reviewDecision: "REVIEW_REQUIRED",
  headRefOid: "abc123",
  updatedAt: iso(9),
};
let autoMerge: null | { mergeMethod: string; enabledBy: { login: string } } = null;
let headRef: { id: string } | null = { id: "REF_1" };
type Label = { id: string; name: string; color: string; description: string | null };
let labels: Label[] = [
  { id: "L1", name: "checkout", color: "1d76db", description: "The checkout flow" },
  { id: "L2", name: "bug", color: "d73a4a", description: "Something isn't working" },
];
let assignees = [people.ana];

const allLabels: Label[] = [
  ...labels,
  { id: "L3", name: "needs design", color: "c5def5", description: null },
  { id: "L4", name: "performance", color: "fbca04", description: "Faster, lighter" },
  { id: "L5", name: "good first issue", color: "7057ff", description: "Good for newcomers" },
];

const manage = () => ({
  repository: {
    viewerPermission: "WRITE",
    autoMergeAllowed: true,
    deleteBranchOnMerge: false,
    squashMergeCommitTitle: "PR_TITLE",
    squashMergeCommitMessage: "COMMIT_MESSAGES",
    mergeCommitTitle: "MERGE_MESSAGE",
    mergeCommitMessage: "PR_TITLE",
    owner: { __typename: "Organization" },
    pullRequest: {
      body: "Changing the cart used to drop the promo code, so people had to type it again.\n\nCloses #1790.",
      isMergeQueueEnabled: false,
      isInMergeQueue: false,
      mergeQueueEntry: null,
      viewerCanUpdateBranch: pr.state === "OPEN",
      viewerCanEnableAutoMerge: true,
      viewerCanDisableAutoMerge: true,
      viewerCanMergeAsAdmin: true,
      viewerCanDeleteHeadRef: true,
      autoMergeRequest: autoMerge,
      headRef,
      headRefName: "ana/keep-promo-code",
      headRepository: { name: "web", owner: { login: "acme" } },
      baseRef: {
        refUpdateRule: {
          requiredApprovingReviewCount: 2,
          requiresCodeOwnerReviews: true,
          requiredStatusCheckContexts: ["Unit tests", "build (ubuntu-latest)"],
          requiresConversationResolution: true,
          requiresLinearHistory: false,
        },
      },
      labels: { nodes: labels },
      assignees: { nodes: assignees },
      milestone: { id: "M1", number: 4, title: "Checkout v2", dueOn: iso(-60 * 24 * 12) },
      closingIssuesReferences: {
        nodes: [
          {
            id: "I1",
            number: 1790,
            title: "Promo code disappears when I change the cart",
            state: "OPEN",
            stateReason: null,
            url: "https://github.com/acme/web/issues/1790",
            repository: { nameWithOwner: "acme/web" },
          },
        ],
      },
      reviewRequests: {
        nodes: [
          { asCodeOwner: false, requestedReviewer: people.me },
          {
            asCodeOwner: true,
            requestedReviewer: {
              __typename: "Team",
              name: "Payments",
              slug: "payments",
              combinedSlug: "acme/payments",
            },
          },
        ],
      },
      latestReviews: {
        nodes: [
          { author: people.bruno, state: "APPROVED" },
          { author: people.carla, state: "COMMENTED" },
        ],
      },
      commits: {
        nodes: [
          {
            commit: {
              deployments: {
                nodes: [
                  {
                    id: "D1",
                    environment: "Preview",
                    state: "ACTIVE",
                    createdAt: iso(20),
                    latestStatus: {
                      state: "SUCCESS",
                      environmentUrl: "https://keep-promo.preview.acme.dev",
                      logUrl: null,
                    },
                  },
                ],
              },
            },
          },
        ],
      },
    },
  },
});

const run = (
  name: string,
  workflow: string,
  runId: number,
  job: number,
  status: string,
  conclusion: string | null,
  required = false,
  minutes = 3,
) => ({
  __typename: "CheckRun",
  id: `CR_${job}`,
  databaseId: job,
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/acme/web/actions/runs/${runId}/job/${job}`,
  startedAt: iso(30),
  completedAt: status === "COMPLETED" ? iso(30 - minutes) : null,
  title: conclusion === "FAILURE" ? "2 errors" : null,
  isRequired: required,
  checkSuite: { app: { slug: "github-actions" }, workflowRun: { databaseId: runId, workflow: { name: workflow } } },
});
let checks = [
  run("Unit tests", "CI", 11, 101, "COMPLETED", "SUCCESS", true, 4),
  run("Lint", "CI", 11, 102, "COMPLETED", "FAILURE", false, 1),
  run("Typecheck", "CI", 11, 103, "COMPLETED", "SUCCESS", false, 2),
  run("End-to-end", "CI", 11, 104, "IN_PROGRESS", null, false),
  run("build (ubuntu-latest)", "Build", 12, 105, "COMPLETED", "FAILURE", true, 6),
  run("build (macos-latest)", "Build", 12, 106, "COMPLETED", "SUCCESS", false, 9),
  run("Deploy docs", "Docs", 13, 107, "COMPLETED", "SKIPPED", false, 0),
  {
    __typename: "StatusContext",
    id: "SC_1",
    context: "Vercel – Preview",
    state: "SUCCESS",
    targetUrl: "https://vercel.com/acme/web/abc",
    description: "Deployment has completed",
    createdAt: iso(20),
    isRequired: false,
  },
];

const checkDetail = (id: string) => ({
  node:
    id === "CR_102" || id === "CR_105"
      ? {
          summary:
            id === "CR_102" ? "ESLint found 2 problems in 2 files." : "The build failed: `go vet` reported an issue.",
          text: null,
          annotations: {
            nodes:
              id === "CR_102"
                ? [
                    {
                      path: "src/checkout/cart.ts",
                      annotationLevel: "FAILURE",
                      title: "@typescript-eslint/no-unused-vars",
                      message: "'clearCart' is defined but never used.",
                      location: { start: { line: 15 } },
                    },
                    {
                      path: "src/checkout/promo.test.ts",
                      annotationLevel: "WARNING",
                      title: "jest/expect-expect",
                      message: "Test has no assertions on the error path.",
                      location: { start: { line: 2 } },
                    },
                  ]
                : [
                    {
                      path: "api/promo.go",
                      annotationLevel: "FAILURE",
                      title: null,
                      message: "promo.Minimum: undefined field Minimum on type Promo",
                      location: { start: { line: 24 } },
                    },
                  ],
          },
          steps: {
            nodes: [
              { number: 1, name: "Set up job", status: "COMPLETED", conclusion: "SUCCESS" },
              {
                number: 2,
                name: id === "CR_102" ? "Run npm run lint" : "Run go vet ./...",
                status: "COMPLETED",
                conclusion: "FAILURE",
              },
            ],
          },
        }
      : {
          summary: null,
          text: null,
          annotations: { nodes: [] },
          steps: { nodes: [{ number: 1, name: "Set up job", status: "COMPLETED", conclusion: "SUCCESS" }] },
        },
});

const log = [
  "2026-10-26T12:00:00.0000000Z ##[group]Run actions/checkout@v4",
  "2026-10-26T12:00:00.1000000Z with:",
  "2026-10-26T12:00:00.1000000Z   fetch-depth: 1",
  "2026-10-26T12:00:01.0000000Z ##[endgroup]",
  "2026-10-26T12:00:02.0000000Z ##[group]Run go vet ./...",
  "2026-10-26T12:00:02.1000000Z [command]/usr/bin/go vet ./...",
  "2026-10-26T12:00:09.0000000Z # acme/api/promo",
  "2026-10-26T12:00:09.0000000Z \u001B[31mapi/promo.go:24:14: promo.Minimum undefined (type Promo has no field or method Minimum)\u001B[0m",
  "2026-10-26T12:00:09.1000000Z ##[error]Process completed with exit code 1.",
  "2026-10-26T12:00:09.2000000Z ##[endgroup]",
  "2026-10-26T12:00:10.0000000Z Post job cleanup.",
].join("\n");

const commit = (
  oid: string,
  headline: string,
  author: ReturnType<typeof person>,
  minutesAgo: number,
  parent: string,
  ci: string | null,
  signed: boolean | null = null,
) => ({
  commit: {
    oid,
    abbreviatedOid: oid.slice(0, 7),
    messageHeadline: headline,
    messageBody: "",
    committedDate: iso(minutesAgo),
    author: { name: author.name, avatarUrl: author.avatarUrl, user: { login: author.login } },
    signature: signed === null ? null : { isValid: signed },
    statusCheckRollup: ci ? { state: ci } : null,
    parents: { nodes: [{ oid: parent }] },
  },
});
const commits = [
  commit("1111111aaaa", "Keep the promo code when the cart changes", people.ana, 180, "base000", "SUCCESS", true),
  commit("2222222bbbb", "Show why a code stopped applying", people.ana, 120, "1111111aaaa", "SUCCESS", true),
  commit("3333333cccc", "Check the minimum against the new total", people.ana, 40, "2222222bbbb", "FAILURE", true),
  commit("abc123ffff", "Test: keeps a valid code", people.ana, 12, "3333333cccc", "PENDING", false),
];

const timeline = {
  repository: {
    pullRequest: {
      timelineItems: {
        pageInfo: { hasPreviousPage: false, startCursor: null },
        nodes: [
          {
            __typename: "PullRequestCommit",
            id: "tc1",
            commit: {
              oid: "1111111aaaa",
              abbreviatedOid: "1111111",
              messageHeadline: "Keep the promo code when the cart changes",
              committedDate: iso(180),
              url: "https://github.com/acme/web/commit/1111111",
              author: { user: { login: "octocat" }, name: "Ana Lima" },
            },
          },
          {
            __typename: "LabeledEvent",
            id: "le1",
            createdAt: iso(170),
            actor: { login: "octocat" },
            label: { name: "checkout", color: "1d76db" },
          },
          {
            __typename: "LabeledEvent",
            id: "le2",
            createdAt: iso(170),
            actor: { login: "octocat" },
            label: { name: "bug", color: "d73a4a" },
          },
          {
            __typename: "ReviewRequestedEvent",
            id: "rr1",
            createdAt: iso(165),
            actor: { login: "octocat" },
            requestedReviewer: { __typename: "User", login: "you" },
          },
          {
            __typename: "ReviewRequestedEvent",
            id: "rr2",
            createdAt: iso(165),
            actor: { login: "octocat" },
            requestedReviewer: { __typename: "Team", name: "Payments" },
          },
          {
            __typename: "PullRequestCommit",
            id: "tc2",
            commit: {
              oid: "2222222bbbb",
              abbreviatedOid: "2222222",
              messageHeadline: "Show why a code stopped applying",
              committedDate: iso(120),
              url: "https://github.com/acme/web/commit/2222222",
              author: { user: { login: "octocat" }, name: "Ana Lima" },
            },
          },
          {
            __typename: "RenamedTitleEvent",
            id: "rn1",
            createdAt: iso(100),
            actor: { login: "octocat" },
            previousTitle: "Keep promo code",
            currentTitle: "Checkout: keep the promo code when the cart changes",
          },
          {
            __typename: "HeadRefForcePushedEvent",
            id: "fp1",
            createdAt: iso(60),
            actor: { login: "octocat" },
            beforeCommit: { abbreviatedOid: "9f8e7d6" },
            afterCommit: { abbreviatedOid: "2222222" },
            ref: { name: "ana/keep-promo-code" },
          },
          {
            __typename: "PullRequestCommit",
            id: "tc3",
            commit: {
              oid: "3333333cccc",
              abbreviatedOid: "3333333",
              messageHeadline: "Check the minimum against the new total",
              committedDate: iso(40),
              url: "https://github.com/acme/web/commit/3333333",
              author: { user: { login: "octocat" }, name: "Ana Lima" },
            },
          },
          {
            __typename: "PullRequestCommit",
            id: "tc4",
            commit: {
              oid: "abc123ffff",
              abbreviatedOid: "abc123f",
              messageHeadline: "Test: keeps a valid code",
              committedDate: iso(12),
              url: "https://github.com/acme/web/commit/abc123f",
              author: { user: { login: "octocat" }, name: "Ana Lima" },
            },
          },
          {
            __typename: "CrossReferencedEvent",
            id: "cr1",
            createdAt: iso(11),
            actor: { login: "mojombo" },
            willCloseTarget: false,
            source: {
              __typename: "Issue",
              number: 1802,
              title: "Track promo code errors in analytics",
              url: "https://github.com/acme/web/issues/1802",
              repository: { nameWithOwner: "acme/web" },
            },
          },
          {
            __typename: "DeployedEvent",
            id: "de1",
            createdAt: iso(8),
            actor: { login: "vercel" },
            deployment: { environment: "Preview" },
          },
        ],
      },
    },
  },
};

const compareFiles = [
  {
    filename: "src/checkout/promo.test.ts",
    status: "added",
    additions: 4,
    deletions: 0,
    patch:
      '@@ -0,0 +1,4 @@\n+test("keeps a valid code when the cart changes", () => {\n+  const cart = updateCart(withPromo("SAVE10"), [item(50)]);\n+  expect(cart.promo).toBe("SAVE10");\n+});',
  },
];

/** The sample's answer to a call of the app's, or undefined to leave it to mock.ts. */
export async function manageRoute(cmd: string, args: Args): Promise<unknown> {
  if (cmd === "job_log") {
    await wait(300);
    return { text: log, truncated: false };
  }
  if (cmd !== "github") return undefined;
  const path = str(args, "path");
  const method = str(args, "method");
  const body = json(args, "body");
  const query = str(body, "query");
  const variables = isRecord(body.variables) ? body.variables : undefined;
  if (query.trimStart().startsWith("mutation")) {
    if (query.includes("enablePullRequestAutoMerge"))
      autoMerge = { mergeMethod: String(variables?.method), enabledBy: { login: "you" } };
    if (query.includes("disablePullRequestAutoMerge")) autoMerge = null;
    if (query.includes("closePullRequest")) pr.state = "CLOSED";
    if (query.includes("reopenPullRequest")) pr.state = "OPEN";
    if (query.includes("convertPullRequestToDraft")) pr.isDraft = true;
    if (query.includes("markPullRequestReadyForReview")) pr.isDraft = false;
    if (query.includes("updatePullRequestBranch")) pr.mergeStateStatus = "BLOCKED";
    return ok({ data: {} });
  }
  if (path === "/graphql") {
    if (query.includes("isMergeQueueEnabled")) return ok({ data: manage() });
    if (query.includes("isRequired(pullRequestNumber"))
      return ok({
        data: {
          repository: {
            pullRequest: {
              commits: {
                nodes: [
                  {
                    commit: {
                      oid: "abc123",
                      statusCheckRollup: {
                        contexts: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: checks },
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      });
    if (query.includes("annotations(first: 50)")) return ok({ data: checkDetail(String(variables?.id)) });
    if (query.includes("PULL_REQUEST_COMMIT")) return ok({ data: timeline });
    if (query.includes("messageBody committedDate"))
      return ok({
        data: {
          repository: {
            pullRequest: {
              viewerLatestReview: { commit: { oid: "2222222bbbb" } },
              timelineItems: {
                nodes: [
                  {
                    createdAt: iso(60),
                    actor: { login: "octocat" },
                    beforeCommit: { oid: "9f8e7d6aaaa" },
                    afterCommit: { oid: "2222222bbbb" },
                  },
                ],
              },
              commits: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: commits },
            },
          },
        },
      });
    if (query.includes("mergeStateStatus reviewDecision headRefOid updatedAt"))
      return ok({ data: { repository: { pullRequest: pr } } });
    if (query.includes("assignableUsers"))
      return ok({ data: { repository: { assignableUsers: { nodes: Object.values(people) } } } });
    if (query.includes("teams(first: 100"))
      return ok({
        data: {
          organization: {
            teams: {
              nodes: [
                { name: "Payments", slug: "payments", combinedSlug: "acme/payments" },
                { name: "Frontend", slug: "frontend", combinedSlug: "acme/frontend" },
              ],
            },
          },
        },
      });
    if (query.includes("labels(first: 100"))
      return ok({
        data: { repository: { labels: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: allLabels } } },
      });
    if (query.includes("milestones(first: 100"))
      return ok({
        data: {
          repository: {
            milestones: {
              nodes: [
                { id: "M1", number: 4, title: "Checkout v2", dueOn: iso(-60 * 24 * 12) },
                { id: "M2", number: 5, title: "Q1 polish", dueOn: null },
              ],
            },
          },
        },
      });
    return undefined;
  }
  if (path.includes("/compare/")) return ok({ files: compareFiles, merge_base_commit: { sha: "base" } });
  if (path.includes("/actions/runs?")) return ok({ workflow_runs: [{ id: 99, name: "CI", display_title: "CI" }] });
  if (method !== "GET") {
    if (path.endsWith("/merge")) pr.state = "MERGED";
    if (path.includes("/git/refs/heads/")) headRef = null;
    if (path.includes("/rerun"))
      checks = checks.map((c) =>
        "conclusion" in c && c.conclusion === "FAILURE"
          ? { ...c, status: "QUEUED", conclusion: null, completedAt: null }
          : c,
      );
    if (path.endsWith("/labels") && method === "POST")
      labels = [...labels, ...allLabels.filter((l) => strings(body, "labels")?.includes(l.name))];
    if (path.includes("/labels/") && method === "DELETE")
      labels = labels.filter((l) => !path.endsWith(`/labels/${encodeURIComponent(l.name)}`));
    if (path.endsWith("/assignees")) {
      const logins = strings(body, "assignees") ?? [];
      assignees =
        method === "POST"
          ? [...assignees, ...Object.values(people).filter((p) => logins.includes(p.login))]
          : assignees.filter((a) => !logins.includes(a.login));
    }
    await wait(250);
    return ok({});
  }
  return undefined;
}
