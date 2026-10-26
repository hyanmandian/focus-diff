import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mockCommands } from "../fake-platform/fake-platform";
import type { Args } from "../platform/platform";
import {
  allRuns,
  approveRun,
  awaitingApproval,
  countChecks,
  failedRuns,
  groupChecks,
  loadCheckDetail,
  loadChecks,
  loadLog,
  parseLog,
  rerunAll,
  rerunFailed,
  rerunJob,
  toCheck,
  useChecks,
  type CheckItem,
} from "./checks";

const ref = { owner: "acme", repo: "web", number: 7 };

type Call = { cmd: string; fields: Record<string, unknown> };
const fields = (args: Args | undefined): Record<string, unknown> =>
  args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array ? {} : args;
const ok = (data: unknown) => ({ status: 200, body: JSON.stringify(data) });

/** Rust answering each call with the next reply, keeping what was asked. */
function rust(...replies: unknown[]) {
  const calls: Call[] = [];
  mockCommands((cmd, args) => {
    calls.push({ cmd, fields: fields(args) });
    return replies[calls.length - 1];
  });
  return calls;
}

const body = (call: Call | undefined) => String(call?.fields.body);

/** One page of the checks query's answer. */
const page = (nodes: unknown[], next: string | null = null, oid = "h1") =>
  ok({
    data: {
      repository: {
        pullRequest: {
          commits: {
            nodes: [
              {
                commit: {
                  oid,
                  statusCheckRollup: { contexts: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } },
                },
              },
            ],
          },
        },
      },
    },
  });
const runNode = (id: string, status = "COMPLETED", conclusion: string | null = "SUCCESS") => ({
  __typename: "CheckRun",
  id,
  name: id,
  status,
  conclusion,
  isRequired: false,
});

const run = (name: string, status: string, conclusion: string | null, required = false, runId = 1) =>
  toCheck({
    __typename: "CheckRun",
    id: name,
    databaseId: 10,
    name,
    status,
    conclusion,
    isRequired: required,
    checkSuite: { app: { slug: "github-actions" }, workflowRun: { databaseId: runId, workflow: { name: "CI" } } },
  });

const status = (state?: string) => toCheck({ __typename: "StatusContext", id: "s", state, isRequired: false });
const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const nothing = () => {};

