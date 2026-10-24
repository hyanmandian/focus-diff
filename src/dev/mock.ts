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
  queues: [
    { id: "review", name: "Review", tone: "blue", kind: "review", notify: ["new", "rerequest"] },
    { id: "updates", name: "Updates", tone: "purple", kind: "involved", drafts: "show", notify: ["commits", "reply", "mention"] },
    { id: "mine", name: "My PRs", tone: "green", kind: "authored", drafts: "show", notify: ["approved"] },
    { id: "merged", name: "Merged", tone: "gray", kind: "merged", notify: [] },
  ],
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
      const body = JSON.parse((args.body as string | null) ?? "{}") as { variables?: Record<string, string> };
      const variables = body.variables ?? {};
      if ("q" in variables) return { status: 200, body: JSON.stringify({ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: merged } } }) };
      const lists = [review, involved, authored];
      const data = Object.fromEntries(Object.keys(variables).filter((k) => /^q\d+$/.test(k)).map((k, i) => [k, { nodes: lists[i] ?? [] }]));
      return { status: 200, body: JSON.stringify({ data }) };
    }
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
