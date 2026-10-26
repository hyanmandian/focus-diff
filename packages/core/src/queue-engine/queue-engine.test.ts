import { describe, expect, it } from "vitest";

import { parsePullRequest } from "../github-pulls/github-pulls";
import { parseConfig, type Queue, type QueueKind } from "../queue-config/queue-config";
import { ENGLISH } from "../queue-words/queue-words";
import {
  CACHE_VERSION,
  details,
  detailsQuery,
  emptyCache,
  Failure,
  fingerprint,
  fragment,
  isRateLimited,
  isTooBig,
  MERGED_EVERY,
  ORGANIZATIONS_QUERY,
  readCache,
  readReply,
  search,
  searchFor,
  searchQuery,
  sync,
  toFailure,
  type Cache,
  type Gql,
} from "./queue-engine";

// The tests of engine.rs's searches and fetching, ported, and more.

const ME = "me";
const T0 = 1_767_225_600_000; // 2026-01-01T00:00:00Z
const DAY = 86_400_000;

const queue = (kind: QueueKind, patch: Record<string, unknown> = {}): Queue =>
  parseConfig({ queues: [{ id: `q-${kind}`, name: "Queue", kind, drafts: "show", ...patch }] })!.queues[0]!;

type Reply = unknown;

/** Answers from a script, and records each call. */
const script = (...replies: Reply[]) => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const gql: Gql = {
    query: (query, variables) => {
      calls.push({ query, variables });
      const reply = replies.shift();
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
    },
  };
  return { gql, calls };
};

const page = (nodes: unknown[], next: string | null = null) => ({
  search: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes },
});
const light = (id: string, updatedAt = "1") => ({ id, updatedAt, headRefOid: "h", mergeable: "MERGEABLE" });
const full = (id: string) => ({ id, number: 1, title: id, createdAt: "2026-01-01T00:00:00Z" });
const tooBig = () => new Failure(200, "Resource limits for this query exceeded.");

describe("searches", () => {
  it("say what each kind of queue looks for", () => {
    expect(searchFor(queue("review"), ME, T0, [])).toBe(
      "is:pr archived:false is:open review-requested:me sort:updated-desc",
    );
    expect(searchFor(queue("involved"), ME, T0, [])).toContain("involves:me -author:me");
    expect(searchFor(queue("authored"), ME, T0, [])).toContain("author:me");
    const merged = searchFor(queue("merged", { mergedDays: 7 }), ME, T0 + 7 * DAY, []);
    expect(merged).toContain("is:merged merged:>=2026-01-01 -author:me -reviewed-by:me");
    expect(searchFor(queue("merged", { skipIfI: "approved" }), ME, T0, [])).not.toContain("reviewed-by");
    const q = searchFor(
      queue("review", {
        repos: ["acme/web", "acme/*"],
        drafts: "hide",
        includeLabels: ["needs review"],
        excludeLabels: ["wip"],
        excludeAuthors: ["dependabot"],
      }),
      ME,
      T0,
      [],
    );
    for (const part of [
      "repo:acme/web",
      "user:acme",
      "draft:false",
      'label:"needs review"',
      "-label:wip",
      "-author:dependabot",
    ]) {
      expect(q).toContain(part);
    }
    const custom = searchFor(queue("custom", { query: "is:issue label:bug" }), ME, T0, []);
    expect(custom.startsWith("is:pr archived:false is:open")).toBe(true);
    expect(custom).toContain("label:bug");
    expect(custom).not.toContain("is:issue");
    expect(searchFor(queue("custom", { query: "is:merged author:ana" }), ME, T0, [])).not.toContain("is:open");
    // Search terms narrow any queue, not only a search.
    expect(searchFor(queue("review", { query: "label:urgent" }), ME, T0, [])).toContain(
      "review-requested:me label:urgent",
    );
    expect(searchFor(queue("review", { drafts: "only" }), ME, T0, [])).toContain("draft:true");
    expect(searchFor(queue("merged", { drafts: "hide" }), ME, T0, [])).not.toContain("draft:");
  });

  it("look in your organizations for merged queues without repositories", () => {
    const q = searchFor(queue("merged"), ME, T0, ["acme", "labs"]);
    expect(q).toContain("user:me org:acme org:labs");
    expect(searchFor(queue("merged", { repos: ["acme/web"] }), ME, T0, ["acme"])).not.toContain("org:");
  });

  it("ask GitHub for little until they're due in full", () => {
    expect(searchQuery(false)).toContain("nodes { ... on PullRequest { id updatedAt } }");
    expect(searchQuery(true)).toContain("statusCheckRollup { state }");
    expect(detailsQuery(true, true)).toContain(fragment(true, true));
    expect(fragment(false, false)).not.toMatch(/files|requested:/u);
    expect(fragment(true, false)).toContain(" files(first: 100) { nodes { path } }");
    expect(fragment(false, true)).toContain(" requested: timelineItems(last: 30");
  });
});

