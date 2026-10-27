import type { DraftPut } from "@focus-diff/desktop/utils/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftQueue, draftsItem, FLUSH_FOR, graphql, send, startDrafts, type Job } from "./drafts";

const put = (key: string, body: string, more: Partial<DraftPut> = {}): DraftPut => ({
  key,
  pull: "PR_1",
  path: "a.ts",
  line: 3,
  side: "additions",
  body,
  ...more,
});

type Call = { query: string; variables: Record<string, unknown> };
type Reply = { status?: number; body: unknown } | Error;

/** GitHub's GraphQL, answered by `answer` for each call; the calls are kept. */
const gitHub = (answer: (call: Call) => Reply) => {
  const calls: Call[] = [];
  const api = {
    requestForPage: vi.fn<
      (method: string, path: string, body: string | null) => Promise<{ status: number; body: string }>
    >((_method, _path, body) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test reads back, or plants, data in the shape it knows
      const call = JSON.parse(body!) as Call;
      calls.push(call);
      const reply = answer(call);
      if (reply instanceof Error) return Promise.reject(reply);
      return Promise.resolve({
        status: reply.status ?? 200,
        body: typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body),
      });
    }),
  };
  return { api, calls };
};

const data = (value: unknown) => ({ body: { data: value } });

afterEach(() => {
  vi.useRealTimers();
});

describe("the queue of changes", () => {
  it("keeps the latest text", () => {
    const q = new DraftQueue();
    q.put(put("k1", "first"));
    q.put(put("k2", "other"));
    q.put(put("k1", "second"));
    expect(q.saved.jobs.map((j) => (j.change.op === "put" ? j.change.body : ""))).toEqual(["other", "second"]);
  });

  it("keeps a change made while sending, which gets the id", () => {
    const q = new DraftQueue();
    q.put(put("k1", "first"));
    const sending = q.next()!;
    q.put(put("k1", "second"));
    q.settle(sending, { kind: "done", id: "C_1" });
    expect(q.saved.jobs).toEqual([{ change: { op: "put", ...put("k1", "second") }, error: null }]);
    expect(q.pending("PR_1").ids).toEqual({ k1: "C_1" });
    // Nor is the newer change marked refused for the older one.
    q.settle(sending, { kind: "refused", why: "no" });
    expect(q.saved.jobs[0]!.error).toBeNull();
  });

  it("drops what wasn't sent on removing, and forgets the id once deleted", () => {
    const q = new DraftQueue();
    q.put(put("k1", "first"));
    q.settle(q.next()!, { kind: "done", id: "C_1" });
    q.put(put("k1", "edit"));
    q.remove("PR_1", "k1", null);
    expect(q.saved.jobs).toHaveLength(1);
    const removing = q.next()!;
    expect(removing.change.op).toBe("remove");
    q.settle(removing, { kind: "done", id: null });
    expect(q.saved).toEqual({ jobs: [], ids: {} });
    expect(q.next()).toBeUndefined();
  });

  it("keeps a refusal with why, waiting for the person", () => {
    const q = new DraftQueue();
    q.put(put("k1", "first"));
    q.put(put("k2", "second"));
    q.settle(q.next()!, { kind: "refused", why: "line must be part of the diff" });
    expect(q.saved.jobs[0]!.error).toBe("line must be part of the diff");
    expect(q.next()!.change.key).toBe("k2");
    q.put(put("k3", "elsewhere", { pull: "PR_2" }));
    q.saved.jobs[2]!.error = "no";
    q.retry("PR_1");
    expect(q.saved.jobs.map((j) => j.error)).toEqual([null, null, "no"]);
  });

  it("keeps the job when GitHub can't be reached, and counts it", () => {
    const q = new DraftQueue();
    q.put(put("k1", "first"));
    q.settle(q.next()!, { kind: "later", why: "offline" });
    expect(q.saved.jobs).toHaveLength(1);
    expect([q.unreachable, q.lastFailure]).toEqual([1, "offline"]);
  });

  it("forgets one pull request and leaves the others", () => {
    const q = new DraftQueue();
    q.put(put("k1", "first"));
    q.put(put("k2", "second", { pull: "PR_2" }));
    q.settle(q.next()!, { kind: "done", id: "C_1" });
    q.forget("PR_1");
    expect(q.saved.jobs.map((j) => j.change.pull)).toEqual(["PR_2"]);
    expect(q.saved.ids).toEqual({});
    q.retry();
    expect(q.pending("PR_2").jobs).toHaveLength(1);
  });
});

