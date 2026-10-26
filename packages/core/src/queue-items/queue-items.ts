/**
 * Reading a queue's pull requests: which belong in it, and what's new on each since the person last looked (its
 * events), then which of those are worth a notification. A port of the desktop app's `src-tauri/src/engine.rs`
 * ("Reading a pull request"), with the same rules and event keys.
 */

import { time, type Actor, type Comment, type PullRequest } from "../github-pulls/github-pulls";
import { leavesOut, needsFiles, type EventKind, type Queue } from "../queue-config/queue-config";
import type { EngineEvent, EngineItem } from "../queue-panel/queue-panel";

export const NEW = "new";

/** Each pull request's CI state last time, to tell when it passes again. */
export interface CiMemo {
  oid: string;
  state: string | null;
}

export const isBot = (actor: Actor | null | undefined): boolean =>
  !actor || actor.__typename === "Bot" || actor.login.endsWith("[bot]");

const login = (actor: Actor | null): string => actor?.login ?? "";

export const ciState = (pr: PullRequest): string | null => pr.commits.nodes[0]?.commit.statusCheckRollup?.state ?? null;

const asciiLower = (s: string): string => s.replaceAll(/[A-Z]/gu, (c) => c.toLowerCase());

/** "@login" in a text, as a whole word, ignoring case. */
export const mentions = (body: string, me: string): boolean => {
  if (!me) return false;
  const needle = `@${asciiLower(me)}`;
  const hay = asciiLower(body);
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    if (!/^[A-Za-z0-9_]/u.test(hay.slice(i + needle.length))) return true;
  }
  return false;
};

interface Activity {
  any: boolean;
  last: number;
  /** The last review that took a side; replying in a thread also makes a (commented) review. */
  opinion: PullRequest["mine"]["nodes"][number] | undefined;
  lastReview: PullRequest["mine"]["nodes"][number] | undefined;
}

const threads = (pr: PullRequest): Comment[][] => pr.reviewThreads.nodes.map((t) => t.comments.nodes);

const notes = (pr: PullRequest): Comment[] => [
  ...pr.comments.nodes,
  ...pr.reviewComments.nodes.filter((r) => r.body !== null && r.body.trim() !== ""),
];