describe("light searches", () => {
  it("ask for smaller pages when GitHub can't do the search", async () => {
    const { gql, calls } = script(tooBig(), page([light("PR_A"), null]), page([light("PR_A"), {}, "x", { id: 3 }]));
    const found = await search(gql, queue("review"), ME, T0, []);
    expect(found.map((l) => l.id)).toStrictEqual(["PR_A"]);
    expect(calls.map((c) => c.variables.size)).toStrictEqual([100, 50, 25]);
    expect(calls[0]!.variables).toStrictEqual({ q: searchFor(queue("review"), ME, T0, []), size: 100, after: null });

    const refused = script(new Failure(401, "Bad credentials"));
    await expect(search(refused.gql, queue("review"), ME, T0, [])).rejects.toMatchObject({ status: 401 });
  });

  it("go page after page, up to the queue's limit", async () => {
    const open = script(page([light("A")], "c1"), page([light("B")], "c2"), page([light("C")], "c3"));
    expect((await search(open.gql, queue("authored"), ME, T0, [])).map((l) => l.id)).toStrictEqual(["A", "B", "C"]);
    expect(open.calls.map((c) => c.variables.after)).toStrictEqual([null, "c1", "c2"]);
    expect(open.calls[0]!.query).toBe(searchQuery(true));
    const merged = script(page([light("A")], "c1"), page([light("B")], "c2"));
    expect(await search(merged.gql, queue("merged"), ME, T0, [])).toHaveLength(2);
    expect(merged.calls).toHaveLength(2);
    const noCursor = script({ search: { pageInfo: { hasNextPage: true, endCursor: null }, nodes: [] } });
    expect(await search(noCursor.gql, queue("review"), ME, T0, [])).toStrictEqual([]);
  });

  it("give up when GitHub can't run the search at all", async () => {
    const smallest = Array.from({ length: 6 }, () => ({ search: null }));
    await expect(search(script(...smallest).gql, queue("review"), ME, T0, [])).rejects.toMatchObject({
      status: 200,
      message: "GitHub couldn't run the search",
    });
    await expect(search(script(...Array.from({ length: 6 }, tooBig)).gql, queue("review"), ME, T0, [])).rejects.toThrow(
      "Resource limits",
    );
    await expect(search(script({ search: { nodes: 1 } }).gql, queue("review"), ME, T0, [])).rejects.toThrow(
      "run the search",
    );
    // A null node at the smallest page is dropped.
    const last = script(...Array.from({ length: 5 }, tooBig), page([light("A"), null]));
    expect((await search(last.gql, queue("review"), ME, T0, [])).map((l) => l.id)).toStrictEqual(["A"]);
  });

  it("fingerprint what changes a pull request", () => {
    expect(fingerprint({ id: "A", updatedAt: "u", headRefOid: "h", mergeable: "m", ci: "SUCCESS" })).toBe(
      "u|h|m|SUCCESS",
    );
  });
});

