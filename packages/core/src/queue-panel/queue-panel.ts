/**
 * The queues' data as the panel gets it, and the snapshot it follows. The types mirror the desktop app's, field for
 * field, so its screens can read what this engine makes: `Actor`, `Comment`, `PullRequest`, `CiState`, `Event` and
 * `Item` are those of packages/desktop/src/utils/engine/engine.ts; `Status`, `RunPull`, `ReviewRun` and `Snapshot`
 * (its `Live`) those of packages/desktop/src/utils/store/store.ts. Keep them in step until the screens import them
 * from here.
 *
 * {@link panelItem} is Rust's serialization of an item (`impl Serialize for Item` and `PanelPr` in engine.rs).
 */

import type { Actor as GithubActor, PullRequest as FullPullRequest, Reviewer } from "../github-pulls/github-pulls";
import type { EventKind } from "../queue-config/queue-config";

export type Actor = { __typename?: string; login: string; avatarUrl?: string; name?: string | null } | null;
export type Comment = { author: Actor; createdAt: string; body?: string; url: string };

/** What the panel gets of a pull request. */
export type PullRequest = {
  id: string;
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  headRefOid: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  repository: { nameWithOwner: string };
  author: Actor;
  mergedBy: Actor;
  labels: { nodes: Array<{ name: string }> };
  reviewRequests: {
    nodes: Array<{
      requestedReviewer:
        | null
        | { __typename: "User"; login: string; avatarUrl?: string }
        | { __typename: "Team"; slug: string; organization: { login: string } }
        | { __typename: string };
    }>;
  };
  latestOpinionatedReviews: { nodes: Array<{ author: Actor; state: string; submittedAt: string; url: string }> };
  /** Comments and review conversations. */
  comments: number;
};

export type CiState = "SUCCESS" | "FAILURE" | "ERROR" | "PENDING" | "EXPECTED";

/** `text`: the start of what a comment or review said, for its notification. */
export type Event = { key: string; kind: EventKind; at: number; who: Actor; text?: string };

export type Item = {
  queueId: string;
  pr: PullRequest;
  events: Event[];
  /** How you left it (involved queues). */
  status?: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "MENTIONED";
  /** review queues: requested through these teams rather than you. */
  viaTeams?: string[];
  ci: CiState | null;
  /** CI went green again on the same commit since last time: worth a notification only. */
  passed?: boolean;
  /** review queues: since when it's been waiting on you (ms). */
  waitingSince?: number;
};

export type Status = { phase: "idle" | "loading" | "error"; error?: string; updatedAt: number };

/** A pull request picked for review time (`RunPull` in review.rs). */
export type RunPull = {
  id: string;
  title: string;
  repo: string;
  number: number;
  url: string;
  minutes: number;
  again: boolean;
};

/** The review time under way (`Run` in review.rs), and when its time is up (ms). */
export type ReviewRun = {
  run: {
    session: string;
    name: string;
    minutes: number;
    startedAt: number;
    pulls: RunPull[];
    left: number;
    overBy: number;
  };
  endsAt: number;
};

/** What the panel follows: `State::snapshot` in watch.rs (`Live` in the desktop's store). */
export type Snapshot = {
  ready: boolean;
  signedIn: boolean;
  me: string | null;
  items: Record<string, Item[]>;
  status: Status;
  arrivals: string[];
  seen: Record<string, true>;
  dismissed: Record<string, true>;
  review: ReviewRun | null;
};

// MARK: The engine's side

/** An event as the engine keeps it (`Event` in engine.rs). */
export interface EngineEvent {
  key: string;
  kind: EventKind;
  at: number;
  who: GithubActor | null;
  text: string | null;
}

/** An item as the engine keeps it, the pull request in full (`Item` in engine.rs). */
export interface EngineItem {
  queueId: string;
  pr: FullPullRequest;
  events: EngineEvent[];
  status: NonNullable<Item["status"]> | null;
  viaTeams: string[] | null;
  ci: string | null;
  passed: boolean;
  waitingSince: number | null;
}

const actor = (a: GithubActor | null): Actor => a && { ...a };

const reviewer = (r: Reviewer | null): PullRequest["reviewRequests"]["nodes"][number]["requestedReviewer"] =>
  r && {
    __typename: r.__typename,
    ...(r.login === undefined ? {} : { login: r.login }),
    ...(r.avatarUrl === undefined ? {} : { avatarUrl: r.avatarUrl }),
    ...(r.slug === undefined ? {} : { slug: r.slug }),
    ...(r.organization ? { organization: { login: r.organization.login } } : {}),
    ...(r.members ? { members: { nodes: r.members.nodes.map((m) => ({ login: m.login })) } } : {}),
  };

export const panelEvent = (e: EngineEvent): Event => ({
  key: e.key,
  kind: e.kind,
  at: e.at,
  who: actor(e.who),
  ...(e.text === null ? {} : { text: e.text }),
});

/** What the panel gets of a pull request: the rest only feeds the rules. */
export const panelPullRequest = (pr: FullPullRequest): PullRequest => ({
  id: pr.id,
  number: pr.number,
  title: pr.title,
  url: pr.url,
  isDraft: pr.isDraft,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- GitHub's states are these three; passed on as they come, as Rust does.
  state: pr.state as PullRequest["state"],
  createdAt: pr.createdAt,
  updatedAt: pr.updatedAt,
  mergedAt: pr.mergedAt,
  headRefOid: pr.headRefOid,
  additions: pr.additions,
  deletions: pr.deletions,
  changedFiles: pr.changedFiles,
  repository: { nameWithOwner: pr.repository.nameWithOwner },
  author: actor(pr.author),
  mergedBy: actor(pr.mergedBy),
  labels: { nodes: pr.labels.nodes.map((l) => ({ name: l.name })) },
  reviewRequests: {
    nodes: pr.reviewRequests.nodes.map((n) => ({
      requestedReviewer: reviewer(n.requestedReviewer),
      ...(n.createdAt === undefined ? {} : { createdAt: n.createdAt }),
    })),
  },
  latestOpinionatedReviews: {
    nodes: pr.latestOpinionatedReviews.nodes.map((r) => ({
      author: actor(r.author),
      state: r.state,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- null when GitHub has no date for it, as Rust sends it, though the desktop's type says a string.
      submittedAt: r.submittedAt as string,
      url: r.url,
    })),
  },
  comments: pr.commentCount.totalCount + pr.threadCount.totalCount,
});

/** An item as the panel gets it: empty and false fields left out, as Rust leaves them. */
export const panelItem = (item: EngineItem): Item => ({
  queueId: item.queueId,
  pr: panelPullRequest(item.pr),
  events: item.events.map(panelEvent),
  ...(item.status === null ? {} : { status: item.status }),
  ...(item.viaTeams === null ? {} : { viaTeams: [...item.viaTeams] }),
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- GitHub's CI states are these; passed on as they come, as Rust does.
  ci: item.ci as CiState | null,
  ...(item.passed ? { passed: true } : {}),
  ...(item.waitingSince === null ? {} : { waitingSince: item.waitingSince }),
});
