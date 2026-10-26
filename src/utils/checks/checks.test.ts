import { describe, expect, it } from "vite-plus/test";

import { countChecks, failedRuns, groupChecks, parseLog, toCheck, type CheckItem } from "@/utils/checks/checks";

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
      run("lint", "COMPLETED", "FAILURE"),
      run("build", "COMPLETED", "FAILURE", true),
      run("e2e", "QUEUED", null),
      run("docs", "COMPLETED", "SKIPPED"),
    ];
    expect(groupChecks(list).map((g) => [g.state, g.checks.map((c) => c.name)])).toEqual([
      ["failure", ["build", "lint"]],
      ["pending", ["e2e"]],
      ["neutral", ["docs"]],
      ["success", ["z"]],
    ]);
    expect(countChecks(list)).toEqual({ failure: 2, pending: 1, neutral: 1, success: 1 });
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
});

describe("logs", () => {
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
