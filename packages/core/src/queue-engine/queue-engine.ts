/**
 * Turns the person's queues into GitHub searches, and keeps what they find: a port of the desktop app's
 * `src-tauri/src/engine.rs` (searches and fetching), with the same queries, limits and cache rules.
 *
 * Fetching is in two steps, to keep GitHub fast and cheap: every refresh runs a light search per queue (ids, last
 * update, head commit, CI), and only the pull requests that changed since last time are fetched in full. The full
 * ones are kept in a {@link Cache}, saved between launches by whoever runs the engine, so there's something to show
 * the moment it opens.
 */

import { isoDate, parsePullRequest, readCommitNode, readNodes, type PullRequest } from "../github-pulls/github-pulls";
import { attempt, fields, flag, integer, requiredText, text, texts } from "../json-decode/json-decode";
import { needsFiles, type Queue } from "../queue-config/queue-config";
import type { Words } from "../queue-words/queue-words";

// MARK: GitHub access

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A field of a JSON value, as serde_json's `value["key"]` reads it: nothing when it isn't an object. */
const at = (value: unknown, key: string): unknown => (isObject(value) ? value[key] : undefined);

/** Something GitHub (or getting to it) refused. `status` is the HTTP status, 200 for a GraphQL error, 0 for none. */
export class Failure extends Error {
  public readonly status: number;

  public constructor(status: number, message: string) {
    super(message);
    this.name = "Failure";
    this.status = status;
  }
}

/** Whatever was thrown, as a Failure. */
export const toFailure = (error: unknown): Failure =>
  error instanceof Failure ? error : new Failure(0, error instanceof Error ? error.message : String(error));

/** GitHub asking to slow down (its secondary rate limits, or the hourly one run out). */
export const isRateLimited = (failure: Failure): boolean =>
  failure.status === 429 || failure.message.toLowerCase().includes("rate limit");

/** GitHub refuses queries that would cost it too much: a smaller one may still go through. */
export const isTooBig = (failure: Failure): boolean => {
  const message = failure.message.toLowerCase();
  return message.includes("resource limits") || message.includes("timeout") || message.includes("timed out");
};

/**
 * Runs a GraphQL query and resolves with its `data`. Partial data (some nulls, with errors) comes back as is; no data
 * at all rejects with a {@link Failure} ({@link readReply} turns GitHub's reply into either).
 */
export interface Gql {
  query: (query: string, variables: Record<string, unknown>) => Promise<unknown>;
}

/** GitHub's reply to a GraphQL request (its HTTP status and body) as its `data`, or the Failure it is. */
export const readReply = (status: number, body: string, words: Pick<Words, "githubReturned" | "noData">): unknown => {
  let reply: unknown = null;
  try {
    reply = JSON.parse(body);
  } catch {
    // Not JSON: no message and no data.
  }
  if (status >= 400) {
    const message = at(reply, "message");
    throw new Failure(status, typeof message === "string" ? message : words.githubReturned(status));
  }
  const data = at(reply, "data");
  if (data === undefined || data === null) {
    const errors = at(reply, "errors");
    const message = at(Array.isArray(errors) ? (errors as unknown[])[0] : undefined, "message");
    throw new Failure(200, typeof message === "string" ? message : words.noData);
  }
  return data;
};

// MARK: Queries

const ACTOR = "__typename login avatarUrl(size: 64) ... on User { name }";

