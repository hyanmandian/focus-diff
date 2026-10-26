// A pull request's checks in full, as GitHub's checks list has them: grouped by how they went, each
// with its summary, its annotations on lines and its steps, a GitHub Actions job's log (fetched by
// Rust, logs.rs, and only its end when it's long), and re-running or approving workflow runs.

import { useCallback, useEffect, useRef, useState } from "react";

import { github, graphql } from "../bridge/bridge";
import { invoke } from "../platform/platform";
import type { PullRef } from "../review/review";

export type CheckState = "failure" | "pending" | "neutral" | "success";
export type CheckItem = {
  id: string;
  /** A check run (an app's, such as GitHub Actions) or a commit status (an older kind, from CI services). */
  kind: "run" | "status";
  name: string;
  /** The workflow a GitHub Actions job is from. */
  workflow: string | null;
  state: CheckState;
  /** GitHub's own word for how it went: "cancelled", "timed_out", "queued"... lowercase. */
  detail: string;
  /** What it says of itself, in one line. */
  description: string | null;
  url: string | null;
  required: boolean;
  startedAt: string | null;
  completedAt: string | null;
  /** A GitHub Actions job: its id (for its log and re-running it) and its run's. */
  job: number | null;
  run: number | null;
};

const QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on CheckRun { id databaseId name status conclusion detailsUrl startedAt completedAt title isRequired(pullRequestNumber: $number)
        checkSuite { app { slug } workflowRun { databaseId workflow { name } } } }
      ... on StatusContext { id context state targetUrl description createdAt isRequired(pullRequestNumber: $number) }
    }
  } } } } } } }
}`;

type RawNode = {
  __typename: "CheckRun" | "StatusContext";
  id: string;
  databaseId?: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  title?: string | null;
  isRequired: boolean;
  checkSuite?: {
    app: { slug: string } | null;
    workflowRun: { databaseId: number; workflow: { name: string } } | null;
  } | null;
  context?: string;
  state?: string;
  targetUrl?: string | null;
  description?: string | null;
  createdAt?: string;
};
type Raw = {
  repository: {
    pullRequest: {
      commits: {
        nodes: Array<{
          commit: {
            oid: string;
            statusCheckRollup: null | {
              contexts: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RawNode[] };
            };
          };
        }>;
      };
    };
  };
};

const FAILED = new Set(["FAILURE", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);

/** How a finished check run or step went, by GitHub's conclusion. */
const concluded = (conclusion: string): CheckState =>
  conclusion === "SUCCESS" ? "success" : FAILED.has(conclusion) ? "failure" : "neutral";

/** One check as the list shows it. */
export function toCheck(node: RawNode): CheckItem {
  if (node.__typename === "StatusContext") {
    const state: CheckState =
      node.state === "SUCCESS"
        ? "success"
        : node.state === "PENDING" || node.state === "EXPECTED"
          ? "pending"
          : "failure";
    return {
      id: node.id,
      kind: "status",
      name: node.context ?? "",
      workflow: null,
      state,
      detail: (node.state ?? "").toLowerCase(),
      description: node.description ?? null,
      url: node.targetUrl ?? null,
      required: node.isRequired,
      startedAt: node.createdAt ?? null,
      completedAt: null,
      job: null,
      run: null,
    };
  }
  const done = node.status === "COMPLETED";
  const conclusion = node.conclusion ?? "";
  const state = done ? concluded(conclusion) : "pending";
  const actions = node.checkSuite?.app?.slug === "github-actions";
  return {
    id: node.id,
    kind: "run",
    name: node.name ?? "",
    workflow: node.checkSuite?.workflowRun?.workflow.name ?? null,
    state,
    detail: (done ? conclusion : (node.status ?? "")).toLowerCase(),
    description: node.title ?? null,
    url: node.detailsUrl ?? null,
    required: node.isRequired,
    startedAt: node.startedAt ?? null,
    completedAt: node.completedAt ?? null,
    job: actions ? (node.databaseId ?? null) : null,
    run: actions ? (node.checkSuite?.workflowRun?.databaseId ?? null) : null,
  };
}

/** A query asked again for sure: Rust answers the same query from memory for two minutes
 *  (github.rs), which a poll for what changed must get past. */
export const fresh = (query: string) => `${query}\n# ${Date.now()}`;

