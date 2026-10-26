import { describe, expect, it } from "vitest";

import { civilFromDays, parsePullRequest, type PullRequest } from "../github-pulls/github-pulls";
import { parseConfig, type Queue, type QueueKind } from "../queue-config/queue-config";
import type { EngineEvent, EngineItem } from "../queue-panel/queue-panel";
import {
  ciState,
  freshEvents,
  isBot,
  itemsFor,
  mentions,
  repoMatches,
  snippet,
  SNIPPET,
  type CiMemo,
} from "./queue-items";

// The tests of engine.rs's "Reading a pull request", ported.

const ME = "me";
const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z

const pad = (n: number): string => String(n).padStart(2, "0");
const t = (minutesAgo: number): string => {
  const ms = T0 - minutesAgo * 60_000;
  const [y, m, d] = civilFromDays(Math.floor(ms / 86_400_000));
  const s = Math.floor((ms % 86_400_000) / 1000);
  return `${y}-${pad(m)}-${pad(d)}T${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}Z`;
};

const user = (login: string) => ({ __typename: "User", login, name: null });
const bot = (login: string) => ({ __typename: "Bot", login });
const direct = { nodes: [{ requestedReviewer: { __typename: "User", login: ME } }] };
const meAsked = (minutesAgo: number) => ({
  requestedReviewer: { __typename: "User", login: ME },
  createdAt: t(minutesAgo),
});
const comment = (login: string, minutesAgo: number, body: string) => ({
  author: user(login),
  createdAt: t(minutesAgo),
  body,
  url: `https://x/${login}/${minutesAgo}`,
});

let n = 0;
const pr = (overrides: Record<string, unknown> = {}): PullRequest => {
  n += 1;
  return parsePullRequest({
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
    commits: { nodes: [{ commit: { committedDate: t(300), statusCheckRollup: { state: "SUCCESS" } } }] },
    files: { nodes: [{ path: "src/app.tsx" }] },
    ...overrides,
  })!;
};

const DEFAULT_NOTIFY: Record<QueueKind, Record<string, unknown>> = {
  review: { notify: ["new", "rerequest"] },
  involved: { notify: ["commits", "reply", "mention", "rerequest"] },
  authored: { notify: ["approved", "changes", "comment", "mention", "ci-failed", "ci-passed", "conflict"] },
  custom: { notify: ["new"], query: "is:open" },
  merged: {},
};

const queue = (kind: QueueKind, patch: Record<string, unknown> = {}): Queue =>
  parseConfig({
    queues: [{ id: `q-${kind}`, name: "Queue", kind, drafts: "show", ...DEFAULT_NOTIFY[kind], ...patch }],
  })!.queues[0]!;

const items = (q: Queue, prs: PullRequest[], ci: Record<string, CiMemo> = {}): EngineItem[] => {
  const result = itemsFor(q, prs, ME, ci);
  if (!result.ok) throw new Error(result.problem.pattern);
  return result.items;
};

const kinds = (found: EngineItem[]): string[] => found.flatMap((i) => i.events.map((e) => e.kind)).toSorted();