describe("GitHub's answers", () => {
  const ask = (reply: Reply) => graphql(gitHub(() => reply).api, "q", {});

  it("are its data, or why not", async () => {
    await expect(ask(data({ a: 1 }))).resolves.toEqual({ ok: true, data: { a: 1 } });
    await expect(ask({ body: {} })).resolves.toEqual({ ok: true, data: {} });
    await expect(ask({ body: { errors: [{ message: "nope" }] } })).resolves.toEqual({
      ok: false,
      sent: { kind: "refused", why: "nope" },
    });
    await expect(ask({ body: { errors: [{}] } })).resolves.toMatchObject({ sent: { why: "GitHub refused it" } });
    await expect(ask({ status: 422, body: { message: "Validation Failed" } })).resolves.toMatchObject({
      sent: { kind: "refused", why: "Validation Failed" },
    });
    await expect(ask({ status: 404, body: "not json" })).resolves.toMatchObject({
      sent: { kind: "refused", why: "GitHub returned 404" },
    });
    for (const status of [401, 403, 429, 502])
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await expect(ask({ status, body: "" })).resolves.toMatchObject({ sent: { kind: "later" } });
    await expect(ask(new Error("offline"))).resolves.toEqual({ ok: false, sent: { kind: "later", why: "offline" } });
    const api = {
      requestForPage: vi.fn<() => Promise<{ status: number; body: string }>>(() => Promise.reject("down")),
    };
    await expect(graphql(api, "q", {})).resolves.toMatchObject({ sent: { why: "down" } });
  });
});

