import { useEffect, useState } from "react";

import { github, graphql } from "@/utils/bridge/bridge";
import { errorText } from "@/utils/error/error";
import { header, type PullRef, type ReviewFile } from "@/utils/review/review";
import { shelve, shelved } from "@/utils/shelf/shelf";

export type Ci = "success" | "failure" | "pending" | null;
export type Commit = {
  oid: string;
  short: string;
  headline: string;
  body: string;
  at: string;
  author: { login: string | null; name: string; avatarUrl: string | null };
  verified: boolean | null;
  ci: Ci;
  parent: string | null;
};
export type ForcePush = { at: string; actor: string | null; before: string | null; after: string | null };
export type Commits = {
  commits: Commit[];
  forcePushes: ForcePush[];
  reviewed: string | null;
};

export type Range = { from: string; to: string } | null;

const QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    viewerLatestReview { commit { oid } }
    timelineItems(last: 30, itemTypes: [HEAD_REF_FORCE_PUSHED_EVENT]) { nodes { ... on HeadRefForcePushedEvent { createdAt actor { login } beforeCommit { oid } afterCommit { oid } } } }
    commits(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { commit {
      oid abbreviatedOid messageHeadline messageBody committedDate
      author { name avatarUrl(size: 64) user { login } }
      signature { isValid }
      statusCheckRollup { state }
      parents(first: 1) { nodes { oid } }
    } } }
  } }
}`;

type RawCommit = {
  oid: string;
  abbreviatedOid: string;
  messageHeadline: string;
  messageBody: string;
  committedDate: string;
  author: { name: string | null; avatarUrl: string | null; user: { login: string } | null } | null;
  signature: { isValid: boolean } | null;
  statusCheckRollup: { state: string } | null;
  parents: { nodes: Array<{ oid: string }> };
};
type Raw = {
  repository: {
    pullRequest: {
      viewerLatestReview: { commit: { oid: string } | null } | null;
      timelineItems: {
        nodes: Array<{
          createdAt: string;
          actor: { login: string } | null;
          beforeCommit: { oid: string } | null;
          afterCommit: { oid: string } | null;
        }>;
      };
      commits: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ commit: RawCommit }> };
    };
  };
};

const rollup = (state: string | undefined): Ci =>
  state === "SUCCESS"
    ? "success"
    : state === "FAILURE" || state === "ERROR"
      ? "failure"
      : state === "PENDING" || state === "EXPECTED"
        ? "pending"
        : null;

export async function loadCommits(ref: PullRef): Promise<Commits> {
  const commits: Commit[] = [];
  let forcePushes: ForcePush[] = [];
  let reviewed: string | null = null;
  let after: string | null = null;
  for (let page = 0; page < 3; page++) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each page starts after the last one's cursor
    const data: Raw = await graphql<Raw>(QUERY, { owner: ref.owner, name: ref.repo, number: ref.number, after });
    const pr = data.repository.pullRequest;
    if (page === 0) {
      reviewed = pr.viewerLatestReview?.commit?.oid ?? null;
      forcePushes = pr.timelineItems.nodes
        .filter((e) => e.createdAt)
        .map((e) => ({
          at: e.createdAt,
          actor: e.actor?.login ?? null,
          before: e.beforeCommit?.oid ?? null,
          after: e.afterCommit?.oid ?? null,
        }));
    }
    for (const { commit: c } of pr.commits.nodes) {
      commits.push({
        oid: c.oid,
        short: c.abbreviatedOid,
        headline: c.messageHeadline,
        body: c.messageBody,
        at: c.committedDate,
        author: {
          login: c.author?.user?.login ?? null,
          name: c.author?.name ?? c.author?.user?.login ?? "",
          avatarUrl: c.author?.avatarUrl ?? null,
        },
        verified: c.signature ? c.signature.isValid : null,
        ci: rollup(c.statusCheckRollup?.state),
        parent: c.parents.nodes[0]?.oid ?? null,
      });
    }
    if (!pr.commits.pageInfo.hasNextPage) break;
    after = pr.commits.pageInfo.endCursor;
  }
  return { commits, forcePushes, reviewed };
}

export function useCommits(prId: string, ref: PullRef, head: string | undefined) {
  const [list, setList] = useState<Commits | null>(() => shelved<Commits>(`commits:${prId}`)?.value ?? null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const c = await loadCommits(ref);
        if (!live) return;
        setList(c);
        shelve(`commits:${prId}`, c);
      } catch {}
    };
    if (head) void load();
    return () => {
      live = false;
    };
  }, [prId, ref, head]);
  return list;
}

export function commitRange(commits: Commit[], a: number, b: number): Range {
  const first = commits[Math.min(a, b)];
  const last = commits[Math.max(a, b)];
  if (!first || !last) return null;
  if (Math.min(a, b) === 0 && Math.max(a, b) === commits.length - 1) return null;
  if (!first.parent) return null;
  return { from: first.parent, to: last.oid };
}

export function sinceReview(list: Commits): { range: NonNullable<Range>; count: number; rewritten: boolean } | null {
  const head = list.commits.at(-1);
  if (!list.reviewed || !head || list.reviewed === head.oid) return null;
  const at = list.commits.findIndex((c) => c.oid === list.reviewed);
  if (at === -1) return { range: { from: list.reviewed, to: head.oid }, count: 0, rewritten: true };
  return { range: { from: list.reviewed, to: head.oid }, count: list.commits.length - 1 - at, rewritten: false };
}

export function inRange(commits: Commit[], range: Range): number[] {
  if (!range) return commits.map((_, i) => i);
  const end = commits.findIndex((c) => c.oid === range.to);
  if (end === -1) return [];
  const start = commits.findIndex((c) => c.oid === range.from);
  const first = start === -1 ? commits.findIndex((c) => c.parent === range.from) : start + 1;
  if (first === -1 || first > end) return [];
  return Array.from({ length: end - first + 1 }, (_, i) => first + i);
}

export const sameRange = (a: Range, b: Range) => a?.from === b?.from && a?.to === b?.to;

const compared = new Map<string, Promise<ReviewFile[]>>();

export function loadRangeFiles(ref: PullRef, range: NonNullable<Range>): Promise<ReviewFile[]> {
  const key = `${ref.owner}/${ref.repo}:${range.from}...${range.to}`;
  const known = compared.get(key);
  if (known) return known;
  type Compared = {
    files?: Array<{
      filename: string;
      previous_filename?: string;
      status: ReviewFile["status"];
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  };
  const files = github<Compared>(
    "GET",
    `/repos/${ref.owner}/${ref.repo}/compare/${range.from}...${range.to}?per_page=1`,
  ).then((data) =>
    (data.files ?? []).map((f) => ({
      path: f.filename,
      previousPath: f.previous_filename ?? null,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ? `${header(f)}\n${f.patch}\n` : "",
    })),
  );
  compared.set(key, files);
  files.catch(() => compared.delete(key));
  return files;
}

export function useRangeFiles(ref: PullRef, range: Range) {
  const [files, setFiles] = useState<{ key: string; files: ReviewFile[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = range?.from;
  const to = range?.to;
  const key = from && to ? `${from}...${to}` : "";
  const [asked, setAsked] = useState({ ref, key });
  if (asked.ref !== ref || asked.key !== key) {
    setAsked({ ref, key });
    setError(null);
  }
  useEffect(() => {
    let live = true;
    const load = async (ends: NonNullable<Range>) => {
      try {
        const f = await loadRangeFiles(ref, ends);
        if (live) setFiles({ key: `${ends.from}...${ends.to}`, files: f });
      } catch (e) {
        if (live) setError(errorText(e));
      }
    };
    if (from && to) void load({ from, to });
    return () => {
      live = false;
    };
  }, [ref, from, to]);
  return { files: key && files?.key === key ? files.files : null, error: key ? error : null };
}
