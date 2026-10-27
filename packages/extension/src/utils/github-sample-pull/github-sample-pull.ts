import type { Activity, PullRequest } from "@/utils/github-inbox/github-inbox";
import { DEFAULT_NOTIFY, EVENT_KINDS, type EventKind, type Exception, type NotifySettings } from "@/utils/inbox/inbox";
import { recordOf } from "@/utils/record/record";

/** A pull request on one of the reader's lists, for tests: octo/web's, by ada, unless `extra` says otherwise. */
export const samplePull = (number: number, extra: Partial<PullRequest> = {}): PullRequest => ({
  repo: "octo/web",
  number,
  title: `Pull request ${number}`,
  url: `https://github.com/octo/web/pull/${number}`,
  author: "ada",
  draft: false,
  comments: 0,
  createdAt: "2026-10-07T12:00:00Z",
  updatedAt: "2026-10-08T12:00:00Z",
  unread: false,
  headSha: "abc123",
  ...extra,
});

/** Activity on octo/web's pull request 12, for tests: a comment on the reader's own, unless `extra` says otherwise. */
export const sampleActivity = (thread: string, extra: Partial<Activity> = {}): Activity => ({
  thread,
  repo: "octo/web",
  number: 12,
  title: "Pull request 12",
  url: "https://github.com/octo/web/pull/12#issuecomment-1",
  reason: "author",
  kind: "comment",
  anchor: "issuecomment-1",
  updatedAt: "2026-10-09T10:00:00Z",
  ...extra,
});

/** For tests: notifications on for just these events, each with what it leaves out. */
export const sampleNotify = (
  events: Partial<Record<EventKind, Exception[]>>,
  repos: string[] = [],
): NotifySettings => ({
  ...DEFAULT_NOTIFY,
  enabled: true,
  repos,
  events: recordOf(EVENT_KINDS, (kind) => ({ on: kind in events, except: events[kind] ?? [], repos: [], when: "now" })),
});