/** What a full pull request reads: `files` for path filters and merged queues, `requests` for who was ever asked. */
export const fragment = (files: boolean, requests: boolean): string => {
  const comment = `author { ${ACTOR} } createdAt body url`;
  const lines = [
    "id number title url isDraft state createdAt updatedAt mergedAt headRefOid mergeable additions deletions changedFiles",
    "repository { nameWithOwner }",
    `author { ${ACTOR} }`,
    `mergedBy { ${ACTOR} }`,
    "labels(first: 20) { nodes { name } }",
    "reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login avatarUrl(size: 64) } ... on Team { slug organization { login } } } } }",
    `latestOpinionatedReviews(first: 20) { nodes { author { ${ACTOR} } state submittedAt url body } }`,
    "mine: reviews(last: 20, author: $login) { nodes { state submittedAt commit { oid } } }",
    `reviewComments: reviews(last: 10, states: [COMMENTED]) { nodes { author { ${ACTOR} } createdAt: submittedAt body url } }`,
    `comments(last: 20) { nodes { ${comment} } }`,
    `reviewThreads(last: 20) { nodes { comments(last: 5) { nodes { ${comment} } } } }`,
    "commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }",
    "participants(first: 50) { nodes { login } }",
    "commentCount: comments { totalCount }",
    "threadCount: reviewThreads { totalCount }",
    "removed: timelineItems(first: 20, itemTypes: [REVIEW_REQUEST_REMOVED_EVENT]) { nodes { ... on ReviewRequestRemovedEvent { actor { login } } } }",
    "ready: timelineItems(last: 1, itemTypes: [READY_FOR_REVIEW_EVENT]) { nodes { ... on ReadyForReviewEvent { createdAt } } }",
  ];
  // The same text as Rust's multi-line literal: its lines keep their indentation.
  let f = lines.join("\n        ");
  if (files) f += " files(first: 100) { nodes { path } }";
  if (requests) {
    f +=
      " requested: timelineItems(last: 30, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } members(query: $login, first: 10) { nodes { login } } } } } } }";
  }
  return f;
};

/**
 * What the light search reads: enough to tell whether a pull request changed. GitHub bumps `updatedAt` for pushes,
 * comments, reviews, requests and labels, but not for CI or mergeability; those cost GitHub seconds to work out for a
 * whole search, so they're only asked where they make events (your own pull requests). Elsewhere the periodic full
 * fetch catches up.
 */
export const LIGHT = "id updatedAt";
export const LIGHT_WITH_CHECKS =
  "id updatedAt headRefOid mergeable commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }";

/** The query of one page of a light search. */
export const searchQuery = (checks: boolean): string =>
  `query($q: String!, $size: Int!, $after: String) { search(type: ISSUE, query: $q, first: $size, after: $after) { pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { ${checks ? LIGHT_WITH_CHECKS : LIGHT} } } } }`;

/** The query of a batch of full pull requests. */
export const detailsQuery = (files: boolean, requests: boolean): string =>
  `query($login: String!, $ids: [ID!]!) { nodes(ids: $ids) { ... on PullRequest { ${fragment(files, requests)} } } }`;

export const ORGANIZATIONS_QUERY = "query { viewer { organizations(first: 100) { nodes { login } } } }";

/** What a light search finds of a pull request. */
export interface Light {
  id: string;
  updatedAt: string;
  headRefOid: string;
  mergeable: string;
  ci: string;
}

const readLight = (value: unknown): Light | null =>
  attempt(() => {
    const o = fields(value);
    const commits = readNodes(o.commits, readCommitNode);
    return {
      id: text(o, "id"),
      updatedAt: text(o, "updatedAt"),
      headRefOid: text(o, "headRefOid"),
      mergeable: text(o, "mergeable"),
      ci: commits.nodes[0]?.commit.statusCheckRollup?.state ?? "",
    };
  });

/** Changes whenever anything shown changes (see {@link LIGHT}). */
export const fingerprint = (light: Light): string =>
  `${light.updatedAt}|${light.headRefOid}|${light.mergeable}|${light.ci}`;

// MARK: Searches