describe("checks", () => {
  it("reads check runs and commit statuses", () => {
    expect(run("a", "COMPLETED", "SUCCESS")).toMatchObject({ state: "success", workflow: "CI", job: 10, run: 1 });
    expect(run("b", "IN_PROGRESS", null)).toMatchObject({ state: "pending", detail: "in_progress" });
    expect(run("c", "COMPLETED", "TIMED_OUT")).toMatchObject({ state: "failure", detail: "timed_out" });
    expect(run("d", "COMPLETED", "CANCELLED")).toMatchObject({ state: "neutral" });
    expect(
      toCheck({ __typename: "StatusContext", id: "s", context: "ci/vercel", state: "PENDING", isRequired: true }),
    ).toMatchObject({ kind: "status", name: "ci/vercel", state: "pending", required: true, job: null });
  });

  it("reads every commit status state, and what's missing as empty", () => {
    expect(status("SUCCESS").state).toBe("success");
    expect(status("EXPECTED").state).toBe("pending");
    expect(status("ERROR")).toMatchObject({ state: "failure", detail: "error" });
    expect(status()).toEqual({
      id: "s",
      kind: "status",
      name: "",
      workflow: null,
      state: "failure",
      detail: "",
      description: null,
      url: null,
      required: false,
      startedAt: null,
      completedAt: null,
      job: null,
      run: null,
    });
    expect(
      toCheck({
        __typename: "StatusContext",
        id: "s",
        context: "ci",
        state: "SUCCESS",
        description: "All good",
        targetUrl: "https://ci.test",
        createdAt: "2026-01-01T00:00:00Z",
        isRequired: false,
      }),
    ).toMatchObject({ description: "All good", url: "https://ci.test", startedAt: "2026-01-01T00:00:00Z" });
  });

  it("reads a check run with little said of it", () => {
    expect(toCheck({ __typename: "CheckRun", id: "r", isRequired: false })).toEqual({
      id: "r",
      kind: "run",
      name: "",
      workflow: null,
      state: "pending",
      detail: "",
      description: null,
      url: null,
      required: false,
      startedAt: null,
      completedAt: null,
      job: null,
      run: null,
    });
    expect(toCheck({ __typename: "CheckRun", id: "r", status: "COMPLETED", isRequired: false }).state).toBe("neutral");
    expect(
      toCheck({
        __typename: "CheckRun",
        id: "r",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        title: "3 passed",
        detailsUrl: "https://x.test",
        startedAt: "a",
        completedAt: "b",
        isRequired: false,
        checkSuite: { app: { slug: "github-actions" }, workflowRun: null },
      }),
    ).toMatchObject({ description: "3 passed", url: "https://x.test", startedAt: "a", completedAt: "b", job: null });
  });

  it("has no job to log or re-run for other apps' check runs", () => {
    expect(
      toCheck({
        __typename: "CheckRun",
        id: "x",
        databaseId: 5,
        name: "x",
        status: "COMPLETED",
        conclusion: "FAILURE",
        isRequired: false,
        checkSuite: { app: { slug: "circleci" }, workflowRun: null },
      }),
    ).toMatchObject({ job: null, run: null });
  });

  it("groups as GitHub does, required first in each", () => {
    const list: CheckItem[] = [
      run("z", "COMPLETED", "SUCCESS"),
      run("y", "COMPLETED", "SUCCESS"),
      run("lint", "COMPLETED", "FAILURE"),
      run("build", "COMPLETED", "FAILURE", true),
      run("e2e", "QUEUED", null),
      run("docs", "COMPLETED", "SKIPPED"),
    ];
    expect(groupChecks(list).map((g) => [g.state, g.checks.map((c) => c.name)])).toEqual([
      ["failure", ["build", "lint"]],
      ["pending", ["e2e"]],
      ["neutral", ["docs"]],
      ["success", ["y", "z"]],
    ]);
    expect(countChecks(list)).toEqual({ failure: 2, pending: 1, neutral: 1, success: 2 });
  });

  it("re-runs each failed workflow run once", () => {
    expect(
      failedRuns([
        run("a", "COMPLETED", "FAILURE", false, 7),
        run("b", "COMPLETED", "FAILURE", false, 7),
        run("c", "COMPLETED", "FAILURE", false, 8),
        run("d", "COMPLETED", "SUCCESS", false, 9),
      ]),
    ).toEqual([7, 8]);
  });

  it("re-runs every workflow run that's done, each once", () => {
    expect(
      allRuns([
        run("a", "COMPLETED", "FAILURE", false, 7),
        run("b", "COMPLETED", "SUCCESS", false, 7),
        run("c", "IN_PROGRESS", null, false, 8),
        toCheck({ __typename: "StatusContext", id: "s", state: "SUCCESS", isRequired: false }),
      ]),
    ).toEqual([7]);
  });
});

