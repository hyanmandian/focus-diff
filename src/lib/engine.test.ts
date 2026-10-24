import { describe, expect, it, vi } from "vitest";
import { GitHubError, graphql } from "./bridge";
import { TEMPLATES, type Queue } from "./config";
import { fetchQueues, freshEvents, itemsFor, searchFor, type PullRequest } from "./engine";

vi.mock("./bridge", async (original) => ({ ...(await original<typeof import("./bridge")>()), graphql: vi.fn() }));

const me = "me";
const t = (minutesAgo: number) => new Date(Date.UTC(2026, 0, 1) - minutesAgo * 60_000).toISOString();
const user = (login: string, bot = false) => ({ __typename: bot ? "Bot" : "User", login, name: null });

let n = 0;
function pr(overrides: Partial<PullRequest> = {}): PullRequest {
  n++;
  return {
    id: `PR_${n}`,
    number: n,
    title: `PR ${n}`,
    url: `https://github.com/acme/web/pull/${n}`,
    isDraft: false,
    state: "OPEN",
    createdAt: t(600),
    updatedAt: t(10),
    mergedAt: null,
    headRefOid: "head",
    mergeable: "MERGEABLE",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    repository: { nameWithOwner: "acme/web" },
    author: user("ana"),
    mergedBy: null,
    labels: { nodes: [] },
    reviewRequests: { nodes: [] },
    latestOpinionatedReviews: { nodes: [] },
    mine: { nodes: [] },
    reviewComments: { nodes: [] },
    comments: { nodes: [] },
    reviewThreads: { nodes: [] },
    commits: { nodes: [{ commit: { committedDate: t(300), statusCheckRollup: { state: "SUCCESS" } } }] },
    participants: { nodes: [] },
    removed: { nodes: [] },
    files: { nodes: [{ path: "src/app.tsx" }] },
    ...overrides,
  };
}
const queue = (kind: Queue["kind"], patch: Partial<Queue> = {}): Queue => ({ ...TEMPLATES[kind].make(), ...(kind === "merged" ? { requestedOnly: false, skipIfI: "tookPart" as const } : {}), ...patch });
const kinds = (items: ReturnType<typeof itemsFor>) => items.flatMap((i) => i.events.map((e) => e.kind));
const comment = (login: string, minutesAgo: number, body = "ok", url = `https://x/${login}/${minutesAgo}`) => ({ author: user(login), createdAt: t(minutesAgo), body, url });

describe("searchFor", () => {
  it("builds each kind's search", () => {
    expect(searchFor(queue("review"), me)).toContain("review-requested:me");
    expect(searchFor(queue("involved"), me)).toMatch(/involves:me -author:me/);
    expect(searchFor(queue("authored"), me)).toContain("author:me");
    const merged = searchFor(queue("merged", { mergedDays: 7 }), me, Date.UTC(2026, 0, 8));
    expect(merged).toContain("is:merged merged:>=2026-01-01 -author:me -reviewed-by:me");
  });

  it("scopes repositories, drafts, labels and authors", () => {
    const q = searchFor(queue("review", { repos: ["acme/web", "acme/*"], drafts: "hide", includeLabels: ["needs review"], excludeLabels: ["wip"], excludeAuthors: ["dependabot"] }), me);
    expect(q).toContain("repo:acme/web");
    expect(q).toContain("user:acme");
    expect(q).toContain("draft:false");
    expect(q).toContain('label:"needs review"');
    expect(q).toContain("-label:wip");
    expect(q).toContain("-author:dependabot");
  });

  it("keeps custom searches to pull requests", () => {
    expect(searchFor(queue("custom", { query: "is:issue label:bug" }), me)).toMatch(/^is:pr archived:false\s+label:bug/);
  });
});