describe("details", () => {
  it("split a batch GitHub finds too costly, and leave out what it can't read", async () => {
    const { gql, calls } = script(
      tooBig(),
      { nodes: [full("A")] },
      { nodes: [null, full("C")] },
      { nodes: [full("B")] },
      { nodes: [{ id: "C", number: "x" }] },
    );
    const prs = await details(gql, ["A", "B", "C"], ME, false, false);
    expect(prs.map((pr) => pr.id)).toStrictEqual(["A", "B"]);
    expect(calls.map((c) => c.variables.ids)).toStrictEqual([["A", "B", "C"], ["A"], ["B", "C"], ["B"], ["C"]]);
    expect(calls[0]!.variables.login).toBe(ME);
    expect(await details(gql, [], ME, false, false)).toStrictEqual([]);
  });

  it("pass on what can't be split", async () => {
    await expect(details(script(tooBig()).gql, ["A"], ME, false, false)).rejects.toThrow("Resource limits");
    await expect(details(script(new Failure(502, "Bad gateway")).gql, ["A", "B"], ME, false, false)).rejects.toThrow(
      "Bad gateway",
    );
    expect(await details(script({ nodes: [null] }).gql, ["A"], ME, false, false)).toStrictEqual([]);
    expect(await details(script({}).gql, ["A"], ME, false, false)).toStrictEqual([]);
  });
});

