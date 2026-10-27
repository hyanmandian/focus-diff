// Pending review comments on their way to GitHub, as the desktop's drafts.rs. A comment written in a review goes into
// your pending review on github.com, so the site has it too and it outlives the page, but the page never waits for
// that: each change is kept in storage here and sent until GitHub takes it, through failures and restarts, as the
// viewed marks are (utils/viewed-outbox). What GitHub refuses is kept, with why, until it's changed, removed or tried
// again: what someone wrote is never dropped.

import type { DraftChange, DraftPut, DraftsState } from "@focus-diff/desktop/utils/bridge";

import { storage } from "#imports";
import type { GitHubApi } from "@/utils/github-api/github-api";
import { returned } from "@/utils/github-api/github-api";
import { isRecord } from "@/utils/record/record";
import { createSender, type Outcome } from "@/utils/sender/sender";
import { tr } from "@/utils/words/words";

/** How long submitting the review waits for its comments to reach GitHub. */
export const FLUSH_FOR = 20_000;

export type Job = { change: DraftChange; error: string | null };

/** What's kept: the changes still to send, and the ids GitHub gave the comments sent, by the page's key. */
export type Saved = { jobs: Job[]; ids: Record<string, { pull: string; comment: string }> };

export const draftsItem = storage.defineItem<Saved>("local:drafts", { fallback: { jobs: [], ids: {} } });

/** How a send went: GitHub took it (a new comment's id), couldn't be reached or is busy, or answered no. */
export type Sent =
  | { kind: "done"; id: string | null }
  | { kind: "later"; why: string }
  | { kind: "refused"; why: string };

const same = (a: Job, b: Job) => JSON.stringify(a) === JSON.stringify(b);

/** The changes and what's known of them (drafts.rs's Queue). */
export class DraftQueue {
  public saved: Saved;
  /** Sends that couldn't reach GitHub, counted, so a submit waiting on them stops waiting. */
  public unreachable = 0;
  public lastFailure: string | null = null;

  public constructor(saved?: Saved) {
    this.saved = saved ?? { jobs: [], ids: {} };
  }

  /** The latest text wins: an earlier change to the same comment that hasn't gone yet is replaced. */
  public put(put: DraftPut) {
    this.saved.jobs = this.saved.jobs.filter((j) => !(j.change.op === "put" && j.change.key === put.key));
    this.saved.jobs.push({ change: { op: "put", ...put }, error: null });
  }

  /** A comment never sent just goes; one on GitHub is deleted there. */
  public remove(pull: string, key: string, id: string | null) {
    this.saved.jobs = this.saved.jobs.filter((j) => j.change.key !== key);
    this.saved.jobs.push({ change: { op: "remove", key, pull, id }, error: null });
  }

  public next(): Job | undefined {
    const job = this.saved.jobs.find((j) => j.error === null);
    return job && structuredClone(job);
  }

  /** After a job is sent. Only the job as it was sent is settled: a newer change made meanwhile stays to be sent
   *  (with the id this one got). */
  public settle(job: Job, sent: Sent) {
    const still = this.saved.jobs.findIndex((j) => same(j, job));
    if (sent.kind === "done") {
      if (job.change.op === "put" && sent.id !== null)
        this.saved.ids[job.change.key] = { pull: job.change.pull, comment: sent.id };
      if (job.change.op === "remove") delete this.saved.ids[job.change.key];
      if (still !== -1) this.saved.jobs.splice(still, 1);
    } else if (sent.kind === "refused") {
      if (still !== -1) this.saved.jobs[still]!.error = sent.why;
    } else {
      this.unreachable += 1;
      this.lastFailure = sent.why;
    }
  }

  public pending(pull: string): DraftsState {
    return {
      jobs: structuredClone(this.saved.jobs.filter((j) => j.change.pull === pull)),
      ids: Object.fromEntries(
        Object.entries(this.saved.ids)
          .filter(([, s]) => s.pull === pull)
          .map(([key, s]) => [key, s.comment]),
      ),
    };
  }

  /** Refused changes get another go. */
  public retry(pull?: string) {
    for (const job of this.saved.jobs) if (pull === undefined || job.change.pull === pull) job.error = null;
  }

  /** The review was sent or thrown away: nothing of it is left to send or to know. */
  public forget(pull: string) {
    this.saved.jobs = this.saved.jobs.filter((j) => j.change.pull !== pull);
    this.saved.ids = Object.fromEntries(Object.entries(this.saved.ids).filter(([, s]) => s.pull !== pull));
  }
}