describe("loadChecks", () => {
  it("reads every page of checks on the head commit", async () => {
    const calls = rust(
      page([runNode("a"), { __typename: "Mystery", id: "m" }], "c1"),
      page([{ __typename: "StatusContext", id: "s", context: "ci", state: "SUCCESS", isRequired: true }]),
    );
    const { head, checks } = await loadChecks(ref);
    expect(head).toBe("h1");
    expect(checks.map((c) => [c.kind, c.name])).toEqual([
      ["run", "a"],
      ["status", "ci"],
    ]);
    expect(JSON.parse(body(calls[0]))).toMatchObject({
      variables: { owner: "acme", name: "web", number: 7, after: null },
    });
    expect(JSON.parse(body(calls[1]))).toMatchObject({ variables: { after: "c1" } });
    expect(body(calls[0])).not.toMatch(/# \d+/u);
  });

  it("asks past Rust's memory when told to", async () => {
    const calls = rust(page([]));
    await loadChecks(ref, true);
    expect(body(calls[0])).toMatch(/# \d+/u);
  });

  it("stops after ten pages", async () => {
    const calls = rust(...Array.from({ length: 12 }, (_, i) => page([runNode(`r${i}`)], `c${i}`)));
    expect((await loadChecks(ref)).checks).toHaveLength(10);
    expect(calls).toHaveLength(10);
  });

  it("has nothing when the commit has no checks, or there's no commit", async () => {
    const none = ok({
      data: {
        repository: { pullRequest: { commits: { nodes: [{ commit: { oid: "h2", statusCheckRollup: null } }] } } },
      },
    });
    rust(none);
    expect(await loadChecks(ref)).toEqual({ head: "h2", checks: [] });
    rust(ok({ data: { repository: { pullRequest: { commits: { nodes: [] } } } } }));
    expect(await loadChecks(ref)).toEqual({ head: null, checks: [] });
  });
});

describe("loadCheckDetail", () => {
  it("reads the summary, annotations and steps", async () => {
    const calls = rust(
      ok({
        data: {
          node: {
            summary: "  Tests failed  ",
            text: " ",
            annotations: {
              nodes: [
                {
                  path: "a.ts",
                  annotationLevel: "FAILURE",
                  title: "Boom",
                  message: "x",
                  location: { start: { line: 3 } },
                },
                { path: "b.ts", annotationLevel: null, title: null, message: "y", location: null },
              ],
            },
            steps: {
              nodes: [
                { number: 1, name: "Set up", status: "COMPLETED", conclusion: "SUCCESS" },
                { number: 2, name: "Test", status: "COMPLETED", conclusion: "FAILURE" },
                { number: 3, name: "Lint", status: "COMPLETED", conclusion: null },
                { number: 4, name: "Deploy", status: "QUEUED", conclusion: null },
              ],
            },
          },
        },
      }),
    );
    expect(await loadCheckDetail("CR_1")).toEqual({
      summary: "Tests failed",
      text: null,
      annotations: [
        { path: "a.ts", line: 3, level: "FAILURE", title: "Boom", message: "x" },
        { path: "b.ts", line: null, level: "NOTICE", title: null, message: "y" },
      ],
      steps: [
        { number: 1, name: "Set up", state: "success" },
        { number: 2, name: "Test", state: "failure" },
        { number: 3, name: "Lint", state: "neutral" },
        { number: 4, name: "Deploy", state: "pending" },
      ],
    });
    expect(JSON.parse(body(calls[0]))).toMatchObject({ variables: { id: "CR_1" } });
  });

  it("has nothing to show for a check that isn't there or says nothing", async () => {
    const empty = { summary: null, text: null, annotations: [], steps: [] };
    rust(ok({ data: { node: null } }));
    expect(await loadCheckDetail("x")).toEqual(empty);
    rust(ok({ data: { node: { summary: null, text: "Text", annotations: null, steps: null } } }));
    expect(await loadCheckDetail("x")).toEqual({ ...empty, text: "Text" });
  });
});

describe("re-running", () => {
  it("asks GitHub Actions to re-run or approve", async () => {
    const calls = rust(ok({}), ok({}), ok({}), ok({}));
    await rerunFailed(ref, 1);
    await rerunAll(ref, 2);
    await rerunJob(ref, 3);
    await approveRun(ref, 4);
    expect(calls.map((c) => [c.fields.method, c.fields.path])).toEqual([
      ["POST", "/repos/acme/web/actions/runs/1/rerun-failed-jobs"],
      ["POST", "/repos/acme/web/actions/runs/2/rerun"],
      ["POST", "/repos/acme/web/actions/jobs/3/rerun"],
      ["POST", "/repos/acme/web/actions/runs/4/approve"],
    ]);
  });

  it("lists the runs waiting for approval, named by their workflow or title", async () => {
    const calls = rust(
      ok({
        workflow_runs: [
          { id: 1, name: "CI", display_title: "Fix" },
          { id: 2, name: null, display_title: "Fix" },
        ],
      }),
    );
    expect(await awaitingApproval(ref, "h1")).toEqual([
      { id: 1, name: "CI" },
      { id: 2, name: "Fix" },
    ]);
    expect(calls[0]?.fields.path).toBe("/repos/acme/web/actions/runs?head_sha=h1&status=action_required&per_page=20");
  });
});

describe("logs", () => {
  it("asks Rust for a job's log", async () => {
    const calls = rust({ text: "log", truncated: false });
    expect(await loadLog(ref, 5, true)).toEqual({ text: "log", truncated: false });
    expect(calls).toEqual([{ cmd: "job_log", fields: { owner: "acme", repo: "web", job: 5, done: true } }]);
  });

  it("reads command markers and leaves unknown ones as plain text", () => {
    expect(parseLog("##[command]git fetch\n##[group]\n##[debug]Evaluating")).toEqual([
      { text: "git fetch", kind: "command" },
      { text: "", kind: "group" },
      { text: "Evaluating", kind: "plain" },
    ]);
  });

  it("drops timestamps and colours, and reads GitHub's markers", () => {
    const text = [
      "﻿2026-10-26T12:00:00.0000000Z ##[group]Run tests",
      "2026-10-26T12:00:01.1234567Z [command]/usr/bin/npm test",
      "2026-10-26T12:00:02.0000000Z \u001B[31mFAIL\u001B[0m src/a.test.ts",
      "2026-10-26T12:00:03.0000000Z ##[error]Process completed with exit code 1.",
      "2026-10-26T12:00:03.0000000Z ##[warning]Node 16 is deprecated",
      "2026-10-26T12:00:04.0000000Z ##[endgroup]",
      "",
    ].join("\r\n");
    expect(parseLog(text)).toEqual([
      { text: "Run tests", kind: "group" },
      { text: "/usr/bin/npm test", kind: "command" },
      { text: "FAIL src/a.test.ts", kind: "plain" },
      { text: "Process completed with exit code 1.", kind: "error" },
      { text: "Node 16 is deprecated", kind: "warning" },
    ]);
  });

  it("keeps lines without timestamps as they are", () => {
    expect(parseLog("plain line\n  indented")).toEqual([
      { text: "plain line", kind: "plain" },
      { text: "  indented", kind: "plain" },
    ]);
  });
});

describe("useChecks", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows what it was given until there's a head to load for", () => {
    const calls = rust();
    const initial = [run("a", "COMPLETED", "SUCCESS")];
    const { result, rerender } = renderHook(() => useChecks(ref, undefined, initial));
    expect(result.current).toMatchObject({ checks: initial, loaded: false, running: false });
    rerender();
    expect(result.current.checks).toBe(initial);
    expect(calls).toEqual([]);
  });

  it("has an empty list when given nothing", () => {
    rust();
    const { result, rerender } = renderHook(() => useChecks(ref, undefined, null));
    expect(result.current.checks).toEqual([]);
    rerender();
    expect(result.current.checks).toEqual([]);
    act(() => {
      result.current.setChecks(null);
    });
    expect(result.current.checks).toEqual([]);
  });

  it("falls back to what it was given when its own list is cleared", () => {
    rust();
    const initial = [run("a", "COMPLETED", "SUCCESS")];
    const { result } = renderHook(() => useChecks(ref, undefined, initial));
    act(() => {
      result.current.setChecks(null);
    });
    expect(result.current.checks).toEqual(initial);
  });

  it("loads the checks, then asks again every ten seconds while one runs and the window is in front", async () => {
    vi.useFakeTimers();
    const calls = rust(
      page([runNode("e2e", "IN_PROGRESS", null)]),
      page([runNode("e2e", "IN_PROGRESS", null)]),
      page([runNode("e2e")]),
    );
    const { result, unmount } = renderHook(() => useChecks(ref, "h1", null));
    await flush();
    expect(result.current).toMatchObject({ loaded: true, running: true });
    expect(result.current.checks.map((c) => c.state)).toEqual(["pending"]);

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(calls).toHaveLength(1);

    visibility.mockReturnValue("visible");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(calls).toHaveLength(2);
    expect(body(calls[1])).toMatch(/# \d+/u);

    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(result.current).toMatchObject({ running: false });
    expect(result.current.checks.map((c) => c.state)).toEqual(["success"]);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(calls).toHaveLength(3);
    unmount();
  });

  it("stops asking once it's gone", async () => {
    vi.useFakeTimers();
    const calls = rust(page([runNode("e2e", "IN_PROGRESS", null)]));
    const { unmount } = renderHook(() => useChecks(ref, "h1", null));
    await flush();
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(calls).toHaveLength(1);
  });

  it("keeps only the latest answer when asked twice", async () => {
    let first: (value: unknown) => void = nothing;
    const slow = new Promise((resolve) => {
      first = resolve;
    });
    const calls = rust(slow, page([runNode("new")], null, "h2"));
    const { result } = renderHook(() => useChecks(ref, undefined, null));
    let older: Promise<void> = Promise.resolve();
    await act(async () => {
      older = result.current.reload();
      await result.current.reload();
    });
    expect(result.current.checks.map((c) => c.name)).toEqual(["new"]);
    await act(async () => {
      first(page([runNode("old")]));
      await older;
    });
    expect(result.current.checks.map((c) => c.name)).toEqual(["new"]);
    expect(calls).toHaveLength(2);
  });

  it("keeps what's shown when GitHub fails", async () => {
    rust({ status: 502, body: "{}" });
    const initial = [run("a", "COMPLETED", "SUCCESS")];
    const { result } = renderHook(() => useChecks(ref, undefined, initial));
    await act(() => result.current.reload());
    expect(result.current).toMatchObject({ checks: initial, loaded: false });
  });
});
