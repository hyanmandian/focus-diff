// A pull request's commits, and which of its changes the diff shows: all of them, one commit, a run
// of commits, or what changed since your last review (as GitHub's "Changes since your last review").
// A range is two commits; its files come from GitHub's compare in the same shape as the pull
// request's own (ReviewFile), so the diff shows either the same way.

import { useEffect, useState } from "react";

import { github, graphql } from "@/utils/bridge/bridge";
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
  /** Signed and GitHub checked the signature; null when unsigned. */
  verified: boolean | null;
  ci: Ci;
  /** The commit before it (the base's, for the first): where a diff of this commit starts. */
  parent: string | null;
};
export type ForcePush = { at: string; actor: string | null; before: string | null; after: string | null };
export type Commits = {
  commits: Commit[];
  forcePushes: ForcePush[];
  /** The commit your latest review was on, if you've reviewed it. */
  reviewed: string | null;
};

/** Which changes the diff shows: those after `from` up to and including `to`. Null: all of them. */
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
  // GitHub lists at most 250 commits of a pull request.
  for (let page = 0; page < 3; page++) {
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

/** The pull request's commits as a hook: the copy kept from last time at once, GitHub's after;
 *  asked again when the head moves. */
export function useCommits(prId: string, ref: PullRef, head: string | undefined) {
  const [list, setList] = useState<Commits | null>(() => shelved<Commits>(`commits:${prId}`)?.value ?? null);
  useEffect(() => {
    if (!head) return;
    let live = true;
    void loadCommits(ref)
      .then((c) => {
        if (!live) return;
        setList(c);
        shelve(`commits:${prId}`, c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [prId, ref, head]);
  return list;
}

// MARK: Ranges

/** The commits from index `a` to `b` (either order, both included). */
export function commitRange(commits: Commit[], a: number, b: number): Range {
  const first = commits[Math.min(a, b)];
  const last = commits[Math.max(a, b)];
  if (!first || !last) return null;
  // All of them is no range at all; a first commit without a parent (a new history) can't start one.
  if (Math.min(a, b) === 0 && Math.max(a, b) === commits.length - 1) return null;
  if (!first.parent) return null;
  return { from: first.parent, to: last.oid };
}

/** What changed since your last review: from the commit it was on to the head. `count`: the commits
 *  since; `rewritten`: that commit isn't in the pull request any more (a force push), so the
 *  comparison is between the two versions; null when you haven't reviewed or nothing's new. */
export function sinceReview(list: Commits): { range: NonNullable<Range>; count: number; rewritten: boolean } | null {
  const head = list.commits.at(-1);
  if (!list.reviewed || !head || list.reviewed === head.oid) return null;
  const at = list.commits.findIndex((c) => c.oid === list.reviewed);
  if (at === -1) return { range: { from: list.reviewed, to: head.oid }, count: 0, rewritten: true };
  return { range: { from: list.reviewed, to: head.oid }, count: list.commits.length - 1 - at, rewritten: false };
}

/** The indexes of the commits a range shows (all of them for no range); empty when a commit of it
 *  isn't in the list (a version from before a force push). */
export function inRange(commits: Commit[], range: Range): number[] {
  if (!range) return commits.map((_, i) => i);
  const end = commits.findIndex((c) => c.oid === range.to);
  if (end === -1) return [];
  const start = commits.findIndex((c) => c.oid === range.from);
  // `from` is the commit before the first shown: the base's for the first commit.
  const first = start !== -1 ? start + 1 : commits.findIndex((c) => c.parent === range.from);
  if (first === -1 || first > end) return [];
  return Array.from({ length: end - first + 1 }, (_, i) => first + i);
}

/** Whether the range is the same as one commit or "since your last review", for labels. */
export const sameRange = (a: Range, b: Range) => a?.from === b?.from && a?.to === b?.to;

// Two commits never change, so neither does what's between them: each comparison is asked once.
const compared = new Map<string, Promise<ReviewFile[]>>();

/** The files a range changes, in the pull request's own shape. */
export function loadRangeFiles(ref: PullRef, range: NonNullable<Range>): Promise<ReviewFile[]> {
  const key = `${ref.owner}/${ref.repo}:${range.from}...${range.to}`;
  const known = compared.get(key);
  if (known) return known;
  type Raw = {
    files?: Array<{
      filename: string;
      previous_filename?: string;
      status: ReviewFile["status"];
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  };
  // Every changed file comes with the first page (up to 300); one commit a page keeps it small.
  const files = github<Raw>(
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

/** The files a range changes, as a hook: null while they load (and for no range). */
export function useRangeFiles(ref: PullRef, range: Range) {
  const [files, setFiles] = useState<{ key: string; files: ReviewFile[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The range's two commits are what matter, not the object.
  const from = range?.from;
  const to = range?.to;
  const key = from && to ? `${from}...${to}` : "";
  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    setError(null);
    void loadRangeFiles(ref, { from, to })
      .then((f) => live && setFiles({ key: `${from}...${to}`, files: f }))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [ref, from, to]);
  return { files: key && files?.key === key ? files.files : null, error: key ? error : null };
}