describe("sending a change", () => {
  const job = (change: Job["change"]): Job => ({ change, error: null });

  it("edits a comment already on GitHub", async () => {
    const { api, calls } = gitHub(() => data({}));
    await expect(send(api, job({ op: "put", ...put("k", "new"), id: "C_9" }), null)).resolves.toEqual({
      kind: "done",
      id: "C_9",
    });
    await expect(send(api, job({ op: "put", ...put("k", "new") }), "C_8")).resolves.toEqual({
      kind: "done",
      id: "C_8",
    });
    expect(calls[1]!.variables).toEqual({ id: "C_8", body: "new" });
    const refused = gitHub(() => ({ body: { errors: [{ message: "gone" }] } }));
    await expect(send(refused.api, job({ op: "put", ...put("k", "x"), id: "C_9" }), null)).resolves.toMatchObject({
      kind: "refused",
    });
  });

  it("deletes one on GitHub, and takes a refusal as done", async () => {
    const { api, calls } = gitHub(() => data({}));
    await expect(send(api, job({ op: "remove", key: "k", pull: "PR_1", id: "C_1" }), null)).resolves.toEqual({
      kind: "done",
      id: null,
    });
    expect(calls[0]!.query).toContain("deletePullRequestReviewComment");
    await expect(send(api, job({ op: "remove", key: "k", pull: "PR_1" }), null)).resolves.toEqual({
      kind: "done",
      id: null,
    });
    expect(calls).toHaveLength(1);
    const refused = gitHub(() => ({ body: { errors: [{ message: "gone" }] } }));
    await expect(send(refused.api, job({ op: "remove", key: "k", pull: "P", id: null }), "C_1")).resolves.toEqual({
      kind: "done",
      id: null,
    });
    const offline = gitHub(() => new Error("offline"));
    await expect(send(offline.api, job({ op: "remove", key: "k", pull: "P", id: "C" }), null)).resolves.toMatchObject({
      kind: "later",
    });
  });

  it("starts a pending review when there's none, and adds a conversation on a line", async () => {
    const { api, calls } = gitHub(({ query }) =>
      query.startsWith("query")
        ? data({ node: { reviews: { nodes: [{ id: "R_other", viewerDidAuthor: false }] } } })
        : query.includes("addPullRequestReview(")
          ? data({ addPullRequestReview: { pullRequestReview: { id: "R_1" } } })
          : data({ addPullRequestReviewThread: { thread: { comments: { nodes: [{ id: "C_1" }] } } } }),
    );
    await expect(send(api, job({ op: "put", ...put("k", "hi") }), null)).resolves.toEqual({ kind: "done", id: "C_1" });
    expect(calls[2]!.variables).toEqual({
      input: { pullRequestReviewId: "R_1", path: "a.ts", body: "hi", line: 3, side: "RIGHT" },
    });
  });

  it("says several lines across both sides, or a whole file", async () => {
    const { api, calls } = gitHub(({ query }) =>
      query.startsWith("query")
        ? data({ node: { reviews: { nodes: [{ id: "R_1", viewerDidAuthor: true }] } } })
        : data({}),
    );
    await send(api, job({ op: "put", ...put("a", "x", { side: "deletions", startLine: 1 }) }), null);
    await send(api, job({ op: "put", ...put("b", "x", { startLine: 3, startSide: "deletions" }) }), null);
    await send(api, job({ op: "put", ...put("c", "x", { startLine: 3 }) }), null);
    await send(api, job({ op: "put", ...put("d", "x", { file: true }) }), null);
    const inputs = calls
      .filter((c) => c.query.includes("AddPullRequestReviewThreadInput"))
      .map((c) => c.variables.input);
    expect(inputs).toEqual([
      { pullRequestReviewId: "R_1", path: "a.ts", body: "x", line: 3, side: "LEFT", startLine: 1, startSide: "LEFT" },
      { pullRequestReviewId: "R_1", path: "a.ts", body: "x", line: 3, side: "RIGHT", startLine: 3, startSide: "LEFT" },
      { pullRequestReviewId: "R_1", path: "a.ts", body: "x", line: 3, side: "RIGHT" },
      { pullRequestReviewId: "R_1", path: "a.ts", body: "x", subjectType: "FILE" },
    ]);
  });

  it("finds a comment that did arrive though its send seemed to fail", async () => {
    const twin = (comments: unknown) =>
      gitHub(() => data({ node: { reviews: { nodes: [{ id: "R_1", viewerDidAuthor: true, comments }] } } }));
    const nodes = {
      nodes: [
        { id: "C_x", body: "hi", path: "a.ts", line: 9 },
        { id: "C_1", body: "hi", path: "a.ts", line: 3 },
      ],
    };
    await expect(send(twin(nodes).api, job({ op: "put", ...put("k", "hi") }), null)).resolves.toEqual({
      kind: "done",
      id: "C_1",
    });
    await expect(
      send(
        twin({ nodes: [{ id: "C_f", body: "hi", path: "a.ts", line: null }] }).api,
        job({ op: "put", ...put("k", "hi", { file: true }) }),
        null,
      ),
    ).resolves.toEqual({ kind: "done", id: "C_f" });
  });

  it("replies to a conversation", async () => {
    const { api, calls } = gitHub(({ query }) =>
      query.startsWith("query")
        ? data({ node: { reviews: { nodes: [{ viewerDidAuthor: true }] } } })
        : data({ addPullRequestReviewThreadReply: { comment: { id: "C_r" } } }),
    );
    await expect(send(api, job({ op: "put", ...put("k", "yes", { replyTo: "T_1" }) }), null)).resolves.toEqual({
      kind: "done",
      id: "C_r",
    });
    expect(calls[1]!.variables).toEqual({ review: "", thread: "T_1", body: "yes" });
  });

  it("stops at the first step GitHub turns down", async () => {
    const failing = (step: string) =>
      gitHub(({ query }) => {
        if (query.includes(step)) return { body: { errors: [{ message: step }] } };
        if (query.startsWith("query")) return data({ node: null });
        return data({ addPullRequestReview: {} });
      }).api;
    for (const step of ["query", "addPullRequestReview(", "addPullRequestReviewThread("])
      // oxlint-disable-next-line eslint/no-await-in-loop -- one after another, in order, as the code under test takes them
      await expect(send(failing(step), job({ op: "put", ...put("k", "x") }), null)).resolves.toEqual({
        kind: "refused",
        why: step,
      });
    await expect(
      send(failing("addPullRequestReviewThreadReply"), job({ op: "put", ...put("k", "x", { replyTo: "T" }) }), null),
    ).resolves.toMatchObject({ kind: "refused" });
    const nothing = gitHub(({ query }) => (query.startsWith("query") ? data({}) : data({}))).api;
    await expect(send(nothing, job({ op: "put", ...put("k", "x") }), null)).resolves.toEqual({
      kind: "done",
      id: null,
    });
  });
});