describe("review queues", () => {
  const direct = { requestedReviewer: { __typename: "User" as const, login: me } };
  const team = (slug: string) => ({ requestedReviewer: { __typename: "Team" as const, slug, organization: { login: "acme" } } });

  it("takes direct and team requests, and only those", () => {
    const items = itemsFor(queue("review"), [pr({ reviewRequests: { nodes: [direct] } }), pr({ reviewRequests: { nodes: [team("payments")] } }), pr()], me);
    expect(items).toHaveLength(2);
    expect(items[1]?.viaTeams).toEqual(["acme/payments"]);
  });

  it("can count only some teams, or none", () => {
    const prs = [pr({ reviewRequests: { nodes: [team("payments")] } }), pr({ reviewRequests: { nodes: [team("frontend")] } })];
    expect(itemsFor(queue("review", { teams: ["acme/payments"] }), prs, me)).toHaveLength(1);
    expect(itemsFor(queue("review", { directOnly: true }), prs, me)).toHaveLength(0);
  });

  it("drops a pull request once you've reviewed or commented", () => {
    const reviewed = pr({ reviewRequests: { nodes: [direct] }, mine: { nodes: [{ state: "COMMENTED", submittedAt: t(5), commit: { oid: "head" } }] } });
    expect(itemsFor(queue("review"), [reviewed], me)).toHaveLength(0);
    expect(itemsFor(queue("review", { hideOnceReviewed: false }), [reviewed], me)).toHaveLength(1);
  });

  it("leaves out bots, authors and other paths", () => {
    const prs = [pr({ author: user("renovate", true), reviewRequests: { nodes: [direct] } }), pr({ author: user("noisy"), reviewRequests: { nodes: [direct] } }), pr({ reviewRequests: { nodes: [direct] }, files: { nodes: [{ path: "docs/a.md" }] } })];
    expect(itemsFor(queue("review", { excludeAuthors: ["noisy"], includePaths: "\\.tsx?$" }), prs, me)).toHaveLength(0);
  });
});

describe("involved queues", () => {
  const reviewedAt = (minutesAgo: number, oid = "old") => ({ mine: { nodes: [{ state: "APPROVED", submittedAt: t(minutesAgo), commit: { oid } }] } });

  it("shows what happened after your last word", () => {
    const item = itemsFor(
      queue("involved"),
      [
        pr({
          ...reviewedAt(60),
          headRefOid: "new",
          reviewThreads: { nodes: [{ comments: { nodes: [comment(me, 70), comment("ana", 30)] } }] },
          comments: { nodes: [comment("bruno", 90), comment("carla", 20, "@me thoughts?")] },
        }),
      ],
      me,
    );
    expect(kinds(item).sort()).toEqual(["commits", "mention", "new", "reply"]);
    expect(item[0]?.status).toBe("APPROVED");
  });

  it("asks again when you're still requested after reviewing", () => {
    const item = itemsFor(queue("involved"), [pr({ ...reviewedAt(60, "head"), reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: me } }] } })], me);
    expect(kinds(item)).toContain("rerequest");
  });

  it("needs you to have taken part or been mentioned, and can keep only news", () => {
    expect(itemsFor(queue("involved"), [pr()], me)).toHaveLength(0);
    expect(itemsFor(queue("involved", { onlyNews: true }), [pr(reviewedAt(60, "head"))], me)).toHaveLength(0);
    expect(itemsFor(queue("involved"), [pr(reviewedAt(60, "head"))], me)).toHaveLength(1);
  });

  it("ignores bots", () => {
    const item = itemsFor(queue("involved"), [pr({ ...reviewedAt(60, "head"), comments: { nodes: [{ ...comment("ci", 5), author: user("ci", true) }] } })], me);
    expect(kinds(item)).toEqual(["new"]);
  });
});

describe("authored queues", () => {
  it("tells reviews, comments, CI and conflicts apart", () => {
    const item = itemsFor(
      queue("authored"),
      [
        pr({
          author: user(me),
          latestOpinionatedReviews: { nodes: [{ author: user("ana"), state: "APPROVED", submittedAt: t(5), url: "u1" }, { author: user("bruno"), state: "CHANGES_REQUESTED", submittedAt: t(4), url: "u2" }] },
          comments: { nodes: [comment("carla", 3)] },
          commits: { nodes: [{ commit: { committedDate: t(2), statusCheckRollup: { state: "FAILURE" } } }] },
          mergeable: "CONFLICTING",
        }),
      ],
      me,
    );
    expect(kinds(item).sort()).toEqual(["approved", "changes", "ci-failed", "comment", "conflict", "new"]);
  });

  it("notices CI passing again on the same commit", () => {
    const passing = pr({ author: user(me) });
    expect(itemsFor(queue("authored"), [passing], me, { [passing.id]: { oid: "head", state: "FAILURE" } })[0]?.passed).toBe(true);
    expect(itemsFor(queue("authored"), [passing], me, { [passing.id]: { oid: "other", state: "FAILURE" } })[0]?.passed).toBe(false);
  });
});

describe("merged queues", () => {
  it("leaves out what you took part in or passed on", () => {
    const merged = { state: "MERGED" as const, mergedAt: t(30) };
    const items = itemsFor(queue("merged"), [pr(merged), pr({ ...merged, participants: { nodes: [{ login: me }] } }), pr({ ...merged, removed: { nodes: [{ actor: { login: me } }] } })], me);
    expect(items).toHaveLength(1);
  });
});