/** Every check on the head commit, 100 a page. `again`: past Rust's memory of the last answer. */
export async function loadChecks(ref: PullRef, again = false): Promise<{ head: string | null; checks: CheckItem[] }> {
  const checks: CheckItem[] = [];
  let head: string | null = null;
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last one's cursor
    const data: Raw = await graphql<Raw>(again ? fresh(QUERY) : QUERY, {
      owner: ref.owner,
      name: ref.repo,
      number: ref.number,
      after,
    });
    const commit = data.repository.pullRequest.commits.nodes[0]?.commit;
    head = commit?.oid ?? null;
    const contexts = commit?.statusCheckRollup?.contexts;
    if (!contexts) break;
    checks.push(
      ...contexts.nodes
        .filter((n) => n.__typename === "CheckRun" || n.__typename === "StatusContext")
        .map((n) => toCheck(n)),
    );
    if (!contexts.pageInfo.hasNextPage) break;
    after = contexts.pageInfo.endCursor;
  }
  return { head, checks };
}

export type Group = { state: CheckState; checks: CheckItem[] };
const ORDER: CheckState[] = ["failure", "pending", "neutral", "success"];

/** The checks grouped as GitHub groups them: failing, then in progress, skipped, successful; each
 *  group required first, then by name. Empty groups are left out. */
export function groupChecks(checks: CheckItem[]): Group[] {
  return ORDER.map((state) => ({
    state,
    checks: checks
      .filter((c) => c.state === state)
      .toSorted((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name)),
  })).filter((g) => g.checks.length);
}

/** How many of each, for the summary line. */
export function countChecks(checks: CheckItem[]): Record<CheckState, number> {
  const count = (state: CheckState) => checks.filter((c) => c.state === state).length;
  return { failure: count("failure"), pending: count("pending"), neutral: count("neutral"), success: count("success") };
}

/** The workflow runs that have failed jobs, each once: what "Re-run failed jobs" re-runs. */
export const failedRuns = (checks: CheckItem[]) => [
  ...new Set(checks.filter((c) => c.state === "failure" && c.run).map((c) => c.run!)),
];
/** Every workflow run with a job here. */
export const allRuns = (checks: CheckItem[]) => [
  ...new Set(checks.filter((c) => c.run && c.state !== "pending").map((c) => c.run!)),
];

// MARK: One check, opened

export type Annotation = {
  path: string;
  line: number | null;
  level: "FAILURE" | "WARNING" | "NOTICE";
  title: string | null;
  message: string;
};
export type Step = { number: number; name: string; state: CheckState };
export type CheckDetail = { summary: string | null; text: string | null; annotations: Annotation[]; steps: Step[] };

/** Trimmed text, or null when there's none. */
function nonBlank(text: string | null | undefined) {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  return trimmed;
}

/** What a check run says beyond its name: its summary, annotations (the lines it complains about)
 *  and, for an Actions job, its steps. */
export async function loadCheckDetail(id: string): Promise<CheckDetail> {
  type R = {
    node: null | {
      summary: string | null;
      text: string | null;
      annotations: {
        nodes: Array<{
          path: string;
          annotationLevel: Annotation["level"] | null;
          title: string | null;
          message: string;
          location: { start: { line: number } } | null;
        }>;
      } | null;
      steps: { nodes: Array<{ number: number; name: string; status: string; conclusion: string | null }> } | null;
    };
  };
  const data = await graphql<R>(
    `
      query ($id: ID!) {
        node(id: $id) {
          ... on CheckRun {
            summary
            text
            annotations(first: 50) {
              nodes {
                path
                annotationLevel
                title
                message
                location {
                  start {
                    line
                  }
                }
              }
            }
            steps(first: 100) {
              nodes {
                number
                name
                status
                conclusion
              }
            }
          }
        }
      }
    `,
    { id },
  );
  const node = data.node;
  return {
    summary: nonBlank(node?.summary),
    text: nonBlank(node?.text),
    annotations: (node?.annotations?.nodes ?? []).map((a) => ({
      path: a.path,
      line: a.location?.start.line ?? null,
      level: a.annotationLevel ?? "NOTICE",
      title: a.title,
      message: a.message,
    })),
    steps: (node?.steps?.nodes ?? []).map((s) => ({
      number: s.number,
      name: s.name,
      state: s.status === "COMPLETED" ? concluded(s.conclusion ?? "") : "pending",
    })),
  };
}

