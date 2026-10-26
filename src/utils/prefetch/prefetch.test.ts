import { mockIPC } from "@tauri-apps/api/mocks";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { loadCommits } from "@/utils/commits/commits";
import type { Details, loadDetails } from "@/utils/details/details";
import type { loadManage } from "@/utils/manage/manage";
import type { loadFiles, loadThreads } from "@/utils/review/review";
import { shelved } from "@/utils/shelf/shelf";

// What GitHub would answer, one level up: prefetch only arranges the loads and keeps what comes.
const load = vi.hoisted(() => ({
  details: vi.fn<typeof loadDetails>(),
  files: vi.fn<typeof loadFiles>(),
  threads: vi.fn<typeof loadThreads>(),
  manage: vi.fn<typeof loadManage>(),
  commits: vi.fn<typeof loadCommits>(),
}));
vi.mock("@/utils/details/details", () => ({ loadDetails: load.details }));
vi.mock("@/utils/review/review", () => ({ loadFiles: load.files, loadThreads: load.threads }));
vi.mock("@/utils/manage/manage", () => ({ loadManage: load.manage }));
vi.mock("@/utils/commits/commits", () => ({ loadCommits: load.commits }));

const details: Details = {
  id: "PR_1",
  number: 7,
  title: "Fix the thing",
  url: "https://github.com/acme/app/pull/7",
  html: "",
  owner: "acme",
  repo: "app",
  isDraft: false,
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  viewerDidAuthor: false,
  viewerCanUpdate: false,
  baseRefName: "main",
  headRefName: "fix",
  headRefOid: "abc",
  updatedAt: "v2",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
  createdAt: "2026-01-01T00:00:00Z",
  author: { login: "ana" },
  reviewDecision: null,
  reviewers: [],
  checks: [],
  files: [],
  entries: [],
  mergeMethods: ["squash"],
};
const commits = { commits: [], forcePushes: [], reviewed: null };

/** The kept copies Rust was asked to write. */
function disk() {
  const written: string[] = [];
  mockIPC((cmd, args) => {
    if (cmd === "kept_write" && args && "id" in args) written.push(String(args.id));
    return null;
  });
  return written;
}

/** prefetch afresh, remembering nothing it fetched before. */
function fresh() {
  vi.resetModules();
  return import("@/utils/prefetch/prefetch");
}

beforeEach(() => {
  load.details.mockResolvedValue(details);
  load.files.mockResolvedValue([]);
  load.threads.mockResolvedValue([]);
  load.manage.mockRejectedValue(new Error("offline"));
  load.commits.mockResolvedValue(commits);
});

describe("fetching ahead", () => {
  it("keeps the review on disk, and what's around it on the shelf", async () => {
    const written = disk();
    const { prefetch } = await fresh();
    await prefetch("PR_1", "acme/app", 7);
    expect(load.details).toHaveBeenCalledWith("acme/app", 7);
    expect(load.files).toHaveBeenCalledWith({ owner: "acme", repo: "app", number: 7 });
    expect(written).toEqual(["PR_1-files", "PR_1"]);
    expect(shelved("commits:PR_1")).toMatchObject({ value: commits });
    expect(shelved("manage:PR_1")).toBeNull();
  });

  it("doesn't ask again within a minute and a half", async () => {
    disk();
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const { prefetch } = await fresh();
    await prefetch("PR_1", "acme/app", 7);
    await prefetch("PR_1", "acme/app", 7);
    expect(load.details).toHaveBeenCalledOnce();
    vi.spyOn(Date, "now").mockReturnValue(1_100_000);
    await prefetch("PR_1", "acme/app", 7);
    expect(load.details).toHaveBeenCalledTimes(2);
  });

  it("doesn't fetch a version already kept", async () => {
    disk();
    const { prefetch } = await fresh();
    await prefetch("PR_1", "acme/app", 7);
    const again = await fresh();
    await again.prefetch("PR_1", "acme/app", 7, "v2");
    expect(load.details).toHaveBeenCalledOnce();
    await again.prefetch("PR_1", "acme/app", 7, "v3");
    expect(load.details).toHaveBeenCalledTimes(2);
  });

  it("tries again soon after a failure", async () => {
    disk();
    load.details.mockRejectedValueOnce(new Error("offline"));
    const { prefetch } = await fresh();
    await prefetch("PR_1", "acme/app", 7);
    await prefetch("PR_1", "acme/app", 7);
    expect(load.details).toHaveBeenCalledTimes(2);
  });

  it("makes do with a name that isn't owner/repo", async () => {
    disk();
    const { prefetch } = await fresh();
    await prefetch("PR_1", "", 7);
    expect(load.files).toHaveBeenCalledWith({ owner: "", repo: "", number: 7 });
  });
});

const pr = (n: number) => ({ id: `PR_${n}`, repository: { nameWithOwner: "acme/app" }, number: n, updatedAt: "v" });

describe("fetching a list ahead", () => {
  it("fetches the first five, one after another", async () => {
    disk();
    const { prefetchSome } = await fresh();
    await prefetchSome([1, 2, 3, 4, 5, 6].map((n) => pr(n)));
    expect(load.details.mock.calls.map(([, n]) => n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("fetches as many as asked", async () => {
    disk();
    const { prefetchSome } = await fresh();
    await prefetchSome(
      [1, 2, 3].map((n) => pr(n)),
      2,
    );
    expect(load.details).toHaveBeenCalledTimes(2);
  });
});