describe("freshEvents", () => {
  it("notifies new, unseen events of the asked kinds once across queues", () => {
    const direct = { requestedReviewer: { __typename: "User" as const, login: me } };
    const a = pr({ reviewRequests: { nodes: [direct] } });
    const review = queue("review");
    const custom = queue("custom", { notify: ["new"] });
    const items = [...itemsFor(review, [a], me), ...itemsFor(custom, [a], me)];
    const fresh = freshEvents(items, [review, custom], new Set(), {});
    // One "new" per queue: entering each queue is its own event.
    expect(fresh.map((f) => f.event.key)).toHaveLength(2);
    expect(freshEvents(items, [review, custom], new Set(items.flatMap((i) => i.events.map((e) => e.key))), {})).toHaveLength(0);
    const seen = Object.fromEntries(items.flatMap((i) => i.events.map((e) => [e.key, true as const])));
    expect(freshEvents(items, [review, custom], new Set(), seen)).toHaveLength(0);
    expect(freshEvents(items, [{ ...review, notify: [] }, { ...custom, notify: [] }], new Set(), {})).toHaveLength(0);
  });
});

describe("fetchQueues", () => {
  const page = (nodes: unknown[]) => ({ search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } });

  it("asks again with smaller pages when GitHub can't do the whole search", async () => {
    const ask = vi.mocked(graphql).mockReset();
    const a = pr();
    ask.mockRejectedValueOnce(new GitHubError(200, "Resource limits for this query exceeded."));
    ask.mockResolvedValueOnce(page([a, null]));
    ask.mockResolvedValueOnce(page([a, {}]));
    const review = queue("review");
    expect((await fetchQueues([review], me)).get(review.id)).toEqual([a]);
    expect(ask.mock.calls.map(([, v]) => v?.size)).toEqual([40, 20, 10]);
  });

  it("gives up on other errors", async () => {
    vi.mocked(graphql).mockReset().mockRejectedValueOnce(new GitHubError(401, "Bad credentials"));
    await expect(fetchQueues([queue("review")], me)).rejects.toThrow("Bad credentials");
  });
});

describe("merged queue options", () => {
  const merged = (patch: Partial<PullRequest> = {}) => pr({ state: "MERGED", mergedAt: t(30), mergedBy: user("rui"), ...patch });
  const asked = (r: NonNullable<PullRequest["requested"]>["nodes"][number]["requestedReviewer"]) => ({ requested: { nodes: [{ requestedReviewer: r }] } });
  const frontend = { __typename: "Team" as const, slug: "frontend", organization: { login: "acme" }, members: { nodes: [{ login: me }] } };
  const other = { __typename: "Team" as const, slug: "data", organization: { login: "acme" }, members: { nodes: [] } };

  it("can keep only those your review was asked on", () => {
    const q = queue("merged", { requestedOnly: true });
    const prs = [merged(asked({ __typename: "User", login: me })), merged(asked(frontend)), merged(asked(other)), merged()];
    expect(itemsFor(q, prs, me)).toHaveLength(2);
    expect(itemsFor({ ...q, directOnly: true }, prs, me)).toHaveLength(1);
    expect(itemsFor({ ...q, teams: ["acme/data"] }, prs, me)).toHaveLength(2);
  });

  it("leaves out what you approved, or any review, or any part", () => {
    const commented = merged({ mine: { nodes: [{ state: "COMMENTED", submittedAt: t(40), commit: null }] }, participants: { nodes: [{ login: me }] } });
    const approved = merged({ mine: { nodes: [{ state: "APPROVED", submittedAt: t(40), commit: null }] } });
    const talked = merged({ participants: { nodes: [{ login: me }] } });
    expect(itemsFor(queue("merged", { skipIfI: "approved" }), [commented, approved, talked], me)).toHaveLength(2);
    expect(itemsFor(queue("merged", { skipIfI: "reviewed" }), [commented, approved, talked], me)).toHaveLength(1);
    expect(itemsFor(queue("merged", { skipIfI: "tookPart" }), [commented, approved, talked], me)).toHaveLength(0);
    expect(searchFor(queue("merged", { skipIfI: "approved" }), me)).not.toContain("reviewed-by");
  });

  it("leaves out who merged or approved it", () => {
    const byDana = merged({ mergedBy: user("dana") });
    const okByEli = merged({ latestOpinionatedReviews: { nodes: [{ author: user("eli"), state: "APPROVED", submittedAt: t(40), url: "u" }] } });
    expect(itemsFor(queue("merged", { skipMergedBy: ["dana"], skipApprovedBy: ["eli"] }), [byDana, okByEli, merged()], me)).toHaveLength(1);
  });
});