export type Log = { text: string; truncated: boolean };

/** A GitHub Actions job's log, through Rust (logs.rs): only its last part when it's long. `done`:
 *  the job has finished, so its log won't change and can be kept. */
export const loadLog = (ref: PullRef, job: number, done: boolean) =>
  invoke<Log>("job_log", { owner: ref.owner, repo: ref.repo, job, done });

export type LogLine = { text: string; kind: "group" | "error" | "warning" | "command" | "plain" };

/** A log as it reads: without the timestamps and terminal colours, GitHub's markers turned into
 *  kinds (a group's title, an error, a warning, a command run), empty group ends dropped. */
export function parseLog(text: string): LogLine[] {
  const lines: LogLine[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw
      .replace(/^﻿?\d{4}-\d\d-\d\dT[\d:.]+Z ?/u, "")
      // oxlint-disable-next-line eslint/no-control-regex -- the escape character is what starts a colour code
      .replaceAll(/\u001B\[[0-9;]*[A-Za-z]/gu, "");
    const marker = /^##\[(\w+)\](.*)$/u.exec(line);
    if (marker) {
      const [, name, rest = ""] = marker;
      if (name === "endgroup") continue;
      const kind =
        name === "group"
          ? "group"
          : name === "error"
            ? "error"
            : name === "warning"
              ? "warning"
              : name === "command"
                ? "command"
                : "plain";
      lines.push({ text: rest, kind });
    } else if (line.startsWith("[command]")) lines.push({ text: line.slice(9), kind: "command" });
    else lines.push({ text: line, kind: "plain" });
  }
  while (lines.length > 0 && !lines.at(-1)!.text) lines.pop();
  return lines;
}

// MARK: Re-running

const actions = (ref: PullRef) => `/repos/${ref.owner}/${ref.repo}/actions`;
export const rerunFailed = (ref: PullRef, run: number) =>
  github("POST", `${actions(ref)}/runs/${run}/rerun-failed-jobs`, {});
export const rerunAll = (ref: PullRef, run: number) => github("POST", `${actions(ref)}/runs/${run}/rerun`, {});
export const rerunJob = (ref: PullRef, job: number) => github("POST", `${actions(ref)}/jobs/${job}/rerun`, {});
export const approveRun = (ref: PullRef, run: number) => github("POST", `${actions(ref)}/runs/${run}/approve`, {});

/** Workflow runs from a fork waiting for someone with write access to let them run. */
export async function awaitingApproval(ref: PullRef, head: string): Promise<Array<{ id: number; name: string }>> {
  type R = { workflow_runs: Array<{ id: number; name: string | null; display_title: string }> };
  const data = await github<R>("GET", `${actions(ref)}/runs?head_sha=${head}&status=action_required&per_page=20`);
  return data.workflow_runs.map((r) => ({ id: r.id, name: r.name ?? r.display_title }));
}

/** The checks as a hook: what the details had at once, all of them after, asked again every few
 *  seconds while any is running and the window is in front. `after(head)` on each load. */
export function useChecks(ref: PullRef, head: string | undefined, initial: CheckItem[] | null) {
  const [checks, setChecks] = useState<CheckItem[] | null>(initial);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const latest = useRef(0);
  const reload = useCallback(
    async (again = false) => {
      const mine = ++latest.current;
      try {
        const result = await loadChecks(ref, again);
        if (mine !== latest.current) return;
        setChecks(result.checks);
        setLoadedFor(result.head);
      } catch {
        // What's shown stands; the next poll tries again.
      }
    },
    [ref],
  );
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- reload sets state only once GitHub answers, not synchronously
    if (head) void reload();
  }, [head, reload]);
  const running = Boolean(checks?.some((c) => c.state === "pending"));
  useEffect(() => {
    const POLL = 10_000;
    const timer = running
      ? window.setInterval(() => {
          if (document.visibilityState === "visible") void reload(true);
        }, POLL)
      : undefined;
    return () => {
      window.clearInterval(timer);
    };
  }, [running, reload]);
  return { checks: checks ?? initial ?? [], loaded: loadedFor !== null, running, reload, setChecks };
}
