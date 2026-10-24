// Turns the person's queues into GitHub searches, and the pull requests found into items with
// events: what's new on each one since they last looked. Pure functions over GitHub's data, so the
// rules can be tested without the network (engine.test.ts).

import type { EventKind, Queue } from "./config";
import { GitHubError, graphql } from "./bridge";

// MARK: GitHub data

export type Actor = { __typename?: string; login: string; avatarUrl?: string; name?: string | null } | null;
export type Comment = { author: Actor; createdAt: string; body?: string; url: string };

export type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefOid: string;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
  author: Actor;
  mergedBy: Actor;
  labels: { nodes: Array<{ name: string }> };
  reviewRequests: {
    nodes: Array<{ requestedReviewer: null | { __typename: "User"; login: string; avatarUrl?: string } | { __typename: "Team"; slug: string; organization: { login: string } } | { __typename: string } }>;
  };
  latestOpinionatedReviews: { nodes: Array<{ author: Actor; state: string; submittedAt: string; url: string }> };
  mine: { nodes: Array<{ state: string; submittedAt: string; commit: { oid: string } | null }> };
  reviewComments: { nodes: Comment[] };
  comments: { nodes: Comment[] };
  reviewThreads: { nodes: Array<{ comments: { nodes: Comment[] } }> };
  commits: { nodes: Array<{ commit: { committedDate: string; statusCheckRollup: { state: CiState } | null } }> };
  participants: { nodes: Array<{ login: string }> };
  removed: { nodes: Array<{ actor: { login: string } | null }> };
  files?: { nodes: Array<{ path: string }> };
  /** merged queues: everyone ever asked to review, and whether you're in the teams asked. */
  requested?: {
    nodes: Array<{
      requestedReviewer?: null | { __typename: "User"; login: string } | { __typename: "Team"; slug: string; organization: { login: string }; members: { nodes: Array<{ login: string }> } } | { __typename: string };
    }>;
  };
};

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

const ACTOR = "__typename login avatarUrl(size: 64) ... on User { name }";
const COMMENT = `author { ${ACTOR} } createdAt body url`;
const fragment = (withFiles: boolean, withRequests: boolean) => `
  id number title url isDraft state createdAt updatedAt mergedAt headRefOid mergeable additions deletions changedFiles
  repository { nameWithOwner }
  author { ${ACTOR} }
  mergedBy { ${ACTOR} }
  labels(first: 20) { nodes { name } }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login avatarUrl(size: 64) } ... on Team { slug organization { login } } } } }
  latestOpinionatedReviews(first: 20) { nodes { author { ${ACTOR} } state submittedAt url } }
  mine: reviews(last: 20, author: $login) { nodes { state submittedAt commit { oid } } }
  reviewComments: reviews(last: 10, states: [COMMENTED]) { nodes { author { ${ACTOR} } createdAt: submittedAt body url } }
  comments(last: 20) { nodes { ${COMMENT} } }
  reviewThreads(last: 20) { nodes { comments(last: 5) { nodes { ${COMMENT} } } } }
  commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } } } }
  participants(first: 50) { nodes { login } }
  removed: timelineItems(first: 20, itemTypes: [REVIEW_REQUEST_REMOVED_EVENT]) { nodes { ... on ReviewRequestRemovedEvent { actor { login } } } }
  ${withFiles ? "files(first: 100) { nodes { path } }" : ""}
  ${withRequests ? "requested: timelineItems(first: 30, itemTypes: [REVIEW_REQUESTED_EVENT]) { nodes { ... on ReviewRequestedEvent { requestedReviewer { __typename ... on User { login } ... on Team { slug organization { login } members(query: $login, first: 10) { nodes { login } } } } } } }" : ""}`;

// MARK: Searches

const quote = (s: string) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, "")}"` : s);

