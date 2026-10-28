import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";

import { published, usePending } from "@/hooks/use-pending/use-pending";
import type { DraftsState } from "@/utils/bridge/bridge";
import type { Details } from "@/utils/details/details";
import { emit, mockCommands } from "@/utils/fake-platform/fake-platform";
import type { Draft, PullRef, Thread } from "@/utils/review/review";

const REF: PullRef = { owner: "acme", repo: "api", number: 42 };
const PR = "PR_1";
const NO_THREADS: Thread[] = [];
const DETAILS: Details = {
  id: PR,
  number: 42,
  title: "Rename the queue",
  url: "https://github.com/acme/api/pull/42",
  html: "",
  owner: "acme",
  repo: "api",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: true,
  baseRefName: "main",
  headRefName: "rename",
  headRefOid: "abc123",
  updatedAt: "2026-10-26T10:00:00Z",
  additions: 3,
  deletions: 1,
  changedFiles: 1,
  createdAt: "2026-10-25T10:00:00Z",
  author: { login: "mona" },
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
};

const fields = (payload: unknown): Record<string, unknown> =>
  typeof payload === "object" && payload !== null ? Object.fromEntries(Object.entries(payload)) : {};
const parse = (text: string | undefined): unknown => JSON.parse(text ?? "null");

const onGitHub = (id: string, body: string, line = 3) => ({
  id,
  body,
  bodyHTML: `<p>${body}</p>`,
  path: "src/app.ts",
  line,
  originalLine: null,
  startLine: null,
  originalStartLine: null,
  subjectType: "LINE",
  replyTo: null,
});

type World = {
  pending: () => Array<ReturnType<typeof onGitHub>> | Error | Promise<never>;
  state: () => DraftsState | Error | Promise<DraftsState>;
  failing?: string[];
};

function world({ pending, state, failing = [] }: World) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  mockCommands((cmd, payload) => {
    const args = fields(payload);
    calls.push([cmd, args]);
    if (failing.includes(cmd)) throw new Error(`${cmd} failed`);
    if (cmd === "drafts_state") {
      const s = state();
      if (s instanceof Error) throw s;
      return s;
    }
    if (cmd !== "github") return null;
    const query = String(args.body);
    if (!query.includes("PENDING")) return { status: 200, body: JSON.stringify({ data: {} }) };
    const comments = pending();
    if (comments instanceof Error) throw comments;
    if (comments instanceof Promise) return comments;
    const review = {
      id: "REVIEW_1",
      viewerDidAuthor: true,
      comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: comments },
    };
    return {
      status: 200,
      body: JSON.stringify({ data: { repository: { pullRequest: { reviews: { nodes: [review] } } } } }),
    };
  });
  return {
    calls,
    asked: (command: string) => calls.filter(([cmd]) => cmd === command).map(([, args]) => args),
    queries: () => calls.filter(([cmd]) => cmd === "github").map(([, args]) => String(args.body)),
  };
}

const EMPTY: DraftsState = { jobs: [], ids: {} };
const keep = (drafts: Draft[]) => {
  localStorage.setItem(`drafts:${PR}`, JSON.stringify(drafts));
};
const kept = () => parse(localStorage.getItem(`drafts:${PR}`) ?? undefined);
const draft = (key: string, body: string, over: Partial<Draft> = {}): Draft => ({
  key,
  path: "src/app.ts",
  side: "additions",
  line: 3,
  body,
  ...over,
});

const NOTHING = () => {};
const settle = () => act(() => Promise.resolve());

