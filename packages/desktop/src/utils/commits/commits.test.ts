import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";

import {
  commitRange,
  inRange,
  loadCommits,
  loadRangeFiles,
  sameRange,
  sinceReview,
  useCommits,
  useRangeFiles,
  type Commit,
  type Commits,
  type Range,
} from "@/utils/commits/commits";
import { ok, replyInOrder } from "@/utils/fake-platform/fake-platform";
import { shelve, shelved } from "@/utils/shelf/shelf";

const ref = { owner: "acme", repo: "web", number: 7 };

const nothing = () => {};

function later() {
  let release: (value: unknown) => void = nothing;
  const reply = new Promise((resolve) => {
    release = resolve;
  });
  return {
    reply,
    release: (value: unknown) => {
      release(value);
    },
  };
}

const rawCommit = (oid: string, more: Record<string, unknown> = {}) => ({
  oid,
  abbreviatedOid: oid.slice(0, 3),
  messageHeadline: `Headline ${oid}`,
  messageBody: "",
  committedDate: "2026-01-01T00:00:00Z",
  author: { name: "Ana Lima", avatarUrl: "a.png", user: { login: "ana" } },
  signature: null,
  statusCheckRollup: null,
  parents: { nodes: [{ oid: "base" }] },
  ...more,
});

const commitsPage = (nodes: unknown[], next: string | null = null, extra: Record<string, unknown> = {}) =>
  ok({
    data: {
      repository: {
        pullRequest: {
          viewerLatestReview: null,
          timelineItems: { nodes: [] },
          commits: {
            pageInfo: { hasNextPage: next !== null, endCursor: next },
            nodes: nodes.map((commit) => ({ commit })),
          },
          ...extra,
        },
      },
    },
  });

const commit = (oid: string, parent: string | null): Commit => ({
  oid,
  short: oid.slice(0, 7),
  headline: oid,
  body: "",
  at: "2026-01-01T00:00:00Z",
  author: { login: "ana", name: "Ana", avatarUrl: null },
  verified: null,
  ci: null,
  parent,
});
const commits = [commit("a", "base"), commit("b", "a"), commit("c", "b"), commit("d", "c")];
const list = (reviewed: string | null): Commits => ({ commits, forcePushes: [], reviewed });

describe("ranges", () => {
  it("makes one commit's range from its parent", () => {
    expect(commitRange(commits, 1, 1)).toEqual({ from: "a", to: "b" });
    expect(commitRange(commits, 0, 0)).toEqual({ from: "base", to: "a" });
  });

  it("makes a run of commits in either order, and all of them no range at all", () => {
    expect(commitRange(commits, 2, 1)).toEqual({ from: "a", to: "c" });
    expect(commitRange(commits, 0, 3)).toBeNull();
    expect(commitRange(commits, 5, 5)).toBeNull();
  });

  it("can't start a range at a first commit without a parent", () => {
    expect(commitRange([commit("a", null), commit("b", "a")], 0, 0)).toBeNull();
  });

  it("knows which commits a range shows", () => {
    expect(inRange(commits, null)).toEqual([0, 1, 2, 3]);
    expect(inRange(commits, { from: "a", to: "c" })).toEqual([1, 2]);
    expect(inRange(commits, { from: "base", to: "a" })).toEqual([0]);
    expect(inRange(commits, { from: "gone", to: "d" })).toEqual([]);
    expect(inRange(commits, { from: "a", to: "gone" })).toEqual([]);
    expect(inRange(commits, { from: "c", to: "b" })).toEqual([]);
  });

  it("compares ranges by their commits", () => {
    expect(sameRange({ from: "a", to: "b" }, { from: "a", to: "b" })).toBe(true);
    expect(sameRange(null, null)).toBe(true);
    expect(sameRange(null, { from: "a", to: "b" })).toBe(false);
  });
});

describe("since your last review", () => {
  it("goes from the commit reviewed to the head", () => {
    expect(sinceReview(list("b"))).toEqual({ range: { from: "b", to: "d" }, count: 2, rewritten: false });
  });

  it("is nothing when not reviewed, or when nothing's new", () => {
    expect(sinceReview(list(null))).toBeNull();
    expect(sinceReview({ commits: [], forcePushes: [], reviewed: "a" })).toBeNull();
    expect(sinceReview(list("d"))).toBeNull();
  });

  it("compares the two versions after a force push", () => {
    expect(sinceReview(list("old"))).toEqual({ range: { from: "old", to: "d" }, count: 0, rewritten: true });
  });
});

