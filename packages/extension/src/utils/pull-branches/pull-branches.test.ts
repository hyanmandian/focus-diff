import { describe, expect, it, vi } from "vitest";

import { fetchBranches, InboxError } from "@/utils/github-inbox/github-inbox";
import { samplePull } from "@/utils/github-sample-pull/github-sample-pull";
import { pullBranchesItem } from "@/utils/storage/storage";

import { mayStack, readBranches, stackPosition, stackPulls, type BranchesRecord } from "./pull-branches";

vi.mock(import("@/utils/github-inbox/github-inbox"), async (original) => ({
  ...(await original()),
  fetchBranches: vi.fn<typeof fetchBranches>(),
}));

const pull = samplePull;
const known = (head: string, base: string, extra: Partial<BranchesRecord> = {}): BranchesRecord => ({
  sha: "abc123",
  head,
  base,
  fork: false,
  ...extra,
});

describe("mayStack", () => {
  it("takes only the pull requests with another from their repository on the same list, once each", () => {
    const web = [pull(1), pull(2)];
    const api = pull(3, { repo: "octo/api", url: "https://github.com/octo/api/pull/3" });
    const alone = pull(4, { repo: "octo/docs", url: "https://github.com/octo/docs/pull/4" });
    expect(mayStack([[...web, api], [alone, pull(1)], [api]]).map((each) => each.number)).toEqual([1, 2]);
  });
});

describe("readBranches", () => {
  it("reads each pull request's branches once per commit, and keeps only the ones still listed", async () => {
    vi.mocked(fetchBranches).mockImplementation((_, number) =>
      Promise.resolve({ head: `b${number}`, base: "main", fork: false }),
    );
    await pullBranchesItem.setValue({
      [pull(1).url]: known("b1", "main"),
      [pull(2).url]: known("old", "main", { sha: "before" }),
      gone: known("x", "main"),
    });
    await readBranches([[pull(1), pull(2)], [pull(5)]]);
    expect(vi.mocked(fetchBranches).mock.calls).toEqual([["octo/web", 2]]);
    expect(await pullBranchesItem.getValue()).toEqual({
      [pull(1).url]: known("b1", "main"),
      [pull(2).url]: known("b2", "main"),
    });
  });

  it("asks again for a card it couldn't reach, and not for one that didn't read as expected", async () => {
    vi.mocked(fetchBranches).mockImplementation((_, number) =>
      number === 1 ? Promise.reject(new InboxError("offline")) : Promise.resolve(null),
    );
    await readBranches([[pull(1), pull(2)]]);
    expect(await pullBranchesItem.getValue()).toEqual({ [pull(2).url]: known("", "") });
  });

  it("reads thirty cards a look at most, and writes nothing when nothing changed", async () => {
    vi.mocked(fetchBranches).mockResolvedValue({ head: "b", base: "main", fork: false });
    const many = Array.from({ length: 35 }, (_, index) => pull(index + 1));
    await readBranches([many]);
    expect(fetchBranches).toHaveBeenCalledTimes(30);
    const set = vi.spyOn(pullBranchesItem, "setValue");
    vi.mocked(fetchBranches).mockRejectedValue(new InboxError("offline"));
    await readBranches([many]);
    expect(set).not.toHaveBeenCalled();
  });

  it("goes on after a read that failed", async () => {
    vi.spyOn(pullBranchesItem, "getValue").mockRejectedValueOnce(new Error("gone"));
    await expect(readBranches([[]])).rejects.toThrow("gone");
    vi.mocked(fetchBranches).mockResolvedValue(null);
    await readBranches([[pull(1), pull(2)]]);
    expect(Object.keys(await pullBranchesItem.getValue())).toHaveLength(2);
  });
});

describe("stackPulls", () => {
  it("puts a stack together from the branches read, bottom first, and leaves the rest be", () => {
    const [top, lone, bottom] = [pull(3), pull(9), pull(1)];
    const stacked = stackPulls([top, lone, bottom], {
      [top.url]: known("b3", "b1"),
      [bottom.url]: known("b1", "main"),
    });
    expect(stacked.map(({ pull: each, place }) => [each.number, place?.index, place?.size])).toEqual([
      [1, 0, 2],
      [3, 1, 2],
      [9, undefined, undefined],
    ]);
  });

  it("leaves a pull request from a fork out of stacks", () => {
    const [top, bottom] = [pull(2), pull(1)];
    const stacked = stackPulls([top, bottom], {
      [top.url]: known("b2", "b1", { fork: true }),
      [bottom.url]: known("b1", "main"),
    });
    expect(stacked.map(({ place }) => place)).toEqual([null, null]);
  });
});

describe("stackPosition", () => {
  it("says where GitHub puts a pull request in its stack, or else where the branches do", () => {
    const place = { stack: "s", index: 1, size: 2 };
    expect(stackPosition({ pull: pull(1, { stack: { position: 3, size: 4 } }), place })).toEqual({
      position: 3,
      size: 4,
    });
    expect(stackPosition({ pull: pull(1), place })).toEqual({ position: 2, size: 2 });
    expect(stackPosition({ pull: pull(1), place: null })).toBeNull();
  });
});