describe("review queues", () => {
  it("take requests made to you or your teams, as the queue says", () => {
    const team = (slug: string) => ({
      nodes: [{ requestedReviewer: { __typename: "Team", slug, organization: { login: "acme" } } }],
    });
    const found = items(queue("review"), [
      pr({ reviewRequests: direct }),
      pr({ reviewRequests: team("payments") }),
      pr(),
    ]);
    expect(found).toHaveLength(2);
    expect(found[1]!.viaTeams).toStrictEqual(["acme/payments"]);

    const prs = [pr({ reviewRequests: team("payments") }), pr({ reviewRequests: team("frontend") })];
    expect(items(queue("review", { teams: ["acme/payments"] }), prs)).toHaveLength(1);
    expect(items(queue("review", { directOnly: true }), prs)).toHaveLength(0);

    const reviewed = pr({
      reviewRequests: direct,
      mine: { nodes: [{ state: "COMMENTED", submittedAt: t(5), commit: { oid: "head" } }] },
    });
    expect(items(queue("review"), [reviewed])).toHaveLength(0);
    expect(items(queue("review", { hideOnceReviewed: false }), [reviewed])).toHaveLength(1);

    const filtered = [
      pr({ author: bot("renovate"), reviewRequests: direct }),
      pr({ author: user("noisy"), reviewRequests: direct }),
      pr({ reviewRequests: direct, files: { nodes: [{ path: "docs/a.md" }] } }),
    ];
    expect(
      items(queue("review", { excludeAuthors: ["noisy"], includePaths: String.raw`\.tsx?$` }), filtered),
    ).toHaveLength(0);
  });

  it("wait since the last time you were asked", () => {
    const asked = (who: unknown, minutesAgo: number) => ({ requestedReviewer: who, createdAt: t(minutesAgo) });
    const me = { __typename: "User", login: ME };
    const found = items(queue("review"), [
      pr({
        reviewRequests: { nodes: [{ requestedReviewer: me }] },
        requested: { nodes: [asked(me, 300), asked({ __typename: "User", login: "ana" }, 10), asked(me, 60)] },
      }),
    ]);
    expect(found[0]!.waitingSince).toBe(T0 - 60 * 60_000);
  });

  it("are back when you're asked again after reviewing", () => {
    const reviewed = { nodes: [{ state: "COMMENTED", submittedAt: t(60), commit: { oid: "head" } }] };
    // Asked, reviewed, asked again: back in the queue, asked again.
    const again = pr({ reviewRequests: direct, mine: reviewed, requested: { nodes: [meAsked(120), meAsked(30)] } });
    const found = items(queue("review"), [again]);
    expect(kinds(found)).toStrictEqual(["new", "rerequest"]);
    expect(found[0]!.waitingSince).toBe(T0 - 30 * 60_000);
    // Reviewed since the last ask: done with it.
    const done = pr({ reviewRequests: direct, mine: reviewed, requested: { nodes: [meAsked(120)] } });
    expect(items(queue("review"), [done])).toHaveLength(0);
    // The same notification as an updates queue's, once.
    const involved = queue("involved");
    const review = queue("review");
    const all = [...items(review, [again]), ...items(involved, [again])];
    const fresh = freshEvents(all, [review, involved], new Set(), {}, T0);
    expect(fresh.map((f) => f.event.kind)).toStrictEqual(["rerequest"]);
  });

  it("say whether it was asked of you or your team", () => {
    const team = { __typename: "Team", slug: "web", organization: { login: "acme" } };
    const found = items(queue("review"), [
      pr({ reviewRequests: { nodes: [{ requestedReviewer: team }] } }),
      pr({ reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: ME } }] } }),
    ]);
    expect(found[0]!.viaTeams).toStrictEqual(["acme/web"]);
    expect(found[1]!.viaTeams).toStrictEqual([]);
  });

  it("call out drafts made ready", () => {
    const ready = (minutesAgo: number) => ({ nodes: [{ createdAt: t(minutesAgo) }] });
    // Asked while a draft, then made ready: that's what's new, not arriving.
    const madeReady = pr({ reviewRequests: direct, requested: { nodes: [meAsked(120)] }, ready: ready(10) });
    const review = queue("review", { notify: ["new", "ready"] });
    const found = items(review, [madeReady]);
    expect(kinds(found)).toStrictEqual(["new", "ready"]);
    expect(freshEvents(found, [review], new Set(), {}, T0).map((f) => f.event.kind)).toStrictEqual(["ready"]);
    // Made ready before you were asked: only asked.
    const earlier = pr({ reviewRequests: direct, requested: { nodes: [meAsked(10)] }, ready: ready(120) });
    expect(kinds(items(review, [earlier]))).toStrictEqual(["new"]);
    // Still a draft (marked ready, then back to draft): nothing to say.
    const back = pr({ isDraft: true, reviewRequests: direct, requested: { nodes: [meAsked(120)] }, ready: ready(10) });
    expect(kinds(items(queue("review", { drafts: "show" }), [back]))).toStrictEqual(["new"]);
    // Where you took part: ready since your last word.
    const commented = { nodes: [{ state: "COMMENTED", submittedAt: t(60), commit: { oid: "head" } }] };
    expect(kinds(items(queue("involved"), [pr({ mine: commented, ready: ready(10) })]))).toContain("ready");
  });

  it("read who was asked, and comments without words", () => {
    const found = items(queue("review"), [
      pr({
        reviewRequests: direct,
        requested: { nodes: [{ requestedReviewer: null, createdAt: t(5) }, meAsked(60)] },
        comments: { nodes: [{ author: user("ana"), createdAt: t(20), body: null, url: "c" }] },
      }),
    ]);
    expect(found[0]!.waitingSince).toBe(T0 - 60 * 60_000);
    expect(found[0]!.events.map((e) => [e.kind, e.text])).toStrictEqual([
      ["new", null],
      ["comment", null],
    ]);
    const involved = items(queue("custom"), [
      pr({ comments: { nodes: [{ author: user("ana"), createdAt: t(20), body: null, url: "c" }] } }),
    ]);
    expect(kinds(involved)).toStrictEqual(["comment", "new"]);
  });

  it("quote what others said while it waited", () => {
    const found = items(queue("review"), [
      pr({
        reviewRequests: direct,
        requested: { nodes: [meAsked(60)] },
        comments: {
          nodes: [
            comment("ana", 90, "before you were asked"),
            comment("bruno", 20, "> quoted\nCan you look at **this**?"),
          ],
        },
      }),
    ]);
    const comments = found[0]!.events.filter((e) => e.kind === "comment");
    expect(comments).toHaveLength(1);
    expect(comments[0]!.text).toBe("Can you look at this?");
    const mine = items(queue("authored"), [
      pr({
        author: user(ME),
        latestOpinionatedReviews: {
          nodes: [{ author: user("ana"), state: "APPROVED", submittedAt: t(5), url: "u", body: "Ship it" }],
        },
      }),
    ]);
    expect(mine[0]!.events.find((e) => e.kind === "approved")?.text).toBe("Ship it");
  });

  it("leave out what a queue's notifications are asked to", () => {
    const prs = [
      pr({ reviewRequests: direct, isDraft: true }),
      pr({ reviewRequests: direct, author: bot("renovate") }),
      pr({
        reviewRequests: direct,
        mine: { nodes: [{ state: "APPROVED", submittedAt: t(500), commit: null }] },
        requested: { nodes: [meAsked(400)] },
      }),
      pr({ reviewRequests: direct, repository: { nameWithOwner: "other/api" } }),
      pr({ reviewRequests: direct }),
    ];
    const count = (patch: Record<string, unknown>) => {
      const q = queue("review", { drafts: "show", hideBots: false, hideOnceReviewed: false, ...patch });
      return freshEvents(items(q, prs), [q], new Set(), {}, T0).length;
    };
    expect(count({})).toBe(5);
    expect(count({ notifyLeaveOut: ["drafts"] })).toBe(4);
    expect(count({ notifyLeaveOut: ["bots"] })).toBe(4);
    expect(count({ notifyLeaveOut: ["approved"] })).toBe(4);
    expect(count({ notifyRepos: ["acme/*"] })).toBe(4);
    expect(count({ notifyRepos: ["other/api"], notifyLeaveOut: ["drafts", "bots", "approved"] })).toBe(1);
    expect(repoMatches("Acme/*", "acme/web") && repoMatches("acme/web", "ACME/web")).toBe(true);
    expect(repoMatches("acme/*", "acmeco/web") || repoMatches("acme/*", "acme")).toBe(false);
  });
});