describe("sync", () => {
  it("fetches again only the pull requests that changed", async () => {
    const q = queue("custom");
    const cache = emptyCache();
    const first = script(page([light("A"), light("B")]), { nodes: [full("A"), full("B")] });
    expect(await sync(first.gql, [q], ME, cache, false, false, T0)).toBe(2);
    expect(Object.keys(cache.prs)).toStrictEqual(["A", "B"]);

    const second = script(page([light("A"), light("B", "2")]), { nodes: [full("B")] });
    await sync(second.gql, [q], ME, cache, false, false, T0);
    expect(second.calls[1]!.variables.ids).toStrictEqual(["B"]);

    const third = script(page([light("A")]));
    expect(await sync(third.gql, [q], ME, cache, false, false, T0)).toBe(0);
    expect(third.calls).toHaveLength(1);
    expect(Object.keys(cache.prs)).toStrictEqual(["A"]);
  });

  it("fetches open pull requests in full again on a full pass, and what needs more than it has", async () => {
    const q = queue("custom");
    const cache = emptyCache();
    await sync(script(page([light("A")]), { nodes: [full("A")] }).gql, [q], ME, cache, false, false, T0);
    const fullPass = script(page([light("A")]), { nodes: [full("A")] });
    expect(await sync(fullPass.gql, [q], ME, cache, false, true, T0)).toBe(1);
    const paths = queue("custom", { includePaths: "src" });
    const needsFiles = script(page([light("A")]), { nodes: [full("A")] });
    expect(await sync(needsFiles.gql, [paths], ME, cache, false, false, T0)).toBe(1);
    expect(needsFiles.calls[1]!.query).toContain("files(first: 100)");
    expect(cache.prs.A?.files).toBe(true);
    const review = queue("review");
    const needsRequests = script(page([light("A")]), page([light("A")]), { nodes: [full("A")] });
    await sync(needsRequests.gql, [review, paths], ME, cache, false, false, T0);
    expect(needsRequests.calls.at(-1)!.query).toContain("requested: timelineItems");
    expect(cache.prs.A).toMatchObject({ files: true, requests: true, fingerprint: "1|h|MERGEABLE|" });
  });

  it("fetches what a queue not due yet lacks, keeping what it knew", async () => {
    const merged = queue("merged", { repos: ["acme/web"] });
    const query = searchFor(merged, ME, T0, []);
    const cache: Cache = {
      ...emptyCache(),
      version: CACHE_VERSION,
      me: ME,
      lists: { [merged.id]: { search: query, ids: ["A"], at: T0 } },
    };
    const { gql, calls } = script({ nodes: [full("A")] });
    expect(await sync(gql, [merged], ME, cache, false, false, T0)).toBe(1);
    expect(calls).toHaveLength(1);
    expect(cache.prs.A?.fingerprint).toBe("");
    cache.prs.A!.fingerprint = "known";
    const asking = queue("merged", { repos: ["acme/web"], requestedOnly: true });
    await sync(script({ nodes: [full("A")] }).gql, [asking], ME, cache, false, false, T0);
    expect(cache.prs.A).toMatchObject({ fingerprint: "known", requests: true });
  });

  it("keeps the fuller fingerprint of a pull request in several queues", async () => {
    const cache = emptyCache();
    const withChecks = { ...light("A"), commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] } };
    const { gql } = script(page([withChecks]), page([{ id: "A", updatedAt: "1" }]), { nodes: [full("A")] });
    await sync(gql, [queue("authored"), queue("custom")], ME, cache, false, false, T0);
    expect(cache.prs.A?.fingerprint).toBe("1|h|MERGEABLE|SUCCESS");
  });

  it("searches merged queues less often, and in your organizations", async () => {
    const merged = queue("merged");
    const cache = emptyCache();
    const first = script({ viewer: { organizations: { nodes: [{ login: "acme" }, {}] } } }, page([]));
    await sync(first.gql, [merged], ME, cache, false, false, T0);
    expect(first.calls[0]!.query).toBe(ORGANIZATIONS_QUERY);
    expect(first.calls[1]!.variables.q).toContain("user:me org:acme");
    expect(cache.orgs).toStrictEqual(["acme"]);

    const soon = script();
    await sync(soon.gql, [merged], ME, cache, false, false, T0 + 1000);
    expect(soon.calls).toHaveLength(0);
    const forced = script(page([]));
    await sync(forced.gql, [merged], ME, cache, true, false, T0 + 1000);
    expect(forced.calls).toHaveLength(1);
    const later = script(page([]));
    await sync(later.gql, [merged], ME, cache, false, false, T0 + 1000 + MERGED_EVERY + 1);
    expect(later.calls).toHaveLength(1);
    const otherSearch = script(page([]));
    await sync(
      otherSearch.gql,
      [queue("merged", { mergedDays: 3 })],
      ME,
      cache,
      false,
      false,
      T0 + 1000 + MERGED_EVERY + 2,
    );
    expect(otherSearch.calls).toHaveLength(1);

    // Organizations again a day later, kept as they were if GitHub can't say.
    const tomorrow = script(new Failure(403, "no"), page([]));
    await sync(tomorrow.gql, [merged], ME, cache, false, false, T0 + 2 * DAY);
    expect(cache.orgs).toStrictEqual(["acme"]);
    const none = script({ viewer: null }, page([]));
    await sync(none.gql, [merged], ME, cache, false, false, T0 + 4 * DAY);
    expect(cache.orgs).toStrictEqual([]);
  });

  it("starts over for someone else or another version, and forgets queues that are gone", async () => {
    const cache: Cache = {
      ...emptyCache(),
      version: CACHE_VERSION,
      me: "other",
      lists: { old: { search: "", ids: [], at: 0 } },
    };
    await sync(script(page([])).gql, [queue("review")], ME, cache, false, false, T0);
    expect(cache.me).toBe(ME);
    expect(Object.keys(cache.lists)).toStrictEqual(["q-review"]);
    cache.lists.gone = { search: "", ids: [], at: 0 };
    await sync(script(page([])).gql, [queue("review")], ME, cache, false, false, T0);
    expect(Object.keys(cache.lists)).toStrictEqual(["q-review"]);
  });

  it("keeps what came in before GitHub refused", async () => {
    const cache = emptyCache();
    const failing = script(page([light("A")]), new Failure(401, "Bad credentials"));
    await expect(
      sync(failing.gql, [queue("custom"), queue("review")], ME, cache, false, false, T0),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(cache.lists["q-custom"]?.ids).toStrictEqual(["A"]);
    const fetching = script(page([light("A")]), new Failure(502, "Bad gateway"));
    await expect(sync(fetching.gql, [queue("custom")], ME, cache, false, false, T0)).rejects.toThrow("Bad gateway");
    const thrown = script(page([light("A")]), new TypeError("Failed to fetch"));
    await expect(sync(thrown.gql, [queue("custom")], ME, cache, false, false, T0)).rejects.toMatchObject({
      status: 0,
      message: "Failed to fetch",
    });
  });

  it("fetches a few batches at a time", async () => {
    const ids = Array.from({ length: 45 }, (_, i) => `P${i}`);
    const replies: unknown[] = [
      page(
        ids.slice(0, 20).map((id) => light(id)),
        "c1",
      ),
      page(ids.slice(20).map((id) => light(id))),
    ];
    for (let i = 0; i < 45; i += 10) replies.push({ nodes: ids.slice(i, i + 10).map((id) => full(id)) });
    const { gql, calls } = script(...replies);
    expect(await sync(gql, [queue("merged", { repos: ["acme/web"] })], ME, emptyCache(), false, false, T0)).toBe(45);
    expect(calls.slice(2).map((c) => [c.variables.ids].flat().length)).toStrictEqual([10, 10, 10, 10, 5]);
  });
});

