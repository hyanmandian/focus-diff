// Development only: stands in for the Rust side when the pages run in a plain browser
// (npm run dev, then open http://localhost:1420), with sample pull requests, so the interface can
// be worked on and screenshotted without GitHub. Never part of a build (see main.tsx).

type Args = Record<string, unknown>;

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

let n = 1800;
function pr(overrides: Record<string, unknown>) {
  n += 7;
  return {
    id: `PR_${n}`,
    number: n,
    title: "Untitled",
    url: `https://github.com/acme/web/pull/${n}`,
    isDraft: false,
    state: "OPEN",
    createdAt: iso(60 * 5),
    updatedAt: iso(30),
    mergedAt: null,
    headRefOid: `sha${n}`,
    mergeable: "MERGEABLE",
    additions: 120,
    deletions: 30,
    changedFiles: 6,
    repository: { nameWithOwner: "acme/web" },
    author: people.ana,
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    mine: { nodes: [] },
    reviewComments: { nodes: [] },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: { nodes: [{ commit: { committedDate: iso(40), statusCheckRollup: { state: "SUCCESS" } } }] },
    participants: { nodes: [] },
    removed: { nodes: [] },
    files: { nodes: [{ path: "src/app/checkout.tsx" }] },
    ...overrides,
  };
}

const review = [
  pr({ title: "Checkout: keep the promo code when the cart changes", author: people.ana, reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "you" } }] }, createdAt: iso(25) }),
  pr({
    title: "Move invoice exports to the background queue so large accounts don't time out",
    author: people.bruno,
    repository: { nameWithOwner: "acme/api" },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "Team", slug: "payments", organization: { login: "acme" } } }] },
    createdAt: iso(60 * 26),
  }),
  pr({ title: "Fix flaky date picker test in Safari", author: people.dev, reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "you" } }] }, createdAt: iso(60 * 50) }),
];

const involved = [
  pr({
    title: "Rename billing settings to Plans & billing",
    author: people.carla,
    mine: { nodes: [{ state: "APPROVED", submittedAt: iso(60 * 3), commit: { oid: "old" } }] },
    headRefOid: "new",
    commits: { nodes: [{ commit: { committedDate: iso(50), statusCheckRollup: { state: "PENDING" } } }] },
    reviewThreads: {
      nodes: [
        {
          comments: {
            nodes: [
              { author: people.me, createdAt: iso(60 * 3), body: "Should this keep the old route as a redirect?", url: "https://github.com/acme/web/pull/1#c1" },
              { author: people.carla, createdAt: iso(45), body: "Added one, good catch.", url: "https://github.com/acme/web/pull/1#c2" },
            ],
          },
        },
      ],
    },
  }),
  pr({
    title: "Search: debounce the query and cancel stale requests",
    author: people.bruno,
    comments: { nodes: [{ author: people.bruno, createdAt: iso(12), body: "@you does this match what you had in mind?", url: "https://github.com/acme/web/pull/2#c3" }] },
  }),
  pr({ title: "Upgrade to React 19", author: people.dev, mine: { nodes: [{ state: "COMMENTED", submittedAt: iso(60 * 30), commit: { oid: "sha" } }] }, updatedAt: iso(60 * 30) }),
];

const authored = [
  pr({
    title: "Order history: paginate on the server",
    author: people.me,
    latestOpinionatedReviews: { nodes: [{ author: people.ana, state: "APPROVED", submittedAt: iso(8), url: "https://github.com/acme/web/pull/3#r1" }] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "defunkt", avatarUrl: people.bruno.avatarUrl } }] },
  }),
  pr({
    title: "Draft: new onboarding checklist",
    author: people.me,
    isDraft: true,
    commits: { nodes: [{ commit: { committedDate: iso(20), statusCheckRollup: { state: "FAILURE" } } }] },
  }),
];

const merged = [
  pr({ title: "Header: show the workspace switcher on small screens", author: people.carla, state: "MERGED", mergedAt: iso(60 * 4), mergedBy: people.ana }),
];