describe("involved queues", () => {
  const reviewed = (minutesAgo: number, oid: string) => ({
    nodes: [{ state: "APPROVED", submittedAt: t(minutesAgo), commit: { oid } }],
  });

  it("say what happened since your last word", () => {
    const found = items(queue("involved"), [
      pr({
        mine: reviewed(60, "old"),
        headRefOid: "new",
        reviewThreads: { nodes: [{ comments: { nodes: [comment(ME, 70, "ok"), comment("ana", 30, "ok")] } }] },
        comments: { nodes: [comment("bruno", 90, "ok"), comment("carla", 20, "@me thoughts?")] },
      }),
    ]);
    expect(kinds(found)).toStrictEqual(["commits", "mention", "new", "reply"]);
    expect(found[0]!.status).toBe("APPROVED");

    const asked = items(queue("involved"), [pr({ mine: reviewed(60, "head"), reviewRequests: direct })]);
    expect(kinds(asked)).toContain("rerequest");

    expect(items(queue("involved"), [pr()])).toHaveLength(0);
    expect(items(queue("involved", { onlyNews: true }), [pr({ mine: reviewed(60, "head") })])).toHaveLength(0);
    expect(items(queue("involved"), [pr({ mine: reviewed(60, "head") })])).toHaveLength(1);

    const bots = items(queue("involved"), [
      pr({
        mine: reviewed(60, "head"),
        comments: { nodes: [{ author: bot("ci"), createdAt: t(5), body: "ok", url: "u" }] },
      }),
    ]);
    expect(kinds(bots)).toStrictEqual(["new"]);
  });

  it("count pushes since you commented, when you never reviewed", () => {
    const found = items(queue("involved"), [
      pr({
        comments: { nodes: [comment(ME, 100, "first")] },
        commits: { nodes: [{ commit: { committedDate: t(50), statusCheckRollup: null } }] },
      }),
    ]);
    expect(kinds(found)).toStrictEqual(["commits", "new"]);
    expect(found[0]!.status).toBe("COMMENTED");
    expect(found[0]!.ci).toBeNull();
  });

  it("list pull requests you're only mentioned on", () => {
    const found = items(queue("involved"), [pr({ comments: { nodes: [comment("carla", 20, "hey @Me")] } })]);
    expect(kinds(found)).toStrictEqual(["mention", "new"]);
    expect(found[0]!.status).toBe("MENTIONED");
  });
});