/** The GitHub search for a queue. What search can't express (paths, teams…) is filtered after. */
export function searchFor(queue: Queue, me: string, now = Date.now()): string {
  const parts = ["is:pr", "archived:false"];
  switch (queue.kind) {
    case "review":
      parts.push("is:open", `review-requested:${me}`);
      break;
    case "involved":
      parts.push("is:open", `involves:${me}`, `-author:${me}`);
      break;
    case "authored":
      parts.push("is:open", `author:${me}`);
      break;
    case "merged": {
      const since = new Date(now - queue.mergedDays * 864e5).toISOString().slice(0, 10);
      parts.push("is:merged", `merged:>=${since}`, `-author:${me}`);
      if (queue.skipIfI !== "approved") parts.push(`-reviewed-by:${me}`);
      break;
    }
    case "custom":
      // The person's own qualifiers, minus anything that would leave pull requests.
      parts.push(queue.query.replace(/\bis:issue\b/g, "").trim() || "is:open");
      break;
  }
  // Several repo:/user: qualifiers are ORed by GitHub.
  for (const repo of queue.repos) parts.push(repo.endsWith("/*") ? `user:${repo.slice(0, -2)}` : `repo:${repo}`);
  if (queue.drafts === "hide" && queue.kind !== "merged") parts.push("draft:false");
  if (queue.drafts === "only") parts.push("draft:true");
  for (const label of queue.includeLabels) parts.push(`label:${quote(label)}`);
  for (const label of queue.excludeLabels) parts.push(`-label:${quote(label)}`);
  for (const author of queue.excludeAuthors) parts.push(`-author:${author}`);
  parts.push("sort:updated-desc");
  return parts.join(" ");
}

const needsFiles = (q: Queue) => Boolean(q.includePaths || q.excludePaths);

/** GitHub's search can return nulls (pull requests the token can't read) and, in a mixed search,
 *  empty objects for issues: only real pull requests go through. */
const isPullRequest = (n: unknown): n is PullRequest => typeof n === "object" && n !== null && "id" in n;

type SearchPage = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<PullRequest | Record<string, never> | null> };

/** One page of a search. GitHub refuses searches that would cost it too much (big pull requests,
 *  long timelines) and then returns nulls: a smaller page is tried before giving up. */
async function searchPage(queue: Queue, me: string, size: number, after: string | null): Promise<SearchPage> {
  try {
    const data = await graphql<{ search: SearchPage }>(
      `query($login: String!, $q: String!, $size: Int!, $after: String) {
        search(type: ISSUE, query: $q, first: $size, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ... on PullRequest { ${fragment(needsFiles(queue) || queue.kind === "merged", queue.kind === "merged" && queue.requestedOnly)} } }
        }
      }`,
      { login: me, q: searchFor(queue, me), size, after },
    );
    const incomplete = !data.search || data.search.nodes.some((n) => n === null);
    if (incomplete && size > 5) return searchPage(queue, me, Math.ceil(size / 2), after);
    if (!data.search) throw new GitHubError(200, `GitHub couldn't run the search for ${queue.name}`);
    return data.search;
  } catch (error) {
    if (size > 5 && error instanceof GitHubError && /resource limits|timeout|timed out/i.test(error.message)) return searchPage(queue, me, Math.ceil(size / 2), after);
    throw error;
  }
}

/** The open queues, a request each and all at once: together they'd be one search too costly for
 *  GitHub. Merged queues are paged on their own (fetchMerged). Returns pull requests by queue id. */
export async function fetchQueues(queues: Queue[], me: string): Promise<Map<string, PullRequest[]>> {
  const open = queues.filter((q) => q.enabled && q.kind !== "merged");
  const pages = await Promise.all(open.map((q) => searchPage(q, me, 40, null)));
  return new Map(open.map((q, i) => [q.id, (pages[i]?.nodes ?? []).filter(isPullRequest)]));
}

export async function fetchMerged(queue: Queue, me: string): Promise<PullRequest[]> {
  const prs: PullRequest[] = [];
  let after: string | null = null;
  // Small pages: GitHub times out on big ones with files and timelines.
  for (let page = 0; page < 8; page++) {
    const search = await searchPage(queue, me, 40, after);
    prs.push(...search.nodes.filter(isPullRequest));
    if (!search.pageInfo.hasNextPage) break;
    after = search.pageInfo.endCursor;
  }
  return prs;
}

// MARK: Reading a pull request

export type Event = { key: string; kind: EventKind; at: number; who: Actor };

export type Item = {
  queueId: string;
  pr: PullRequest;
  events: Event[];
  /** How you left it (involved queues). */
  status?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "MENTIONED";
  /** review queues: requested through these teams rather than you. */
  viaTeams?: string[];
  ci: CiState | null;
  /** CI went green again on the same commit since last time: worth a notification only. */
  passed?: boolean;
};

const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) : 0);
export const isBot = (a: Actor) => !a || a.__typename === "Bot" || /\[bot\]$/.test(a.login);
export const ciState = (pr: PullRequest): CiState | null => pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;
const threads = (pr: PullRequest) => pr.reviewThreads.nodes.map((t) => t.comments.nodes);
const notes = (pr: PullRequest) => [...pr.comments.nodes, ...pr.reviewComments.nodes.filter((r) => r.body?.trim())];

