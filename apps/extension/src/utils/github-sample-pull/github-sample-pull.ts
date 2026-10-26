import type { PullRequest } from "@/utils/github-inbox/github-inbox";

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