describe("the drafts on their way", () => {
  it("are sent as they're made, kept in storage, and the page is told", async () => {
    const { api } = gitHub(({ query }) =>
      query.startsWith("query")
        ? data({ node: { reviews: { nodes: [{ id: "R_1", viewerDidAuthor: true }] } } })
        : data({ addPullRequestReviewThread: { thread: { comments: { nodes: [{ id: "C_1" }] } } } }),
    );
    const emit = vi.fn<(event: string, payload: unknown) => void>();
    const drafts = await startDrafts(api, emit);
    await drafts.put(put("k1", "hi"));
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledWith("drafts", "PR_1");
    });
    expect(drafts.pending("PR_1")).toEqual({ jobs: [], ids: { k1: "C_1" } });
    await expect(draftsItem.getValue()).resolves.toEqual({ jobs: [], ids: { k1: { pull: "PR_1", comment: "C_1" } } });
    await drafts.flush("PR_1");
  });

  it("start again with what was left, giving refusals another go", async () => {
    await draftsItem.setValue({
      jobs: [{ change: { op: "remove", key: "k", pull: "PR_1", id: "C_1" }, error: "earlier" }],
      ids: {},
    });
    const { api, calls } = gitHub(() => data({}));
    await startDrafts(api, vi.fn<(event: string, payload: unknown) => void>());
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
  });

  it("start empty from what doesn't read", async () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the test reads back, or plants, data in the shape it knows
    await draftsItem.setValue({ jobs: "broken" as unknown as Job[], ids: null as unknown as Record<string, never> });
    const { api } = gitHub(() => data({}));
    const fresh = await startDrafts(api, vi.fn<(event: string, payload: unknown) => void>());
    expect(fresh.pending("PR_1")).toEqual({ jobs: [], ids: {} });
  });

  it("are tried again after a failure, and a submit waiting on them is told", async () => {
    vi.useFakeTimers();
    const { api } = gitHub(() => new Error("offline"));
    const drafts = await startDrafts(api, vi.fn<(event: string, payload: unknown) => void>());
    await drafts.put(put("k1", "hi", { id: "C_1" }));
    await expect(drafts.flush("PR_1")).rejects.toThrow("offline");
    await drafts.retry("PR_1");
    await drafts.remove("PR_1", "k1", "C_1");
    expect(drafts.pending("PR_1").jobs).toHaveLength(1);
    await drafts.forget("PR_1");
    expect(drafts.pending("PR_1").jobs).toHaveLength(0);
  });

  it("make a submit wait for them, then say what GitHub refused", async () => {
    vi.useFakeTimers();
    const { api } = gitHub(() => ({ body: { errors: [{ message: "line must be part of the diff" }] } }));
    // GitHub taking a second to answer.
    const slow = {
      requestForPage: async (...args: Parameters<typeof api.requestForPage>) => {
        await vi.advanceTimersByTimeAsync(0);
        await new Promise((resolve) => {
          setTimeout(resolve, 1000);
        });
        return api.requestForPage(...args);
      },
    };
    const drafts = await startDrafts(slow, vi.fn<(event: string, payload: unknown) => void>());
    await drafts.put(put("k1", "hi", { id: "C_1" }));
    const flushed = drafts.flush("PR_1").catch(String);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(flushed).resolves.toContain("line must be part of the diff");
  });

  it("give up waiting on GitHub after a while, keeping the comments", async () => {
    vi.useFakeTimers();
    const api = {
      requestForPage: vi.fn<() => Promise<{ status: number; body: string }>>(() => new Promise<never>(() => {})),
    };
    const drafts = await startDrafts(api, vi.fn<(event: string, payload: unknown) => void>());
    await drafts.put(put("k1", "hi", { id: "C_1" }));
    const flushed = drafts.flush("PR_1").catch(String);
    await vi.advanceTimersByTimeAsync(FLUSH_FOR);
    await expect(flushed).resolves.toContain("GitHub is taking too long: your comments are kept, try again");
    expect(drafts.pending("PR_1").jobs).toHaveLength(1);
  });
});