const activity = (pr: PullRequest, me: string): Activity => {
  const reviews = pr.mine.nodes.filter((r) => r.state !== "PENDING");
  const comments = [...pr.comments.nodes, ...threads(pr).flat()].filter((c) => login(c.author) === me);
  const last = Math.max(0, ...reviews.map((r) => time(r.submittedAt)), ...comments.map((c) => time(c.createdAt)));
  return {
    any: reviews.length > 0 || comments.length > 0,
    last,
    opinion: reviews.findLast((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED"),
    lastReview: reviews.at(-1),
  };
};

/** Who's asked to review: you directly, and the teams ("org/slug"). */
const requests = (pr: PullRequest, me: string): { direct: boolean; teams: string[] } => {
  let direct = false;
  const teams: string[] = [];
  for (const node of pr.reviewRequests.nodes) {
    const r = node.requestedReviewer;
    if (!r) continue;
    if (r.__typename === "User" && r.login !== undefined && r.login === me) direct = true;
    else if (r.__typename === "Team" && r.slug !== undefined && r.organization)
      teams.push(`${r.organization.login}/${r.slug}`);
  }
  return { direct, teams };
};

/** Whether your review was ever asked on it: you, or (unless only direct asks count) a team of yours, or one of the queue's teams. */
const wasAsked = (pr: PullRequest, me: string, queue: Queue): boolean =>
  (pr.requested?.nodes ?? []).some(({ requestedReviewer: r }) => {
    if (!r) return false;
    if (r.login !== undefined) return r.login === me;
    if (r.slug === undefined || !r.organization || queue.directOnly) return false;
    if (queue.teams.length === 0) return (r.members?.nodes ?? []).some((m) => m.login === me);
    return queue.teams.includes(`${r.organization.login}/${r.slug}`);
  });

/** When you were last asked to review: directly, or through one of these teams ("org/slug"). */
const askedAt = (pr: PullRequest, me: string, teams: readonly string[]): number | null => {
  if (!pr.requested) return null;
  let latest: number | null = null;
  for (const node of pr.requested.nodes) {
    const r = node.requestedReviewer;
    if (!r) continue;
    const yours =
      r.login === undefined
        ? r.slug !== undefined && r.organization !== undefined && teams.includes(`${r.organization.login}/${r.slug}`)
        : r.login === me;
    if (yours) latest = Math.max(latest ?? Number.NEGATIVE_INFINITY, time(node.createdAt));
  }
  return latest;
};

const event = (pr: PullRequest, kind: EventKind, id: string, at: number, who: Actor | null): EngineEvent => ({
  key: `${pr.id}:${kind}:${id}`,
  kind,
  at,
  who,
  text: null,
});

/** Characters of a comment a notification quotes. */
export const SNIPPET = 140;

const SNIPPET_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/```[\s\S]*?(?:```|$)/gu, " "],
  [/<!--[\s\S]*?(?:-->|$)/gu, " "],
  [/^\s*>.*$/gmu, " "],
  [/!\[[^\]]*\]\([^)]*\)|<img\b[^>]*>/gu, " "],
  [/\[([^\]]*)\]\([^)]*\)/gu, "$1"],
  [/<\/?[a-zA-Z][^>]*>|\*\*|~~|`|^#+\s+/gmu, ""],
  [/\s+/gu, " "],
];

/**
 * The start of a comment as plain words, for a notification: quotes of earlier comments, code blocks, hidden HTML
 * comments and pictures say less than the words around them, so they go; links keep their text; runs of whitespace
 * become one space. Null when nothing's left.
 */
export const snippet = (body: string): string | null => {
  let text = body;
  for (const [pattern, replacement] of SNIPPET_PATTERNS) text = text.replace(pattern, replacement);
  text = text.trim();
  if (!text) return null;
  const chars = Array.from(text);
  if (chars.length <= SNIPPET) return text;
  return `${chars
    .slice(0, SNIPPET - 1)
    .join("")
    .trimEnd()}…`;
};

/** The same, quoting what a comment or review said. */
const said = (
  pr: PullRequest,
  kind: EventKind,
  id: string,
  at: number,
  who: Actor | null,
  body: string | null,
): EngineEvent => ({ ...event(pr, kind, id, at, who), text: snippet(body ?? "") });

/** When the pull request was last marked ready for review, if it ever was a draft. */
const readyAt = (pr: PullRequest): number | null => {
  const last = pr.ready.nodes.at(-1);
  if (!last) return null;
  const at = time(last.createdAt);
  return at > 0 ? at : null;
};

/** What the desktop's Rust regular expressions can't do (lookaround, backreferences): JavaScript-only syntax. */
const JAVASCRIPT_ONLY = /\(\?<?[=!]|\\[1-9]|\\k</u;

/** A path pattern, compiled as the desktop compiles it (case matters); null when empty, a string when unusable. */
const compilePath = (pattern: string): RegExp | null | "unusable" => {
  if (!pattern) return null;
  if (JAVASCRIPT_ONLY.test(pattern.replaceAll("\\\\", ""))) return "unusable";
  try {
    // oxlint-disable-next-line eslint/require-unicode-regexp -- the person's own patterns, as the settings check them (without u).
    return new RegExp(pattern);
  } catch {
    return "unusable";
  }
};

/** Why a queue's items couldn't be read: one of its file patterns can't be used. */
export interface PatternProblem {
  queue: string;
  pattern: string;
}

export type ItemsResult = { ok: true; items: EngineItem[] } | { ok: false; problem: PatternProblem };

/** The items of one queue, from what its search found. */
export const itemsFor = (
  queue: Queue,
  prs: readonly PullRequest[],
  me: string,
  previousCi: Readonly<Record<string, CiMemo>>,
): ItemsResult => {
  const include = compilePath(queue.includePaths);
  if (include === "unusable") return { ok: false, problem: { queue: queue.name, pattern: queue.includePaths } };
  const exclude = compilePath(queue.excludePaths);
  if (exclude === "unusable") return { ok: false, problem: { queue: queue.name, pattern: queue.excludePaths } };
  const byOthers = (c: Comment): boolean =>
    !isBot(c.author) && login(c.author) !== me && c.createdAt !== null && c.createdAt !== "";
  const kindOf = (c: Comment): EventKind => (mentions(c.body ?? "", me) ? "mention" : "comment");
  const items: EngineItem[] = [];

  for (const pr of prs) {
    const { author } = pr;
    if (queue.hideBots && isBot(author)) continue;
    if (queue.excludeAuthors.includes(login(author))) continue;
    if (
      queue.skipApprovedBy.length > 0 &&
      pr.latestOpinionatedReviews.nodes.some(
        (r) => r.state === "APPROVED" && queue.skipApprovedBy.includes(login(r.author)),
      )
    ) {
      continue;
    }
    if (
      needsFiles(queue) &&
      !(pr.files?.nodes ?? []).some((f) => (!include || include.test(f.path)) && !exclude?.test(f.path))
    ) {
      continue;
    }
    const act = activity(pr, me);
    const { direct, teams } = requests(pr, me);
    const ci = ciState(pr);
    const pushed = time(pr.commits.nodes[0]?.commit.committedDate);
    // Entering the queue is an event of its own, per queue.
    const arrived: EngineEvent = {
      key: `${queue.id}:${pr.id}:new`,
      kind: NEW,
      at: time(pr.createdAt),
      who: author,
      text: null,
    };
    const item = (events: EngineEvent[]): EngineItem => ({
      queueId: queue.id,
      pr,
      events,
      status: null,
      viaTeams: null,
      ci,
      passed: false,
      waitingSince: null,
    });

    switch (queue.kind) {
      case "review": {
        const via = teams.filter((t) => queue.teams.length === 0 || queue.teams.includes(t));
        if (!(direct || (!queue.directOnly && via.length > 0))) continue;
        const asked = askedAt(pr, me, direct ? [] : via);
        // Asked again after your last word on it: back for another look, reviewed or not.
        const again = act.any && asked !== null && asked > act.last;
        if (queue.hideOnceReviewed && act.any && !again) continue;
        const waiting = asked ?? time(pr.createdAt);
        const events = [arrived];
        // Keyed like an updates queue's, so it's one notification in both.
        if (again) events.push(event(pr, "rerequest", String(act.last), waiting, author));
        // Made ready after you were asked: it waited on that, not on you.
        const ready = readyAt(pr);
        if (ready !== null && ready > waiting && !pr.isDraft)
          events.push(event(pr, "ready", String(ready), ready, author));
        // What others said while it's been waiting on you.
        const since = Math.max(waiting, act.last);
        for (const c of [...notes(pr), ...threads(pr).flat()]) {
          if (byOthers(c) && time(c.createdAt) > since) {
            events.push(said(pr, kindOf(c), c.url, time(c.createdAt), c.author, c.body));
          }
        }
        items.push({ ...item(events), viaTeams: direct ? [] : via, waitingSince: waiting });
        break;
      }
      case "merged": {
        if (queue.skipIfI === "tookPart" && pr.participants.nodes.some((p) => p.login === me)) continue;
        if (
          pr.mine.nodes.some((r) => r.state === "APPROVED" || (queue.skipIfI !== "approved" && r.state !== "PENDING"))
        ) {
          continue;
        }
        if (pr.mergedBy && queue.skipMergedBy.includes(pr.mergedBy.login)) continue;
        if (queue.requestedOnly && !wasAsked(pr, me, queue)) continue;
        // Passed on: you took yourself (or your team) off its review, here or on GitHub.
        if (pr.removed.nodes.some((e) => e.actor?.login === me)) continue;
        items.push(item([{ ...arrived, at: time(pr.mergedAt) }]));
        break;
      }
      case "authored": {
        const events = [arrived];
        for (const r of pr.latestOpinionatedReviews.nodes) {
          if (isBot(r.author) || login(r.author) === me) continue;
          const kind = r.state === "APPROVED" ? "approved" : r.state === "CHANGES_REQUESTED" ? "changes" : null;
          if (!kind) continue;
          const id = `${login(r.author)}:${r.submittedAt ?? ""}`;
          events.push(said(pr, kind, id, time(r.submittedAt), r.author, r.body));
        }
        for (const c of [...notes(pr), ...threads(pr).flat()]) {
          if (byOthers(c)) events.push(said(pr, kindOf(c), c.url, time(c.createdAt), c.author, c.body));
        }
        if (ci === "FAILURE" || ci === "ERROR") events.push(event(pr, "ci-failed", pr.headRefOid, pushed, null));
        if (pr.mergeable === "CONFLICTING") events.push(event(pr, "conflict", pr.headRefOid, pushed, null));
        const before = previousCi[pr.id];
        const passed =
          ci === "SUCCESS" && before !== undefined && before.oid === pr.headRefOid && before.state !== "SUCCESS";
        items.push({ ...item(events), passed });
        break;
      }
      case "involved":
      case "custom": {
        // What happened since your last word on it.
        const allNotes = notes(pr);
        const mentionList = [...allNotes, ...threads(pr).flat()].filter(
          (c) => byOthers(c) && mentions(c.body ?? "", me),
        );
        if (queue.kind === "involved" && !act.any && mentionList.length === 0) continue;
        const since = act.last;
        const mentioned = new Set(mentionList.map((c) => c.url));
        const after = (c: Comment): boolean => byOthers(c) && time(c.createdAt) > since && !mentioned.has(c.url);
        const events = [arrived];
        for (const c of mentionList) {
          if (time(c.createdAt) > since) events.push(said(pr, "mention", c.url, time(c.createdAt), c.author, c.body));
        }
        if (act.any || queue.kind === "custom") {
          for (const thread of threads(pr)) {
            const kind = thread.some((c) => login(c.author) === me) ? "reply" : "comment";
            const replies = thread.filter((c) => after(c));
            events.push(...replies.map((c) => said(pr, kind, c.url, time(c.createdAt), c.author, c.body)));
          }
          const comments = allNotes.filter((c) => after(c));
          events.push(...comments.map((c) => said(pr, "comment", c.url, time(c.createdAt), c.author, c.body)));
          const ready = readyAt(pr);
          if (ready !== null && ready > since && !pr.isDraft)
            events.push(event(pr, "ready", String(ready), ready, author));
          const base = act.opinion ?? act.lastReview;
          const oid = base?.commit?.oid ?? "";
          if (oid && oid !== pr.headRefOid) {
            events.push(event(pr, "commits", pr.headRefOid, Math.max(pushed, since), author));
          } else if (!oid && act.any && !base && pushed > since) {
            events.push(event(pr, "commits", pr.headRefOid, pushed, author));
          }
          // Still asked after reviewing: asked again.
          if (act.lastReview && direct) events.push(event(pr, "rerequest", String(since), since, author));
        }
        if (queue.kind === "involved" && queue.onlyNews && events.length === 1) continue;
        const opinion = act.opinion?.state;
        const status =
          opinion === "APPROVED" || opinion === "CHANGES_REQUESTED" ? opinion : act.any ? "COMMENTED" : "MENTIONED";
        items.push({ ...item(events), status: queue.kind === "involved" ? status : null });
        break;
      }
    }
  }
  return { ok: true, items };
};

// MARK: What's worth a notification

/** An event worth a notification, and the item it's on. */
export interface Fresh {
  item: EngineItem;
  event: EngineEvent;
}

/** "owner/name", or all of an owner's with "owner/*" (case doesn't matter, as on GitHub). */
export const repoMatches = (pattern: string, repo: string): boolean => {
  if (pattern.endsWith("/*")) {
    const slash = repo.indexOf("/");
    return slash !== -1 && asciiLower(repo.slice(0, slash)) === asciiLower(pattern.slice(0, -2));
  }
  return asciiLower(pattern) === asciiLower(repo);
};

/** Whether your latest review that took a side approved it. */
const approvedByMe = (pr: PullRequest): boolean =>
  pr.mine.nodes.findLast((r) => r.state === "APPROVED" || r.state === "CHANGES_REQUESTED")?.state === "APPROVED";

/**
 * Whether a queue's notification settings leave this event out: a draft, a bot's doing, a pull request you approved,
 * or one from a repository its notifications aren't for.
 */
const leftOut = (queue: Queue, item: EngineItem, e: EngineEvent): boolean => {
  const repo = item.pr.repository.nameWithOwner;
  return (
    (leavesOut(queue, "drafts") && item.pr.isDraft) ||
    (leavesOut(queue, "bots") && e.who !== null && isBot(e.who)) ||
    (leavesOut(queue, "approved") && approvedByMe(item.pr)) ||
    (queue.notifyRepos.length > 0 && !queue.notifyRepos.some((p) => repoMatches(p, repo)))
  );
};

const wants = (queue: Queue, kind: string): boolean => queue.notify.includes(kind);

/**
 * What to notify: events not there last time and not seen, of the kinds the queue asked for and not left out, each
 * once even when a pull request is in several queues; plus CI passing again. Arriving in a queue and the reason it
 * arrived are one notification: being asked again wins, and in a review queue a draft made ready does too (elsewhere
 * arriving says more). The latest first.
 */
export const freshEvents = (
  items: readonly EngineItem[],
  queues: readonly Queue[],
  previous: ReadonlySet<string>,
  seen: Readonly<Record<string, unknown>>,
  now: number,
): Fresh[] => {
  const byId = new Map(queues.map((q) => [q.id, q]));
  const out: Fresh[] = [];
  const taken = new Set<string>();
  for (const item of items) {
    const queue = byId.get(item.queueId);
    if (!queue) continue;
    const fresh = item.events.filter(
      (e) => !previous.has(e.key) && !Object.hasOwn(seen, e.key) && wants(queue, e.kind) && !leftOut(queue, item, e),
    );
    const has = (kind: string): boolean => fresh.some((e) => e.kind === kind);
    const readyWins = queue.kind === "review";
    for (const e of fresh) {
      const shadowed =
        (e.kind === NEW && (has("rerequest") || (readyWins && has("ready")))) ||
        (e.kind === "ready" && (has("rerequest") || (!readyWins && has(NEW))));
      if (shadowed || taken.has(e.key)) continue;
      taken.add(e.key);
      out.push({ item, event: { ...e } });
    }
    if (item.passed && wants(queue, "ci-passed")) {
      const passed: EngineEvent = {
        key: `${item.pr.id}:ci-passed:${item.pr.headRefOid}`,
        kind: "ci-passed",
        at: now,
        who: null,
        text: null,
      };
      if (!leftOut(queue, item, passed) && !taken.has(passed.key)) {
        taken.add(passed.key);
        out.push({ item, event: passed });
      }
    }
  }
  return out.toSorted((a, b) => b.event.at - a.event.at);
};