describe("authored queues", () => {
  it("say what reviewers, CI and merging did", () => {
    const found = items(queue("authored"), [
      pr({
        author: user(ME),
        latestOpinionatedReviews: {
          nodes: [
            { author: user("ana"), state: "APPROVED", submittedAt: t(5), url: "u1" },
            { author: user("bruno"), state: "CHANGES_REQUESTED", submittedAt: t(4), url: "u2" },
          ],
        },
        comments: { nodes: [comment("carla", 3, "ok")] },
        commits: { nodes: [{ commit: { committedDate: t(2), statusCheckRollup: { state: "FAILURE" } } }] },
        mergeable: "CONFLICTING",
      }),
    ]);
    expect(kinds(found)).toStrictEqual(["approved", "changes", "ci-failed", "comment", "conflict", "new"]);
  });

  it("tell when CI passes again on the same commit", () => {
    const passing = pr({ author: user(ME) });
    const memo = (oid: string) => ({ [passing.id]: { oid, state: "FAILURE" } });
    expect(items(queue("authored"), [passing], memo("head"))[0]!.passed).toBe(true);
    expect(items(queue("authored"), [passing], memo("other"))[0]!.passed).toBe(false);
    expect(ciState(passing)).toBe("SUCCESS");
  });
});

describe("merged queues", () => {
  const merged = (extra: Record<string, unknown> = {}) =>
    pr({ state: "MERGED", mergedAt: t(30), mergedBy: user("rui"), ...extra });

  it("leave out what you took part in or passed on", () => {
    const found = items(queue("merged"), [
      merged(),
      merged({ participants: { nodes: [{ login: ME }] } }),
      merged({ removed: { nodes: [{ actor: { login: ME } }] } }),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]!.events[0]!.at).toBe(T0 - 30 * 60_000);
  });

  it("take only what your review was asked on, when they say so", () => {
    const asked = (r: unknown) => merged({ requested: { nodes: [{ requestedReviewer: r }] } });
    const frontend = {
      __typename: "Team",
      slug: "frontend",
      organization: { login: "acme" },
      members: { nodes: [{ login: ME }] },
    };
    const data = { __typename: "Team", slug: "data", organization: { login: "acme" }, members: { nodes: [] } };
    const prs = [asked({ __typename: "User", login: ME }), asked(frontend), asked(data), merged()];
    expect(items(queue("merged", { requestedOnly: true }), prs)).toHaveLength(2);
    expect(items(queue("merged", { requestedOnly: true, directOnly: true }), prs)).toHaveLength(1);
    expect(items(queue("merged", { requestedOnly: true, teams: ["acme/data"] }), prs)).toHaveLength(2);
  });

  it("skip what you reviewed, approved or took part in, as asked", () => {
    const three = [
      merged({
        mine: { nodes: [{ state: "COMMENTED", submittedAt: t(40), commit: null }] },
        participants: { nodes: [{ login: ME }] },
      }),
      merged({ mine: { nodes: [{ state: "APPROVED", submittedAt: t(40), commit: null }] } }),
      merged({ participants: { nodes: [{ login: ME }] } }),
    ];
    expect(items(queue("merged", { skipIfI: "approved" }), three)).toHaveLength(2);
    expect(items(queue("merged", { skipIfI: "reviewed" }), three)).toHaveLength(1);
    expect(items(queue("merged", { skipIfI: "tookPart" }), three)).toHaveLength(0);
  });

  it("skip who merged or approved it, as asked", () => {
    const byDana = merged({ mergedBy: user("dana") });
    const okByEli = merged({
      latestOpinionatedReviews: { nodes: [{ author: user("eli"), state: "APPROVED", submittedAt: t(40), url: "u" }] },
    });
    const q = queue("merged", { skipMergedBy: ["dana"], skipApprovedBy: ["eli"] });
    expect(items(q, [byDana, okByEli, merged()])).toHaveLength(1);
  });
});

