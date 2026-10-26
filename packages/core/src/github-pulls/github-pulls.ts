/**
 * Pull requests as the queue engine reads them from GitHub's GraphQL API, and GitHub's timestamps. The shapes and
 * reading rules are those of the desktop app's `src-tauri/src/engine.rs` (its "GitHub data"): missing fields take a
 * default, a connection's nulls and unreadable nodes are dropped, and a pull request with a field of the wrong type
 * is left out.
 */

import {
  attempt,
  fields,
  flag,
  integer,
  maybe,
  maybeText,
  Mismatch,
  nested,
  requiredText,
  text,
  U32,
  type Fields,
} from "../json-decode/json-decode";

/** A GraphQL connection's nodes. */
export interface Nodes<T> {
  nodes: T[];
}

/** Someone, or something (a bot), that did something. Absent fields are left out, as the panel gets them. */
export interface Actor {
  __typename?: string;
  login: string;
  avatarUrl?: string;
  name?: string;
}

export interface Comment {
  author: Actor | null;
  createdAt: string | null;
  body: string | null;
  url: string;
}

export interface Review {
  author: Actor | null;
  state: string;
  submittedAt: string | null;
  url: string;
  /** What the review said, if anything (not sent to the panel). */
  body: string | null;
}

export interface MyReview {
  state: string;
  submittedAt: string | null;
  commit: { oid: string } | null;
}

export interface CommitNode {
  commit: { committedDate: string | null; statusCheckRollup: { state: string } | null };
}

export interface Login {
  login: string;
}

/** A user or a team asked to review (or something else GitHub may add, kept as its type name). */
export interface Reviewer {
  __typename: string;
  login?: string;
  avatarUrl?: string;
  slug?: string;
  organization?: Login;
  members?: Nodes<Login>;
}

export interface ReviewRequest {
  requestedReviewer: Reviewer | null;
  /** On review request events: when it was asked. */
  createdAt?: string;
}

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: string;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefOid: string;
  mergeable: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
  author: Actor | null;
  mergedBy: Actor | null;
  labels: Nodes<{ name: string }>;
  reviewRequests: Nodes<ReviewRequest>;
  latestOpinionatedReviews: Nodes<Review>;
  mine: Nodes<MyReview>;
  reviewComments: Nodes<Comment>;
  comments: Nodes<Comment>;
  reviewThreads: Nodes<{ comments: Nodes<Comment> }>;
  commits: Nodes<CommitNode>;
  participants: Nodes<Login>;
  removed: Nodes<{ actor: Login | null }>;
  ready: Nodes<{ createdAt: string | null }>;
  commentCount: { totalCount: number };
  threadCount: { totalCount: number };
  /** Asked for path filters and merged queues only. */
  files?: Nodes<{ path: string }>;
  /** Review and merged queues: everyone ever asked to review and when, and whether you're in the teams asked. */
  requested?: Nodes<ReviewRequest>;
}

// MARK: Reading

/** A connection: nulls and nodes that don't read are dropped; no connection at all is an empty one. */
export const readNodes = <T>(value: unknown, read: (node: unknown) => T): Nodes<T> => {
  if (value === null || value === undefined) return { nodes: [] };
  const raw = fields(value).nodes;
  if (raw === undefined) return { nodes: [] };
  if (!Array.isArray(raw)) throw new Mismatch("a list of nodes");
  const nodes: T[] = [];
  for (const node of raw as unknown[]) {
    const item = node === null ? null : attempt(() => read(node));
    if (item !== null) nodes.push(item);
  }
  return { nodes };
};

const connection = <T>(o: Fields, key: string, read: (node: unknown) => T): Nodes<T> => readNodes(o[key], read);

/** A field serde leaves out when it's None (`skip_serializing_if`). */
const optional = (key: string, value: string | null): Record<string, string> =>
  value === null ? {} : { [key]: value };

export const readActor = (value: unknown): Actor => {
  const o = fields(value);
  return {
    ...optional("__typename", maybeText(o, "__typename")),
    login: text(o, "login"),
    ...optional("avatarUrl", maybeText(o, "avatarUrl")),
    ...optional("name", maybeText(o, "name")),
  };
};

const readComment = (value: unknown): Comment => {
  const o = fields(value);
  return {
    author: maybe(o, "author", readActor),
    createdAt: maybeText(o, "createdAt"),
    body: maybeText(o, "body"),
    url: text(o, "url"),
  };
};

const readReview = (value: unknown): Review => {
  const o = fields(value);
  return {
    author: maybe(o, "author", readActor),
    state: text(o, "state"),
    submittedAt: maybeText(o, "submittedAt"),
    url: text(o, "url"),
    body: maybeText(o, "body"),
  };
};

const readMyReview = (value: unknown): MyReview => {
  const o = fields(value);
  return {
    state: text(o, "state"),
    submittedAt: maybeText(o, "submittedAt"),
    commit: maybe(o, "commit", (c) => ({ oid: requiredText(fields(c), "oid") })),
  };
};

const readLogin = (value: unknown): Login => ({ login: text(fields(value), "login") });

export const readCommitNode = (value: unknown): CommitNode => {
  const o = fields(value);
  const commit = nested(o, "commit", fields, () => ({}));
  return {
    commit: {
      committedDate: maybeText(commit, "committedDate"),
      statusCheckRollup: maybe(commit, "statusCheckRollup", (s) => ({ state: requiredText(fields(s), "state") })),
    },
  };
};