type Data = Record<string, unknown>;
type Answer = { ok: true; data: Data } | { ok: false; sent: Sent };

/** A field deep in GitHub's answer, as serde_json's `value["a"]["b"]` reads it: nothing when it isn't there. */
const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>((at, key) => (isRecord(at) ? at[String(key)] : undefined), value);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** A GraphQL call as a page's write (so what the pages read next isn't from before it). Errors in the answer are
 *  GitHub's no. */
export const graphql = async (
  api: Pick<GitHubApi, "requestForPage">,
  query: string,
  variables: Record<string, unknown>,
): Promise<Answer> => {
  let status: number;
  let body: string;
  try {
    ({ status, body } = await api.requestForPage("POST", "/graphql", JSON.stringify({ query, variables }), null));
  } catch (error) {
    // Offline, or signed out for now.
    return { ok: false, sent: { kind: "later", why: error instanceof Error ? error.message : String(error) } };
  }
  let reply: unknown = null;
  try {
    reply = JSON.parse(body);
  } catch {
    // Not JSON: no message and no data.
  }
  if (status === 200) {
    const error = field(reply, "errors", 0);
    if (error !== undefined)
      return { ok: false, sent: { kind: "refused", why: text(field(error, "message")) ?? "GitHub refused it" } };
    const data = field(reply, "data");
    return { ok: true, data: isRecord(data) ? data : {} };
  }
  // Signed out for now, rate limited or GitHub having trouble.
  if (status === 401 || status === 403 || status === 429 || status >= 500)
    return { ok: false, sent: { kind: "later", why: returned(status) } };
  return { ok: false, sent: { kind: "refused", why: text(field(reply, "message")) ?? returned(status) } };
};

const UPDATE =
  "mutation($id: ID!, $body: String!) { updatePullRequestReviewComment(input: { pullRequestReviewCommentId: $id, body: $body }) { pullRequestReviewComment { id } } }";
const DELETE = "mutation($id: ID!) { deletePullRequestReviewComment(input: { id: $id }) { clientMutationId } }";
const PENDING =
  "query($id: ID!) { node(id: $id) { ... on PullRequest { reviews(states: PENDING, first: 5) { nodes { id viewerDidAuthor comments(first: 100) { nodes { id body path line } } } } } } }";
const START = "mutation($id: ID!) { addPullRequestReview(input: { pullRequestId: $id }) { pullRequestReview { id } } }";
const REPLY =
  "mutation($review: ID!, $thread: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewId: $review, pullRequestReviewThreadId: $thread, body: $body }) { comment { id } } }";
const THREAD =
  "mutation($input: AddPullRequestReviewThreadInput!) { addPullRequestReviewThread(input: $input) { thread { comments(first: 1) { nodes { id } } } } }";

const sideOf = (side: string) => (side === "deletions" ? "LEFT" : "RIGHT");

/** A new comment: into your pending review (started now if there's none), unless a send that seemed to fail did
 *  reach GitHub and it's there already. */
const create = async (api: Pick<GitHubApi, "requestForPage">, put: DraftPut): Promise<Sent> => {
  const pending = await graphql(api, PENDING, { id: put.pull });
  if (!pending.ok) return pending.sent;
  const reviews = field(pending.data, "node", "reviews", "nodes");
  const review = list(reviews).find((r) => field(r, "viewerDidAuthor") === true);
  let reviewId: string;
  if (review === undefined) {
    const started = await graphql(api, START, { id: put.pull });
    if (!started.ok) return started.sent;
    reviewId = text(field(started.data, "addPullRequestReview", "pullRequestReview", "id")) ?? "";
  } else {
    const comments = field(review, "comments", "nodes");
    const twin = list(comments).find(
      (c) =>
        field(c, "body") === put.body &&
        field(c, "path") === put.path &&
        (put.file === true || field(c, "line") === put.line),
    );
    const twinId = text(field(twin, "id"));
    if (twinId !== null) return { kind: "done", id: twinId };
    reviewId = text(field(review, "id")) ?? "";
  }
  if (put.replyTo) {
    const replied = await graphql(api, REPLY, { review: reviewId, thread: put.replyTo, body: put.body });
    if (!replied.ok) return replied.sent;
    return { kind: "done", id: text(field(replied.data, "addPullRequestReviewThreadReply", "comment", "id")) };
  }
  const side = sideOf(put.side);
  const startSide = put.startSide ? sideOf(put.startSide) : side;
  const input: Record<string, unknown> = { pullRequestReviewId: reviewId, path: put.path, body: put.body };
  if (put.file) {
    input.subjectType = "FILE";
  } else {
    input.line = put.line;
    input.side = side;
    if (put.startLine !== undefined && put.startLine !== null && (put.startLine !== put.line || startSide !== side)) {
      input.startLine = put.startLine;
      input.startSide = startSide;
    }
  }
  const added = await graphql(api, THREAD, { input });
  if (!added.ok) return added.sent;
  return {
    kind: "done",
    id: text(field(added.data, "addPullRequestReviewThread", "thread", "comments", "nodes", 0, "id")),
  };
};