const config = {
  version: 1,
  pollSeconds: 90,
  sound: false,
  theme: "system",
  ai: { provider: "claude", model: "" },
  queues: [
    { id: "review", name: "Review", tone: "blue", kind: "review", notify: ["new", "rerequest"] },
    { id: "updates", name: "Updates", tone: "purple", kind: "involved", drafts: "show", notify: ["commits", "reply", "mention"] },
    { id: "mine", name: "My PRs", tone: "green", kind: "authored", drafts: "show", notify: ["approved"] },
    { id: "merged", name: "Merged", tone: "gray", kind: "merged", notify: [] },
  ],
};

const details = {
  squashMergeAllowed: true,
  mergeCommitAllowed: true,
  rebaseMergeAllowed: false,
  pullRequest: {
    id: "PR_1807",
    number: 1807,
    title: "Checkout: keep the promo code when the cart changes",
    url: "https://github.com/acme/web/pull/1807",
    bodyHTML:
      "<p>Changing the cart used to drop the promo code, so people had to type it again. Now the code stays and is checked against the new total.</p><ul><li>Re-validates the code when items change</li><li>Shows why a code stopped applying</li></ul><p>Closes <a href=\"https://github.com/acme/web/issues/1790\">#1790</a>.</p>",
    isDraft: false,
    state: "OPEN",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    viewerDidAuthor: false,
    viewerCanUpdate: true,
    baseRefName: "main",
    headRefName: "ana/keep-promo-code",
    headRefOid: "abc123",
    additions: 48,
    deletions: 12,
    changedFiles: 3,
    createdAt: iso(25),
    reviewDecision: "REVIEW_REQUIRED",
    author: people.ana,
    reviewRequests: { nodes: [{ requestedReviewer: { ...people.me } }, { requestedReviewer: { __typename: "Team", name: "Payments", slug: "payments" } }] },
    latestOpinionatedReviews: { nodes: [{ author: people.bruno, state: "APPROVED" }] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  { __typename: "CheckRun", name: "Unit tests", conclusion: "SUCCESS", status: "COMPLETED", detailsUrl: "https://github.com/acme/web/actions/runs/1" },
                  { __typename: "CheckRun", name: "End-to-end", conclusion: null, status: "IN_PROGRESS", detailsUrl: "https://github.com/acme/web/actions/runs/2" },
                  { __typename: "CheckRun", name: "Lint", conclusion: "SUCCESS", status: "COMPLETED", detailsUrl: null },
                ],
              },
            },
          },
        },
      ],
    },
    files: {
      nodes: [
        { path: "src/checkout/cart.ts", additions: 30, deletions: 8, changeType: "MODIFIED" },
        { path: "src/checkout/promo.ts", additions: 14, deletions: 4, changeType: "MODIFIED" },
        { path: "src/checkout/promo.test.ts", additions: 4, deletions: 0, changeType: "ADDED" },
      ],
    },
    timelineItems: {
      nodes: [
        { __typename: "IssueComment", id: "c1", author: people.bruno, bodyHTML: "<p>Nice, this was bugging support for weeks.</p>", createdAt: iso(15), url: "https://github.com/acme/web/pull/1807#c1" },
        { __typename: "PullRequestReview", id: "r1", author: people.bruno, state: "APPROVED", bodyHTML: "", createdAt: iso(10), url: "https://github.com/acme/web/pull/1807#r1", comments: { nodes: [] } },
      ],
    },
  },
};