describe("path filters", () => {
  it("can't use what only JavaScript understands", () => {
    for (const pattern of ["(?=x)", "(?<!x)y", "(a)\\1", "\\k<a>", "("]) {
      const result = itemsFor(queue("review", { includePaths: pattern }), [], ME, {});
      expect(result).toStrictEqual({ ok: false, problem: { queue: "Queue", pattern } });
    }
    expect(itemsFor(queue("review", { excludePaths: "(?!x)" }), [], ME, {}).ok).toBe(false);
    expect(itemsFor(queue("review", { includePaths: String.raw`\\1` }), [], ME, {}).ok).toBe(true);
  });

  it("match file paths with case", () => {
    const q = queue("review", { includePaths: "^src/", excludePaths: String.raw`\.test\.` });
    const prs = [
      pr({ reviewRequests: direct, files: { nodes: [{ path: "SRC/a.ts" }] } }),
      pr({ reviewRequests: direct, files: { nodes: [{ path: "src/a.test.ts" }] } }),
      pr({ reviewRequests: direct, files: { nodes: [{ path: "src/a.test.ts" }, { path: "src/a.ts" }] } }),
      pr({ reviewRequests: direct, files: null }),
    ];
    expect(items(q, prs).map((i) => i.pr.id)).toStrictEqual([prs[2]!.id]);
    expect(items(queue("review", { excludePaths: "^docs/" }), [pr({ reviewRequests: direct })])).toHaveLength(1);
  });
});