describe("loadCommits", () => {
  it("reads the commits, force pushes and the commit you last reviewed", async () => {
    const calls = replyInOrder(
      commitsPage(
        [
          rawCommit("c1", {
            signature: { isValid: true },
            statusCheckRollup: { state: "SUCCESS" },
            messageBody: "Why",
          }),
          rawCommit("c2", {
            author: { name: null, avatarUrl: null, user: { login: "bo" } },
            signature: { isValid: false },
            statusCheckRollup: { state: "FAILURE" },
            parents: { nodes: [] },
          }),
          rawCommit("c3", { author: null, statusCheckRollup: { state: "ERROR" } }),
          rawCommit("c4", {
            author: { name: null, avatarUrl: null, user: null },
            statusCheckRollup: { state: "PENDING" },
          }),
          rawCommit("c5", { statusCheckRollup: { state: "EXPECTED" } }),
          rawCommit("c6", { statusCheckRollup: { state: "NEUTRAL" } }),
        ],
        "p1",
        {
          viewerLatestReview: { commit: { oid: "c1" } },
          timelineItems: {
            nodes: [
              {
                createdAt: "2026-01-02",
                actor: { login: "ana" },
                beforeCommit: { oid: "x" },
                afterCommit: { oid: "y" },
              },
              { createdAt: "2026-01-03", actor: null, beforeCommit: null, afterCommit: null },
              {},
            ],
          },
        },
      ),
      commitsPage([rawCommit("c7")], null, { viewerLatestReview: { commit: { oid: "ignored" } } }),
    );
    const loaded = await loadCommits(ref);
    expect(loaded.reviewed).toBe("c1");
    expect(loaded.forcePushes).toEqual([
      { at: "2026-01-02", actor: "ana", before: "x", after: "y" },
      { at: "2026-01-03", actor: null, before: null, after: null },
    ]);
    expect(loaded.commits[0]).toEqual({
      oid: "c1",
      short: "c1",
      headline: "Headline c1",
      body: "Why",
      at: "2026-01-01T00:00:00Z",
      author: { login: "ana", name: "Ana Lima", avatarUrl: "a.png" },
      verified: true,
      ci: "success",
      parent: "base",
    });
    expect(loaded.commits.map((c) => [c.author.name, c.author.login, c.verified, c.ci, c.parent])).toEqual([
      ["Ana Lima", "ana", true, "success", "base"],
      ["bo", "bo", false, "failure", null],
      ["", null, null, "failure", "base"],
      ["", null, null, "pending", "base"],
      ["Ana Lima", "ana", null, "pending", "base"],
      ["Ana Lima", "ana", null, null, "base"],
      ["Ana Lima", "ana", null, null, "base"],
    ]);
    expect(JSON.parse(String(calls[1]?.fields.body))).toMatchObject({ variables: { after: "p1", number: 7 } });
  });

  it("reads three pages at most, as GitHub lists no more than 250 commits", async () => {
    const calls = replyInOrder(
      commitsPage([rawCommit("a")], "p1", { viewerLatestReview: { commit: null } }),
      commitsPage([rawCommit("b")], "p2"),
      commitsPage([rawCommit("c")], "p3"),
      commitsPage([rawCommit("d")]),
    );
    const loaded = await loadCommits(ref);
    expect(loaded.reviewed).toBeNull();
    expect(loaded.commits.map((c) => c.oid)).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(3);
  });
});