const reviewFiles = [
  {
    filename: "src/checkout/cart.ts",
    status: "modified",
    additions: 6,
    deletions: 2,
    patch: "@@ -10,6 +10,11 @@ export function updateCart(cart: Cart, items: Item[]) {\n   const next = { ...cart, items };\n-  next.promo = null;\n-  return recalculate(next);\n+  const total = recalculate(next);\n+  if (cart.promo) {\n+    const check = validatePromo(cart.promo, total);\n+    next.promo = check.ok ? cart.promo : null;\n+    next.promoError = check.ok ? null : check.reason;\n+  }\n+  return total;\n }\n \n export function clearCart(cart: Cart) {",
  },
  {
    filename: "src/checkout/promo.test.ts",
    status: "added",
    additions: 4,
    deletions: 0,
    patch: "@@ -0,0 +1,4 @@\n+test(\"keeps a valid code when the cart changes\", () => {\n+  const cart = updateCart(withPromo(\"SAVE10\"), [item(50)]);\n+  expect(cart.promo).toBe(\"SAVE10\");\n+});",
  },
];

const threads = {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            id: "t1",
            isResolved: false,
            isOutdated: false,
            path: "src/checkout/cart.ts",
            line: 15,
            originalLine: 15,
            diffSide: "RIGHT",
            comments: { nodes: [{ id: "tc1", databaseId: 1, author: people.bruno, bodyHTML: "<p>Should <code>promoError</code> be cleared when the code is removed by hand?</p>", createdAt: iso(9), url: "https://github.com/acme/web/pull/1807#tc1" }] },
          },
        ],
      },
    },
  },
};

const files: Record<string, string | null> = { config: JSON.stringify(config), state: null };
const listeners = new Map<number, string>();
let callbackId = 0;

async function invoke(cmd: string, args: Args = {}): Promise<unknown> {
  switch (cmd) {
    case "read_file":
      return files[args.name as string] ?? null;
    case "write_file":
      files[args.name as string] = args.contents as string;
      return null;
    case "auth_status":
      return { signed_in: true, source: "gh", login: "you", device_flow: true, gh_available: true };
    case "github": {
      const path = args.path as string;
      if (path.includes("/files?")) return { status: 200, body: JSON.stringify(reviewFiles) };
      const body = JSON.parse((args.body as string | null) ?? "{}") as { query?: string; variables?: Record<string, string> };
      if (body.query?.includes("reviewThreads(first: 100")) return { status: 200, body: JSON.stringify({ data: threads }) };
      if (body.query?.includes("squashMergeAllowed")) return { status: 200, body: JSON.stringify({ data: { repository: details } }) };
      const variables = body.variables ?? {};
      if ("q" in variables) return { status: 200, body: JSON.stringify({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: merged } } }) };
      const lists = [review, involved, authored];
      const data = Object.fromEntries(Object.keys(variables).filter((k) => /^q\d+$/.test(k)).map((k, i) => [k, { nodes: lists[i] ?? [] }]));
      return { status: 200, body: JSON.stringify({ data }) };
    }
    case "ai_statuses":
      return [
        { provider: "claude", installed: true, signed_in: true, version: "2.1.310 (Claude Code)", login_command: "claude auth login" },
        { provider: "codex", installed: true, signed_in: false, version: "codex-cli 0.144.5", login_command: "codex login" },
        { provider: "cursor", installed: false, signed_in: false, version: null, login_command: "agent login" },
      ];
    case "ai_ask":
      await new Promise((r) => setTimeout(r, 400));
      return "Keeps the promo code when the cart changes: `updateCart` now re-checks the code against the new total and keeps it if it still applies, with a reason when it doesn't.\n\nWorth a closer look:\n- `src/checkout/cart.ts`: `promoError` isn't cleared when the code is removed by hand.\n- **No test** for a code that stops applying after an item is removed.";
    case "plugin:event|listen":
      listeners.set(++callbackId, args.event as string);
      return callbackId;
    default:
      return null;
  }
}

export function installMock() {
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: () => ++callbackId,
    unregisterCallback: () => {},
    metadata: { currentWindow: { label: "panel" }, currentWebview: { label: "panel", windowLabel: "panel" } },
  };
  (window as unknown as { __TAURI_EVENT_PLUGIN_INTERNALS__: unknown }).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
}