/** A search term as GitHub reads it: in quotes when it has spaces. */
const quote = (s: string): string => (/[\s"]/u.test(s) ? `"${s.replaceAll('"', "")}"` : s);

const STATE = /\b(?:is:(?:open|closed|merged|unmerged)|state:)/iu;
const ISSUE = /\bis:issue\b/gu;

/**
 * The GitHub search for a queue. What search can't express (paths, teams…) is filtered after. `orgs`: the person's
 * organizations, where a merged queue with no repositories looks (merged pull requests anywhere on GitHub would be
 * millions).
 */
export const searchFor = (queue: Queue, me: string, now: number, orgs: readonly string[]): string => {
  const parts = ["is:pr", "archived:false"];
  switch (queue.kind) {
    case "review": {
      parts.push("is:open", `review-requested:${me}`);
      break;
    }
    case "involved": {
      parts.push("is:open", `involves:${me}`, `-author:${me}`);
      break;
    }
    case "authored": {
      parts.push("is:open", `author:${me}`);
      break;
    }
    case "merged": {
      parts.push("is:merged", `merged:>=${isoDate(now - queue.mergedDays * 86_400_000)}`, `-author:${me}`);
      if (queue.skipIfI !== "approved") parts.push(`-reviewed-by:${me}`);
      break;
    }
    case "custom": {
      // Open ones, unless the person's terms say which.
      if (!STATE.test(queue.query)) parts.push("is:open");
      break;
    }
  }
  // The person's own search terms, on any queue, minus anything that would leave pull requests.
  const query = queue.query.replaceAll(ISSUE, "").trim();
  if (query) parts.push(query);
  // Several repo:/user: qualifiers are ORed by GitHub.
  for (const repo of queue.repos) parts.push(repo.endsWith("/*") ? `user:${repo.slice(0, -2)}` : `repo:${repo}`);
  if (queue.kind === "merged" && queue.repos.length === 0) {
    parts.push(`user:${me}`, ...orgs.map((o) => `org:${o}`));
  }
  if (queue.drafts === "hide" && queue.kind !== "merged") parts.push("draft:false");
  if (queue.drafts === "only") parts.push("draft:true");
  parts.push(
    ...queue.includeLabels.map((l) => `label:${quote(l)}`),
    ...queue.excludeLabels.map((l) => `-label:${quote(l)}`),
    ...queue.excludeAuthors.map((a) => `-author:${a}`),
    "sort:updated-desc",
  );
  return parts.join(" ");
};

// MARK: Fetching

/** Light searches are cheap: whole queues, a hundred at a time, up to a few hundred. */
export const PAGE = 100;
export const OPEN_PAGES = 3;
export const MERGED_PAGES = 2;
/** Full pull requests per request. */
export const BATCH = 10;
/** Requests at once: GitHub's secondary rate limits are about bursts, and full pull requests are costly to it. */
export const PARALLEL = 3;

/** One page of a light search: its pull requests, and the next page's cursor. */
const searchPage = async (
  gql: Gql,
  q: string,
  checks: boolean,
  size: number,
  after: string | null,
): Promise<{ found: Light[]; next: string | null }> => {
  const smaller = Math.max(Math.floor(size / 2), 5);
  let data: unknown;
  try {
    data = await gql.query(searchQuery(checks), { q, size, after });
  } catch (error) {
    const failure = toFailure(error);
    if (size > 5 && isTooBig(failure)) return searchPage(gql, q, checks, smaller, after);
    throw failure;
  }
  const search = at(data, "search");
  const nodes = at(search, "nodes");
  const list = Array.isArray(nodes) ? (nodes as unknown[]) : null;
  if ((search === undefined || search === null || list?.includes(null)) && size > 5) {
    return searchPage(gql, q, checks, smaller, after);
  }
  if (!list) throw new Failure(200, "GitHub couldn't run the search");
  const found = list.map((node) => readLight(node)).filter((l): l is Light => l !== null && l.id !== "");
  const pageInfo = at(search, "pageInfo");
  const cursor = at(pageInfo, "endCursor");
  const next = at(pageInfo, "hasNextPage") === true && typeof cursor === "string" ? cursor : null;
  return { found, next };
};

/** A queue's light search, page after page up to its limit. */
export const search = async (
  gql: Gql,
  queue: Queue,
  me: string,
  now: number,
  orgs: readonly string[],
): Promise<Light[]> => {
  const q = searchFor(queue, me, now, orgs);
  const pages = queue.kind === "merged" ? MERGED_PAGES : OPEN_PAGES;
  const found: Light[] = [];
  let after: string | null = null;
  for (let page = 0; page < pages; page += 1) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page needs the cursor of the one before.
    const result = await searchPage(gql, q, queue.kind === "authored", PAGE, after);
    found.push(...result.found);
    if (result.next === null) break;
    after = result.next;
  }
  return found;
};

/**
 * Pull requests in full, by id. A batch GitHub finds too costly is split; one it can't read at all (deleted, or no
 * longer visible to the token) is left out.
 */
export const details = async (
  gql: Gql,
  ids: readonly string[],
  me: string,
  files: boolean,
  requests: boolean,
): Promise<PullRequest[]> => {
  if (ids.length === 0) return [];
  const split = async (): Promise<PullRequest[]> => {
    const half = Math.floor(ids.length / 2);
    const first = await details(gql, ids.slice(0, half), me, files, requests);
    const second = await details(gql, ids.slice(half), me, files, requests);
    return [...first, ...second];
  };
  let data: unknown;
  try {
    data = await gql.query(detailsQuery(files, requests), { login: me, ids });
  } catch (error) {
    const failure = toFailure(error);
    if (ids.length > 1 && isTooBig(failure)) return split();
    throw failure;
  }
  const raw = at(data, "nodes");
  const nodes = Array.isArray(raw) ? (raw as unknown[]) : [];
  // Nulls come with GitHub's resource limits too: smaller batches may get through.
  if (ids.length > 1 && nodes.includes(null)) return split();
  return nodes.map((node) => parsePullRequest(node)).filter((pr): pr is PullRequest => pr !== null && pr.id !== "");
};

/** The organizations the person belongs to (needs the read:org scope; none without it). */
const organizations = async (gql: Gql): Promise<string[]> => {
  const data = await gql.query(ORGANIZATIONS_QUERY, {});
  const nodes = at(at(at(data, "viewer"), "organizations"), "nodes");
  if (!Array.isArray(nodes)) return [];
  return (nodes as unknown[]).map((o) => at(o, "login")).filter((login): login is string => typeof login === "string");
};

// MARK: The cache

export interface Cached {
  fingerprint: string;
  files: boolean;
  requests: boolean;
  pr: PullRequest;
}

export interface List {
  search: string;
  ids: string[];
  /** When it was searched (ms): merged queues are searched less often. */
  at: number;
}

/** What GitHub said last time: each queue's search and the pull requests in full, for the signed-in login only. */
export interface Cache {
  /** What's cached changes shape with the engine: an older cache starts over. */
  version: number;
  me: string;
  lists: Record<string, List>;
  prs: Record<string, Cached>;
  /** When every pull request was last fetched in full (ms). */
  fullAt: number;
  /** The person's organizations, for merged queues with no repositories, and when they were read. */
  orgs: string[];
  orgsAt: number;
}

export const CACHE_VERSION = 3;
export const MERGED_EVERY = 5 * 60_000;
const ORGS_EVERY = 24 * 3600 * 1000;

export const emptyCache = (): Cache => ({ version: 0, me: "", lists: {}, prs: {}, fullAt: 0, orgs: [], orgsAt: 0 });

/** A cache read back from storage (as saved), or null when it isn't one of this version. */
export const readCache = (value: unknown): Cache | null =>
  attempt(() => {
    const o = fields(value);
    if (o.version !== CACHE_VERSION) return null;
    const lists: Record<string, List> = {};
    for (const [id, raw] of Object.entries(fields(o.lists))) {
      const l = fields(raw);
      lists[id] = { search: requiredText(l, "search"), ids: texts(l, "ids"), at: integer(l, "at") };
    }
    const prs: Record<string, Cached> = {};
    for (const [id, raw] of Object.entries(fields(o.prs))) {
      const c = fields(raw);
      const pr = parsePullRequest(c.pr);
      if (!pr) return null;
      prs[id] = {
        fingerprint: requiredText(c, "fingerprint"),
        files: flag(c, "files"),
        requests: flag(c, "requests"),
        pr,
      };
    }
    return {
      version: CACHE_VERSION,
      me: requiredText(o, "me"),
      lists,
      prs,
      fullAt: integer(o, "fullAt"),
      orgs: texts(o, "orgs"),
      orgsAt: integer(o, "orgsAt"),
    };
  });

const settledValue = <T>(result: PromiseSettledResult<T>): T => {
  if (result.status === "rejected") throw toFailure(result.reason);
  return result.value;
};

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Brings the cache up to date with GitHub, in place. `force` searches merged queues again too; `full` fetches every
 * open pull request in full, changed or not (a periodic safety net for what GitHub doesn't count as an update, like
 * team membership). Resolves with how many were fetched in full; rejects with the first {@link Failure}, keeping in
 * the cache what came in before it.
 */
export const sync = async (
  gql: Gql,
  queues: readonly Queue[],
  me: string,
  cache: Cache,
  force: boolean,
  full: boolean,
  now: number,
): Promise<number> => {
  if (cache.me !== me || cache.version !== CACHE_VERSION) {
    Object.assign(cache, emptyCache(), { version: CACHE_VERSION, me });
  }
  if (queues.some((q) => q.kind === "merged" && q.repos.length === 0) && now - cache.orgsAt > ORGS_EVERY) {
    try {
      cache.orgs = await organizations(gql);
      cache.orgsAt = now;
    } catch {
      // Kept as they were if GitHub can't say now.
    }
  }
  const orgs = [...cache.orgs];

  // 1. The light searches, all at once.
  const due = queues.filter((q) => {
    if (q.kind !== "merged" || force) return true;
    const list = cache.lists[q.id];
    return !list || list.search !== searchFor(q, me, now, orgs) || now - list.at > MERGED_EVERY;
  });
  const results = await Promise.allSettled(due.map((q) => search(gql, q, me, now, orgs)));
  const fresh = new Map<string, string>();
  for (const [i, queue] of due.entries()) {
    const found = settledValue(results[i]!);
    for (const light of found) {
      // In several queues, the fuller fingerprint wins, so it doesn't flip between the two.
      const print = fingerprint(light);
      if ((fresh.get(light.id)?.length ?? -1) < print.length) fresh.set(light.id, print);
    }
    cache.lists[queue.id] = { search: searchFor(queue, me, now, orgs), ids: found.map((l) => l.id), at: now };
  }
  const wanted = new Set(queues.map((q) => q.id));
  for (const id of Object.keys(cache.lists)) if (!wanted.has(id)) delete cache.lists[id];

  // 2. What each pull request needs: files for path filters (and merged queues, to show them), review requests for
  //    review queues and merged queues that ask.
  const needs = new Map<string, { files: boolean; requests: boolean }>();
  // The full pass is for open pull requests: merged ones don't change in ways the rules read.
  const open = new Set<string>();
  for (const queue of queues) if (queue.kind !== "merged") for (const id of cache.lists[queue.id]!.ids) open.add(id);
  for (const queue of queues) {
    const files = needsFiles(queue) || queue.kind === "merged";
    const requests = queue.kind === "review" || (queue.kind === "merged" && queue.requestedOnly);
    // Every queue has its list by now: searched, or not due and searched before.
    for (const id of cache.lists[queue.id]!.ids) {
      const need = needs.get(id) ?? { files: false, requests: false };
      needs.set(id, { files: need.files || files, requests: need.requests || requests });
    }
  }

  // 3. Fetch in full what changed, or isn't known well enough.
  const stale = new Map<string, { files: boolean; requests: boolean; ids: string[] }>();
  for (const [id, { files, requests }] of needs) {
    const cached = cache.prs[id];
    const print = fresh.get(id);
    const changed =
      !cached ||
      (full && open.has(id) && print !== undefined) ||
      (print !== undefined && print !== cached.fingerprint) ||
      (files && !cached.files) ||
      (requests && !cached.requests);
    if (!changed) continue;
    const key = `${files}|${requests}`;
    const group = stale.get(key) ?? { files, requests, ids: [] };
    group.ids.push(id);
    stale.set(key, group);
  }
  const groups = [...stale.values()];
  const fetched = groups.reduce((sum, group) => sum + group.ids.length, 0);
  const jobs = groups.flatMap(({ files, requests, ids }) =>
    chunks(ids, BATCH).map((batch) => ({ files, requests, batch })),
  );
  for (const wave of chunks(jobs, PARALLEL)) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- a few requests at a time, on purpose (see PARALLEL).
    const answers = await Promise.allSettled(wave.map((job) => details(gql, job.batch, me, job.files, job.requests)));
    for (const [i, job] of wave.entries()) {
      for (const pr of settledValue(answers[i]!)) {
        const print = fresh.get(pr.id) ?? cache.prs[pr.id]?.fingerprint ?? "";
        cache.prs[pr.id] = { fingerprint: print, files: job.files, requests: job.requests, pr };
      }
    }
  }

  // 4. Forget what no queue has any more.
  for (const id of Object.keys(cache.prs)) if (!needs.has(id)) delete cache.prs[id];
  return fetched;
};