describe("GitHub's replies", () => {
  it("are their data, or the failure they are", () => {
    expect(readReply(200, '{"data":{"x":1}}', ENGLISH)).toStrictEqual({ x: 1 });
    expect(() => readReply(401, '{"message":"Bad credentials"}', ENGLISH)).toThrow("Bad credentials");
    expect(() => readReply(502, "<html>", ENGLISH)).toThrow("GitHub returned 502");
    expect(() => readReply(200, '{"data":null,"errors":[{"message":"Something went wrong"}]}', ENGLISH)).toThrow(
      "Something went wrong",
    );
    expect(() => readReply(200, '{"errors":[{}]}', ENGLISH)).toThrow("GitHub returned no data");
    expect(() => readReply(200, "[]", ENGLISH)).toThrow("GitHub returned no data");
    const thrown = (): unknown => {
      try {
        return readReply(429, "{}", ENGLISH);
      } catch (error) {
        return error;
      }
    };
    expect(thrown()).toMatchObject({ status: 429, name: "Failure" });
  });

  it("tell when GitHub asks to slow down or finds a query too big", () => {
    expect(isRateLimited(new Failure(429, ""))).toBe(true);
    expect(isRateLimited(new Failure(403, "API Rate Limit exceeded"))).toBe(true);
    expect(isRateLimited(new Failure(403, "Forbidden"))).toBe(false);
    for (const message of ["Resource limits exceeded", "Timeout on validation", "Something timed out"]) {
      expect(isTooBig(new Failure(200, message))).toBe(true);
    }
    expect(isTooBig(new Failure(200, "Not found"))).toBe(false);
    expect(toFailure("boom")).toMatchObject({ status: 0, message: "boom" });
  });
});

describe("the cache, read back", () => {
  it("is the one saved, of this version", () => {
    const cache: Cache = {
      version: CACHE_VERSION,
      me: ME,
      lists: { q: { search: "is:pr", ids: ["A"], at: 5 } },
      prs: { A: { fingerprint: "f", files: true, requests: false, pr: parsePullRequest({ id: "A", number: 3 })! } },
      fullAt: 7,
      orgs: ["acme"],
      orgsAt: 8,
    };
    expect(readCache(JSON.parse(JSON.stringify(cache)))).toStrictEqual(cache);
    expect(readCache({ ...cache, version: 2 })).toBeNull();
    expect(readCache({ ...cache, prs: { A: { fingerprint: "f", pr: null } } })).toBeNull();
    expect(readCache({ ...cache, lists: { q: { ids: [] } } })).toBeNull();
    expect(readCache(null)).toBeNull();
    expect(readCache({ version: CACHE_VERSION, me: ME, lists: {}, prs: {} })).toStrictEqual({
      ...emptyCache(),
      version: CACHE_VERSION,
      me: ME,
    });
  });
});