describe("useCommits", () => {
  it("shows the kept copy at once, then GitHub's, and keeps that", async () => {
    const kept: Commits = { commits: [commit("old", "base")], forcePushes: [], reviewed: null };
    shelve("commits:PR_1", kept);
    replyInOrder(commitsPage([rawCommit("new")]));
    const { result } = renderHook(() => useCommits("PR_1", ref, "h1"));
    expect(result.current).toEqual(kept);
    await waitFor(() => {
      expect(result.current?.commits.map((c) => c.oid)).toEqual(["new"]);
    });
    expect(shelved<Commits>("commits:PR_1")?.value.commits[0]?.oid).toBe("new");
  });

  it("waits for a head, and keeps what it has when GitHub fails", async () => {
    const calls = replyInOrder({ status: 500, body: "{}" });
    const { result, rerender } = renderHook(({ head }: { head?: string }) => useCommits("PR_2", ref, head), {
      initialProps: {},
    });
    expect(result.current).toBeNull();
    expect(calls).toEqual([]);
    rerender({ head: "h1" });
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it("drops an answer that comes after it's gone", async () => {
    const slow = later();
    replyInOrder(slow.reply);
    const { result, unmount } = renderHook(() => useCommits("PR_3", ref, "h1"));
    unmount();
    await act(async () => {
      slow.release(commitsPage([rawCommit("late")]));
      await slow.reply;
    });
    expect(result.current).toBeNull();
    expect(shelved("commits:PR_3")).toBeNull();
  });
});

describe("loadRangeFiles", () => {
  it("reads what a range changes in the pull request's shape, asking GitHub once", async () => {
    const calls = replyInOrder(
      ok({
        files: [
          { filename: "a.ts", status: "modified", additions: 1, deletions: 1, patch: "@@ -1 +1 @@\n-a\n+b" },
          { filename: "new.ts", previous_filename: "old.ts", status: "renamed", additions: 0, deletions: 0 },
        ],
      }),
    );
    const range = { from: "r1", to: "r2" };
    const files = await loadRangeFiles(ref, range);
    expect(files).toEqual([
      {
        path: "a.ts",
        previousPath: null,
        status: "modified",
        additions: 1,
        deletions: 1,
        patch: "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n",
      },
      { path: "new.ts", previousPath: "old.ts", status: "renamed", additions: 0, deletions: 0, patch: "" },
    ]);
    expect(await loadRangeFiles(ref, range)).toBe(files);
    expect(calls).toEqual([
      {
        cmd: "github",
        fields: { method: "GET", path: "/repos/acme/web/compare/r1...r2?per_page=1", body: null, accept: null },
      },
    ]);
  });

  it("has no files when GitHub lists none", async () => {
    replyInOrder(ok({}));
    expect(await loadRangeFiles(ref, { from: "e1", to: "e2" })).toEqual([]);
  });

  it("asks again after a failure", async () => {
    const calls = replyInOrder({ status: 404, body: JSON.stringify({ message: "Not Found" }) }, ok({ files: [] }));
    await expect(loadRangeFiles(ref, { from: "f1", to: "f2" })).rejects.toThrow("Not Found");
    expect(await loadRangeFiles(ref, { from: "f1", to: "f2" })).toEqual([]);
    expect(calls).toHaveLength(2);
  });
});

describe("useRangeFiles", () => {
  const file = { filename: "a.ts", status: "added", additions: 1, deletions: 0 };

  it("has nothing for no range", () => {
    const calls = replyInOrder();
    const { result } = renderHook(() => useRangeFiles(ref, null));
    expect(result.current).toEqual({ files: null, error: null });
    expect(calls).toEqual([]);
  });

  it("loads a range's files, and nothing shows for another range until its own come", async () => {
    const second = later();
    replyInOrder(ok({ files: [file] }), second.reply);
    const { result, rerender } = renderHook(({ range }: { range: Range }) => useRangeFiles(ref, range), {
      initialProps: { range: { from: "u1", to: "u2" } },
    });
    expect(result.current.files).toBeNull();
    await waitFor(() => {
      expect(result.current.files?.map((f) => f.path)).toEqual(["a.ts"]);
    });
    rerender({ range: { from: "u2", to: "u3" } });
    expect(result.current.files).toBeNull();
    await act(async () => {
      second.release(ok({ files: [] }));
      await second.reply;
    });
    expect(result.current.files).toEqual([]);
  });

  it("says what went wrong, until the range changes", async () => {
    const second = later();
    replyInOrder({ status: 403, body: JSON.stringify({ message: "Forbidden" }) }, second.reply);
    const { result, rerender } = renderHook<ReturnType<typeof useRangeFiles>, { range: Range }>(
      ({ range }) => useRangeFiles(ref, range),
      {
        initialProps: { range: { from: "v1", to: "v2" } },
      },
    );
    await waitFor(() => {
      expect(result.current.error).toBe("Forbidden");
    });
    rerender({ range: null });
    expect(result.current.error).toBeNull();
    rerender({ range: { from: "v2", to: "v3" } });
    expect(result.current.error).toBeNull();
    await act(async () => {
      // oxlint-disable-next-line eslint/prefer-promise-reject-errors, typescript/prefer-promise-reject-errors -- Rust's errors reach the page as strings
      second.release(Promise.reject("offline"));
      await second.reply.catch(Boolean);
    });
    await waitFor(() => {
      expect(result.current.error).toBe("offline");
    });
  });

  it("starts over for another pull request", async () => {
    replyInOrder({ status: 500, body: JSON.stringify({ message: "Boom" }) }, ok({ files: [] }));
    const { result, rerender } = renderHook(
      ({ pull }: { pull: typeof ref }) => useRangeFiles(pull, { from: "w1", to: "w2" }),
      {
        initialProps: { pull: ref },
      },
    );
    await waitFor(() => {
      expect(result.current.error).toBe("Boom");
    });
    rerender({ pull: { ...ref, repo: "api" } });
    expect(result.current.error).toBeNull();
    await waitFor(() => {
      expect(result.current.files).toEqual([]);
    });
  });

  it("drops answers that come after it's gone", async () => {
    const files = later();
    const failure = later();
    replyInOrder(files.reply, failure.reply);
    const first = renderHook(() => useRangeFiles(ref, { from: "x1", to: "x2" }));
    const second = renderHook(() => useRangeFiles(ref, { from: "x3", to: "x4" }));
    first.unmount();
    second.unmount();
    await act(async () => {
      files.release(ok({ files: [file] }));
      failure.release({ status: 500, body: "{}" });
      await Promise.all([files.reply, failure.reply]);
    });
    expect(first.result.current).toEqual({ files: null, error: null });
    expect(second.result.current).toEqual({ files: null, error: null });
  });
});