export function myActivity(pr: PullRequest, me: string) {
  const reviews = pr.mine.nodes.filter((r) => r.state !== "PENDING");
  const comments = [...pr.comments.nodes, ...threads(pr).flat()].filter((c) => c.author?.login === me);
  return {
    any: reviews.length + comments.length > 0,
    last: Math.max(0, ...reviews.map((r) => time(r.submittedAt)), ...comments.map((c) => time(c.createdAt))),
    // The last review that took a side; replying in a thread also makes a (commented) review.
    opinion: reviews.findLast((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED"),
    lastReview: reviews.at(-1),
  };
}

export function requests(pr: PullRequest, me: string) {
  const reviewers = pr.reviewRequests.nodes.map((n) => n.requestedReviewer).filter((r) => r !== null);
  const teams: string[] = [];
  const users: Array<{ login: string; avatarUrl?: string }> = [];
  let direct = false;
  for (const r of reviewers) {
    if (r.__typename === "User" && "login" in r) {
      users.push(r);
      if (r.login === me) direct = true;
    } else if (r.__typename === "Team" && "slug" in r) {
      teams.push(`${r.organization.login}/${r.slug}`);
    }
  }
  return { direct, teams, users };
}

function matchesPaths(pr: PullRequest, queue: Queue): boolean {
  if (!needsFiles(queue)) return true;
  const include = queue.includePaths ? new RegExp(queue.includePaths) : null;
  const exclude = queue.excludePaths ? new RegExp(queue.excludePaths) : null;
  return (pr.files?.nodes ?? []).some((f) => (!include || include.test(f.path)) && !(exclude?.test(f.path) ?? false));
}

/** Whether your review was ever asked on it: you, or (unless only direct asks count) a team of
 *  yours, or one of the queue's teams. */
function wasAsked(pr: PullRequest, me: string, queue: Queue): boolean {
  return (pr.requested?.nodes ?? []).some(({ requestedReviewer: r }) => {
    if (!r) return false;
    if ("login" in r) return r.login === me;
    if (queue.directOnly || !("slug" in r)) return false;
    return queue.teams.length ? queue.teams.includes(`${r.organization.login}/${r.slug}`) : r.members.nodes.some((m) => m.login === me);
  });
}

const event = (pr: PullRequest, kind: EventKind, id: string, at: number, who: Actor): Event => ({ key: `${pr.id}:${kind}:${id}`, kind, at, who });

/** The items of one queue, from what its search found. `previousCi` is each PR's CI state last
 *  time, to tell when it passes again. */
export function itemsFor(queue: Queue, prs: PullRequest[], me: string, previousCi: Record<string, { oid: string; state: CiState | null }> = {}): Item[] {
  const mention = new RegExp(`@${me.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const byOthers = (c: Comment) => !isBot(c.author) && c.author?.login !== me && Boolean(c.createdAt);
  const items: Item[] = [];

  for (const pr of prs) {
    if (queue.hideBots && isBot(pr.author)) continue;
    if (queue.excludeAuthors.includes(pr.author?.login ?? "")) continue;
    if (queue.skipApprovedBy.length && pr.latestOpinionatedReviews.nodes.some((r) => r.state === "APPROVED" && queue.skipApprovedBy.includes(r.author?.login ?? ""))) continue;
    if (!matchesPaths(pr, queue)) continue;
    const act = myActivity(pr, me);
    const req = requests(pr, me);
    const ci = ciState(pr);
    const pushed = time(pr.commits.nodes[0]?.commit.committedDate);
    // Entering the queue is an event of its own, per queue.
    const arrived: Event = { key: `${queue.id}:${pr.id}:new`, kind: "new", at: time(pr.createdAt), who: pr.author };

    if (queue.kind === "review") {
      const viaTeams = req.teams.filter((t) => !queue.teams.length || queue.teams.includes(t));
      if (!(req.direct || (!queue.directOnly && viaTeams.length))) continue;
      if (queue.hideOnceReviewed && act.any) continue;
      items.push({ queueId: queue.id, pr, ci, events: [arrived], viaTeams: req.direct ? [] : viaTeams });
      continue;
    }

    if (queue.kind === "merged") {
      if (queue.skipIfI === "tookPart" && pr.participants.nodes.some((p) => p.login === me)) continue;
      if (pr.mine.nodes.some((r) => r.state === "APPROVED" || (queue.skipIfI !== "approved" && r.state !== "PENDING"))) continue;
      if (queue.skipMergedBy.includes(pr.mergedBy?.login ?? "")) continue;
      if (queue.requestedOnly && !wasAsked(pr, me, queue)) continue;
      // Passed on: you took yourself (or your team) off its review, here or on GitHub.
      if (pr.removed.nodes.some((e) => e.actor?.login === me)) continue;
      items.push({ queueId: queue.id, pr, ci, events: [{ ...arrived, at: time(pr.mergedAt) }] });
      continue;
    }

    if (queue.kind === "authored") {
      const events: Event[] = [arrived];
      for (const r of pr.latestOpinionatedReviews.nodes) {
        if (isBot(r.author) || r.author?.login === me) continue;
        const kind = r.state === "APPROVED" ? "approved" : r.state === "CHANGES_REQUESTED" ? "changes" : null;
        if (kind) events.push(event(pr, kind, `${r.author?.login}:${r.submittedAt}`, time(r.submittedAt), r.author));
      }
      for (const c of [...notes(pr), ...threads(pr).flat()]) {
        if (byOthers(c)) events.push(event(pr, mention.test(c.body ?? "") ? "mention" : "comment", c.url, time(c.createdAt), c.author));
      }
      if (ci === "FAILURE" || ci === "ERROR") events.push(event(pr, "ci-failed", pr.headRefOid, pushed, null));
      if (pr.mergeable === "CONFLICTING") events.push(event(pr, "conflict", pr.headRefOid, pushed, null));
      const before = previousCi[pr.id];
      const passed = ci === "SUCCESS" && before?.oid === pr.headRefOid && before.state !== "SUCCESS";
      items.push({ queueId: queue.id, pr, ci, events, passed });
      continue;
    }

    // involved and custom: what happened since your last word on it.
    const allNotes = notes(pr);
    const mentions = [...allNotes, ...threads(pr).flat()].filter((c) => byOthers(c) && mention.test(c.body ?? ""));
    if (queue.kind === "involved" && !act.any && !mentions.length) continue;
    const since = act.last;
    const after = (c: Comment) => byOthers(c) && time(c.createdAt) > since;
    const events: Event[] = [arrived];
    const mentioned = new Set(mentions.map((c) => c.url));
    for (const c of mentions) if (time(c.createdAt) > since) events.push(event(pr, "mention", c.url, time(c.createdAt), c.author));
    if (act.any || queue.kind === "custom") {
      for (const thread of threads(pr)) {
        const mine = thread.some((c) => c.author?.login === me);
        for (const c of thread) if (after(c) && !mentioned.has(c.url)) events.push(event(pr, mine ? "reply" : "comment", c.url, time(c.createdAt), c.author));
      }
      for (const c of allNotes) if (after(c) && !mentioned.has(c.url)) events.push(event(pr, "comment", c.url, time(c.createdAt), c.author));
      const base = act.opinion ?? act.lastReview;
      if (base?.commit?.oid && base.commit.oid !== pr.headRefOid) events.push(event(pr, "commits", pr.headRefOid, Math.max(pushed, since), pr.author));
      else if (act.any && !base && pushed > since) events.push(event(pr, "commits", pr.headRefOid, pushed, pr.author));
      // Still asked after reviewing: asked again.
      if (act.lastReview && req.direct) events.push(event(pr, "rerequest", String(since), since, null));
    }
    if (queue.kind === "involved" && queue.onlyNews && events.length === 1) continue;
    const status = act.opinion?.state === "APPROVED" || act.opinion?.state === "CHANGES_REQUESTED" ? act.opinion.state : act.any ? "COMMENTED" : "MENTIONED";
    items.push({ queueId: queue.id, pr, ci, events, status: queue.kind === "involved" ? status : undefined });
  }
  return items;
}

/** What to notify: events not there last time and not seen, of the kinds the queue asked for,
 *  each once even when a PR is in several queues; plus CI passing again. */
export function freshEvents(items: Item[], queues: Queue[], previousKeys: Set<string>, seen: Record<string, true>) {
  const notifyKinds = new Map(queues.map((q) => [q.id, new Set(q.notify)]));
  const out: Array<{ item: Item; event: Event }> = [];
  const taken = new Set<string>();
  for (const item of items) {
    const kinds = notifyKinds.get(item.queueId);
    for (const e of item.events) {
      if (previousKeys.has(e.key) || seen[e.key] || taken.has(e.key) || !kinds?.has(e.kind)) continue;
      taken.add(e.key);
      out.push({ item, event: e });
    }
    if (item.passed && kinds?.has("ci-passed")) {
      const key = `${item.pr.id}:ci-passed:${item.pr.headRefOid}`;
      if (!taken.has(key)) {
        taken.add(key);
        out.push({ item, event: { key, kind: "ci-passed", at: Date.now(), who: null } });
      }
    }
  }
  return out.sort((a, b) => b.event.at - a.event.at);
}