const readReviewer = (value: unknown): Reviewer => {
  const o = fields(value);
  const organization = maybe(o, "organization", readLogin);
  const members = maybe(o, "members", (m) => readNodes(m, readLogin));
  return {
    __typename: text(o, "__typename"),
    ...optional("login", maybeText(o, "login")),
    ...optional("avatarUrl", maybeText(o, "avatarUrl")),
    ...optional("slug", maybeText(o, "slug")),
    ...(organization ? { organization } : {}),
    ...(members ? { members } : {}),
  };
};

const readReviewRequest = (value: unknown): ReviewRequest => {
  const o = fields(value);
  return {
    requestedReviewer: maybe(o, "requestedReviewer", readReviewer),
    ...optional("createdAt", maybeText(o, "createdAt")),
  };
};

const count = (o: Fields, key: string): { totalCount: number } => ({
  totalCount: integer(
    nested(o, key, fields, () => ({})),
    "totalCount",
    { min: 0, max: U32 },
  ),
});

const readPullRequest = (value: unknown): PullRequest => {
  const o = fields(value);
  const files = maybe(o, "files", (f) => readNodes(f, (n) => ({ path: text(fields(n), "path") })));
  const requested = maybe(o, "requested", (r) => readNodes(r, readReviewRequest));
  return {
    id: text(o, "id"),
    number: integer(o, "number", { min: 0 }),
    title: text(o, "title"),
    url: text(o, "url"),
    isDraft: flag(o, "isDraft"),
    state: text(o, "state"),
    createdAt: text(o, "createdAt"),
    updatedAt: text(o, "updatedAt"),
    mergedAt: maybeText(o, "mergedAt"),
    headRefOid: text(o, "headRefOid"),
    mergeable: text(o, "mergeable"),
    additions: integer(o, "additions"),
    deletions: integer(o, "deletions"),
    changedFiles: integer(o, "changedFiles"),
    repository: {
      nameWithOwner: text(
        nested(o, "repository", fields, () => ({})),
        "nameWithOwner",
      ),
    },
    author: maybe(o, "author", readActor),
    mergedBy: maybe(o, "mergedBy", readActor),
    labels: connection(o, "labels", (n) => ({ name: text(fields(n), "name") })),
    reviewRequests: connection(o, "reviewRequests", readReviewRequest),
    latestOpinionatedReviews: connection(o, "latestOpinionatedReviews", readReview),
    mine: connection(o, "mine", readMyReview),
    reviewComments: connection(o, "reviewComments", readComment),
    comments: connection(o, "comments", readComment),
    reviewThreads: connection(o, "reviewThreads", (n) => {
      const thread = fields(n);
      return { comments: connection(thread, "comments", readComment) };
    }),
    commits: connection(o, "commits", readCommitNode),
    participants: connection(o, "participants", readLogin),
    removed: connection(o, "removed", (n) => ({ actor: maybe(fields(n), "actor", readLogin) })),
    ready: connection(o, "ready", (n) => ({ createdAt: maybeText(fields(n), "createdAt") })),
    commentCount: count(o, "commentCount"),
    threadCount: count(o, "threadCount"),
    ...(files ? { files } : {}),
    ...(requested ? { requested } : {}),
  };
};

/** A pull request from GitHub's reply, or null when it doesn't read as one. */
export const parsePullRequest = (value: unknown): PullRequest | null => attempt(() => readPullRequest(value));

// MARK: Dates

const DAY = 86_400_000;

export const daysFromCivil = (year: number, month: number, day: number): number => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.trunc((153 * ((month + 9) % 12) + 2) / 5) + day - 1;
  return era * 146_097 + yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy - 719_468;
};

/** The date (year, month, day) of a day counted from the epoch. */
export const civilFromDays = (days: number): [number, number, number] => {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.trunc((doe - Math.trunc(doe / 1460) + Math.trunc(doe / 36_524) - Math.trunc(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.trunc(yoe / 4) - Math.trunc(yoe / 100));
  const mp = Math.trunc((5 * doy + 2) / 153);
  const d = doy - Math.trunc((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? yoe + era * 400 + 1 : yoe + era * 400, m, d];
};

/** The date of a moment (ms), as GitHub's searches write it: "2026-01-01". */
export const isoDate = (ms: number): string => {
  const [y, m, d] = civilFromDays(Math.floor(ms / DAY));
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

const part = (s: string, from: number, to: number): number | null => {
  const piece = s.slice(from, to);
  return /^[+-]?\d+$/u.test(piece) ? Number(piece) : null;
};

/** Milliseconds since the epoch of one of GitHub's timestamps ("2026-01-01T12:00:00Z"); 0 if none. */
export const time = (iso: string | null | undefined): number => {
  if (iso === null || iso === undefined || iso.length < 19) return 0;
  const [y, mo, d, h, mi, se] = [
    part(iso, 0, 4),
    part(iso, 5, 7),
    part(iso, 8, 10),
    part(iso, 11, 13),
    part(iso, 14, 16),
    part(iso, 17, 19),
  ];
  if (y === null || mo === null || d === null || h === null || mi === null || se === null) return 0;
  return (daysFromCivil(y, mo, d) * 86_400 + h * 3600 + mi * 60 + se) * 1000;
};