describe("usePending", () => {
  it("opens with the comments kept from last time, then shows GitHub's", async () => {
    keep([draft("k1", "Kept", { id: "C0" })]);
    world({ pending: () => [onGitHub("C1", "On GitHub")], state: () => EMPTY });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    expect(result.current.drafts.map((d) => d.body)).toEqual(["Kept"]);
    await waitFor(() => {
      expect(result.current.drafts.map((d) => d.body)).toEqual(["On GitHub"]);
    });
    expect(kept()).toEqual([expect.objectContaining({ key: "C1", id: "C1", body: "On GitHub" })]);
  });

  it("starts empty when what was kept is spoiled", () => {
    world({ pending: () => new Promise<never>(NOTHING), state: () => EMPTY });
    localStorage.setItem(`drafts:${PR}`, "{oops");
    expect(renderHook(() => usePending(PR, REF, NO_THREADS)).result.current.drafts).toEqual([]);
    localStorage.setItem(`drafts:${PR}`, JSON.stringify({ key: "k1" }));
    expect(renderHook(() => usePending(PR, REF, NO_THREADS)).result.current.drafts).toEqual([]);
  });

  it("sends again what was kept but never reached GitHub", async () => {
    keep([draft("k1", "Lost on the way"), draft("k2", "Arrived", { id: "C2" })]);
    const { asked } = world({ pending: () => [onGitHub("C2", "Arrived")], state: () => EMPTY });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(asked("drafts_put")).toHaveLength(1);
    });
    expect(asked("drafts_put")[0]).toEqual({
      put: { key: "k1", pull: PR, path: "src/app.ts", line: 3, side: "additions", body: "Lost on the way" },
    });
    expect(result.current.sending.has("k1")).toBe(true);
    expect(result.current.drafts.map((d) => d.body)).toEqual(["Arrived", "Lost on the way"]);
  });

  it("sends nothing again without knowing both GitHub's and Rust's side", async () => {
    keep([draft("k1", "Lost on the way")]);
    const noGitHub = world({ pending: () => new Error("offline"), state: () => EMPTY });
    const first = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(noGitHub.asked("drafts_state")).toHaveLength(1);
    });
    expect(noGitHub.asked("drafts_put")).toEqual([]);
    expect(first.result.current.drafts.map((d) => d.body)).toEqual(["Lost on the way"]);
    first.unmount();

    const noRust = world({ pending: () => [], state: () => new Error("no state") });
    renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(noRust.queries()).toHaveLength(1);
    });
    await settle();
    expect(noRust.asked("drafts_put")).toEqual([]);
  });

  it("asks again when Rust says one of this pull request's comments went, not another's", async () => {
    const { asked } = world({ pending: () => [], state: () => EMPTY });
    const { unmount } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(asked("drafts_state")).toHaveLength(1);
    });
    await act(async () => {
      await emit("drafts", "PR_OTHER");
    });
    expect(asked("drafts_state")).toHaveLength(1);
    await act(async () => {
      await emit("drafts", PR);
    });
    await waitFor(() => {
      expect(asked("drafts_state")).toHaveLength(2);
    });
    unmount();
    await settle();
    await act(async () => {
      await emit("drafts", PR);
    });
    expect(asked("drafts_state")).toHaveLength(2);
  });

  it("takes only the latest answer when it's asked twice", async () => {
    const answers: Array<(s: DraftsState) => void> = [];
    const { asked } = world({
      pending: () => [],
      state: () =>
        new Promise<DraftsState>((resolve) => {
          answers.push(resolve);
        }),
    });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(asked("drafts_state")).toHaveLength(1);
    });
    await act(async () => {
      await emit("drafts", PR);
    });
    await waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    const failed = { change: { op: "remove" as const, key: "k9", pull: PR }, error: "Old" };
    answers[1]?.({ jobs: [{ ...failed, error: "Newest" }], ids: {} });
    await settle();
    answers[0]?.({ jobs: [failed], ids: {} });
    await settle();
    expect(result.current.errors).toEqual({ k9: "Newest" });
  });

  it("shows a new comment at once and sends it, and its edits", () => {
    const { asked } = world({ pending: () => new Promise<never>(NOTHING), state: () => EMPTY });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    act(() => {
      result.current.add({ path: "src/app.ts", side: "deletions", line: 9, body: "Why?" });
    });
    const [written] = result.current.drafts;
    expect(written).toMatchObject({ path: "src/app.ts", side: "deletions", line: 9, body: "Why?" });
    expect(result.current.sending.has(written!.key)).toBe(true);
    expect(asked("drafts_put")).toMatchObject([{ put: { key: written!.key, body: "Why?" } }]);
    expect(kept()).toEqual([expect.objectContaining({ body: "Why?" })]);

    act(() => {
      result.current.add({ path: "src/app.ts", side: "additions", line: 2, body: "Nice" });
    });
    act(() => {
      result.current.edit(written!.key, "Why this?");
      result.current.edit("nobody", "Ignored");
    });
    expect(result.current.drafts.map((d) => d.body)).toEqual(["Why this?", "Nice"]);
    expect(asked("drafts_put")).toHaveLength(3);
  });

  it("removes a comment at once, here and on GitHub", () => {
    keep([draft("k1", "Gone soon", { id: "C1" }), draft("k2", "Stays")]);
    const { asked } = world({
      pending: () => new Promise<never>(NOTHING),
      state: () => EMPTY,
      failing: ["drafts_remove"],
    });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    act(() => {
      result.current.remove("k1");
      result.current.remove("never-there");
    });
    expect(result.current.drafts.map((d) => d.body)).toEqual(["Stays"]);
    expect(asked("drafts_remove")).toEqual([
      { pull: PR, key: "k1", id: "C1" },
      { pull: PR, key: "never-there", id: null },
    ]);
  });

  it("keeps a comment shown when it can't be handed to Rust", async () => {
    world({ pending: () => new Promise<never>(NOTHING), state: () => EMPTY, failing: ["drafts_put"] });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    act(() => {
      result.current.add({ path: "src/app.ts", side: "additions", line: 1, body: "Still here" });
    });
    await settle();
    expect(result.current.drafts.map((d) => d.body)).toEqual(["Still here"]);
  });

  it("says why GitHub refused a comment, and tries again when asked", async () => {
    let state: DraftsState = {
      jobs: [
        {
          change: { op: "put", key: "k1", pull: PR, path: "a.ts", line: 1, side: "additions", body: "x" },
          error: "Line gone",
        },
        {
          change: { op: "put", key: "k2", pull: PR, path: "a.ts", line: 2, side: "additions", body: "y" },
          error: null,
        },
      ],
      ids: {},
    };
    const { asked } = world({ pending: () => [], state: () => state });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(result.current.errors).toEqual({ k1: "Line gone" });
    });
    expect([...result.current.sending]).toEqual(["k2"]);
    state = EMPTY;
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.errors).toEqual({});
    });
    expect(asked("drafts_retry")).toEqual([{ pull: PR }]);
  });

  it("submits the review, then starts over from what GitHub has", async () => {
    keep([draft("k1", "Nit", { id: "C1" })]);
    const { asked, queries } = world({ pending: () => [onGitHub("C1", "Nit")], state: () => EMPTY });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(result.current.drafts).toHaveLength(1);
    });
    await act(async () => {
      await result.current.submit(DETAILS, "APPROVE", " Ship it ");
    });
    expect(asked("drafts_flush")).toEqual([{ pull: PR }]);
    expect(asked("drafts_forget")).toEqual([{ pull: PR }]);
    expect(parse(queries().find((q) => q.includes("submitPullRequestReview")))).toMatchObject({
      variables: { id: "REVIEW_1", event: "APPROVE", body: "Ship it" },
    });
  });

  it("throws the review away, then starts over", async () => {
    const { asked, queries } = world({ pending: () => [onGitHub("C1", "Nit")], state: () => EMPTY });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(result.current.drafts).toHaveLength(1);
    });
    await act(async () => {
      await result.current.discard(DETAILS);
    });
    expect(asked("drafts_forget")).toEqual([{ pull: PR }]);
    expect(queries().some((q) => q.includes("deletePullRequestReview"))).toBe(true);
  });

  it("still shows the comments when they can't be kept on this machine", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    world({ pending: () => [onGitHub("C1", "On GitHub")], state: () => EMPTY });
    const { result } = renderHook(() => usePending(PR, REF, NO_THREADS));
    await waitFor(() => {
      expect(result.current.drafts.map((d) => d.body)).toEqual(["On GitHub"]);
    });
  });
});

const comment = (id: string, pending = false) => ({
  id,
  databaseId: 1,
  author: { login: "mona" },
  html: "",
  at: "",
  url: "",
  pending,
});
const thread = (id: string, comments: Thread["comments"], pending = false): Thread => ({
  id,
  path: "a.ts",
  side: "additions",
  line: 1,
  resolved: false,
  outdated: false,
  comments,
  pending,
});

describe("published", () => {
  it("leaves out conversations and replies in your pending review", () => {
    const untouched = thread("T1", [comment("c1")]);
    expect(
      published([
        untouched,
        thread("T2", [comment("c2", true)], true),
        thread("T3", [comment("c3"), comment("c4", true)]),
      ]),
    ).toEqual([untouched, thread("T3", [comment("c3")])]);
    expect(published([untouched])[0]).toBe(untouched);
  });
});