export const send = async (api: Pick<GitHubApi, "requestForPage">, job: Job, synced: string | null): Promise<Sent> => {
  const { change } = job;
  if (change.op === "put") {
    const id = change.id ?? synced;
    if (!id) return create(api, change);
    const updated = await graphql(api, UPDATE, { id, body: change.body });
    return updated.ok ? { kind: "done", id } : updated.sent;
  }
  const id = change.id ?? synced;
  if (!id) return { kind: "done", id: null };
  const deleted = await graphql(api, DELETE, { id });
  // Refused: already gone (deleted or sent on github.com), or never to be; either way there's nothing more to do.
  return deleted.ok || deleted.sent.kind === "refused" ? { kind: "done", id: null } : deleted.sent;
};

/** Reads what was left from last time and starts sending it; what GitHub refused before gets one more go. `emit`
 *  tells the pages ("drafts", with the pull request's id) after each send. */
export const startDrafts = async (
  api: Pick<GitHubApi, "requestForPage">,
  emit: (event: string, payload: unknown) => void,
) => {
  // A copy: what storage hands back may be its fallback, shared.
  const stored = structuredClone(await draftsItem.getValue());
  const queue = new DraftQueue({
    jobs: Array.isArray(stored.jobs) ? stored.jobs : [],
    ids: typeof stored.ids === "object" && stored.ids !== null ? stored.ids : {},
  });
  queue.retry();
  const settled = new Set<() => void>();
  let saving = Promise.resolve();
  const save = () => {
    const copy = structuredClone(queue.saved);
    saving = saving.then(() => draftsItem.setValue(copy));
    return saving;
  };

  const sender = createSender(async (): Promise<Outcome> => {
    const job = queue.next();
    if (!job) return "idle";
    const sent = await send(api, job, queue.saved.ids[job.change.key]?.comment ?? null);
    queue.settle(job, sent);
    await save();
    for (const done of settled) done();
    // The page showing this pull request reads what changed.
    emit("drafts", job.change.pull);
    return sent.kind === "later" ? "failed" : "sent";
  });

  const change = async (f: () => void) => {
    f();
    await save();
    sender.wake();
  };

  if (queue.saved.jobs.length > 0) sender.wake();

  return {
    put: (put: DraftPut) =>
      change(() => {
        queue.put(put);
      }),
    remove: (pull: string, key: string, id: string | null) =>
      change(() => {
        queue.remove(pull, key, id);
      }),
    retry: (pull: string) =>
      change(() => {
        queue.retry(pull);
      }),
    forget: (pull: string) =>
      change(() => {
        queue.forget(pull);
      }),
    pending: (pull: string) => queue.pending(pull),

    /** Waits until every change to a pull request's comments is on GitHub, to submit the review with all of them.
     *  Fails at once with what GitHub refused, or when it can't be reached. */
    flush: async (pull: string) => {
      const deadline = Date.now() + FLUSH_FOR;
      const { unreachable } = queue;
      for (;;) {
        const jobs = queue.saved.jobs.filter((j) => j.change.pull === pull);
        const refused = jobs.find((j) => j.error !== null);
        if (refused) throw new Error(refused.error!);
        if (jobs.length === 0) return;
        // A send that couldn't reach GitHub says why.
        if (queue.unreachable > unreachable) throw new Error(queue.lastFailure!);
        const left = deadline - Date.now();
        if (left <= 0)
          throw new Error(
            tr(
              "GitHub is taking too long: your comments are kept, try again",
              "O GitHub está demorando: seus comentários estão guardados, tente de novo",
            ),
          );
        sender.wake();
        // oxlint-disable-next-line eslint/no-await-in-loop -- waits for the next send, then looks again
        await new Promise<void>((resolve) => {
          const done = () => {
            settled.delete(done);
            resolve();
          };
          settled.add(done);
          setTimeout(done, left);
        });
      }
    },
  };
};