describe("notifications", () => {
  it("are once across queues, and only for what's new and unseen", () => {
    const a = pr({ reviewRequests: direct });
    const review = queue("review");
    const custom = queue("custom");
    const all = [...items(review, [a]), ...items(custom, [a])];
    // One "new" per queue: entering each queue is its own event.
    expect(freshEvents(all, [review, custom], new Set(), {}, T0)).toHaveLength(2);
    const keys = new Set(all.flatMap((i) => i.events.map((e) => e.key)));
    expect(freshEvents(all, [review, custom], keys, {}, T0)).toHaveLength(0);
    const seen = Object.fromEntries([...keys].map((k) => [k, true]));
    expect(freshEvents(all, [review, custom], new Set(), seen, T0)).toHaveLength(0);
    const quiet = [queue("review", { notify: [] }), queue("custom", { notify: [] })];
    expect(freshEvents(all, quiet, new Set(), {}, T0)).toHaveLength(0);
    expect(freshEvents(all, [], new Set(), {}, T0)).toHaveLength(0);
  });

  it("say CI passed again once, unless left out", () => {
    const passing = pr({ author: user(ME), repository: { nameWithOwner: "acme/web" } });
    const memo = { [passing.id]: { oid: "head", state: "PENDING" } };
    const mine = queue("authored");
    const twice = queue("authored", { id: "other" });
    const found = [...items(mine, [passing], memo), ...items(twice, [passing], memo)];
    const fresh = freshEvents(found, [mine, twice], new Set(), {}, T0 + 1);
    expect(fresh.map((f) => [f.event.kind, f.event.at])).toStrictEqual([["ci-passed", T0 + 1]]);
    const elsewhere = queue("authored", { notifyRepos: ["other/*"] });
    expect(freshEvents(items(elsewhere, [passing], memo), [elsewhere], new Set(), {}, T0)).toHaveLength(0);
  });

  it("let arriving speak for a draft made ready outside review queues", () => {
    const event = (kind: EngineEvent["kind"]): EngineEvent => ({ key: kind, kind, at: 0, who: null, text: null });
    const custom = queue("custom", { notify: ["new", "ready", "rerequest"] });
    const item: EngineItem = {
      queueId: custom.id,
      pr: pr(),
      events: [event("new"), event("ready")],
      status: null,
      viaTeams: null,
      ci: null,
      passed: false,
      waitingSince: null,
    };
    expect(freshEvents([item], [custom], new Set(), {}, T0).map((f) => f.event.kind)).toStrictEqual(["new"]);
    const again = { ...item, events: [event("new"), event("ready"), event("rerequest")] };
    expect(freshEvents([again], [custom], new Set(), {}, T0).map((f) => f.event.kind)).toStrictEqual(["rerequest"]);
  });
});

describe("words", () => {
  it("mentions are whole words", () => {
    expect(mentions("hey @Me, look", "me")).toBe(true);
    expect(mentions("@me", "me")).toBe(true);
    expect(mentions("@meow @me_", "me")).toBe(false);
    expect(mentions("me", "me")).toBe(false);
    expect(mentions("@me", "")).toBe(false);
  });

  it("snippets are plain and short", () => {
    expect(snippet("> earlier words\n\nLooks **good**, see [the docs](https://x/y) `fn()`")).toBe(
      "Looks good, see the docs fn()",
    );
    expect(snippet("Run this:\n```sh\nrm -rf /\n```\nthen ship")).toBe("Run this: then ship");
    expect(snippet("<!-- template -->\n## Summary\n![shot](a.png) Done")).toBe("Summary Done");
    expect(snippet("> only a quote\n```\ncode\n```")).toBeNull();
    expect(snippet("snake_case_name stays")).toBe("snake_case_name stays");
    const long = snippet("word ".repeat(60))!;
    expect(Array.from(long)).toHaveLength(SNIPPET);
    expect(long.endsWith("word…")).toBe(true);
    // Cut by characters, not UTF-16 units.
    expect(Array.from(snippet("é".repeat(200))!)).toHaveLength(SNIPPET);
    expect(Array.from(snippet("😀".repeat(200))!)).toHaveLength(SNIPPET);
  });

  it("bots are bots", () => {
    expect(isBot(null)).toBe(true);
    expect(isBot({ __typename: "Bot", login: "ci" })).toBe(true);
    expect(isBot({ login: "renovate[bot]" })).toBe(true);
    expect(isBot({ __typename: "User", login: "ana" })).toBe(false);
  });
});
