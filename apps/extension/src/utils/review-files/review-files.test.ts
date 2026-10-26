// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import type { Diff, FileSummary, Provider } from "@/utils/provider/provider";

import { collectFiles } from "./review-files";

const drawn = (path: string, viewed: boolean | null): Diff => {
  const element = document.createElement("div");
  const container = document.createElement("section");
  return {
    element,
    container,
    path,
    anchor: `diff-${path}`,
    stats: () => ({ additions: path.length, deletions: 0 }),
    viewed: () => viewed,
  };
};

const summarized = (path: string, viewed: boolean): FileSummary => ({
  path,
  anchor: `diff-${path}`,
  additions: 3,
  deletions: 2,
  viewed,
  threads: [{ id: "1", line: "R1", state: "waiting", comment: "c1" }],
});

const siteWith = (diffs: Diff[], summary: FileSummary[] | null) =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- collecting files only reads the diffs and the summary.
  ({ diffs: () => diffs, summary: () => summary }) as unknown as Provider;

describe("collectFiles", () => {
  beforeEach(() => {
    history.replaceState(null, "", `/octo/web/pull/${Math.random().toString(36).slice(2)}/changes`);
  });

  it("lists every file from the site's data, with the drawn ones' diffs, and calls the list complete", () => {
    const diff = drawn("a.ts", null);
    const files = collectFiles(siteWith([diff], [summarized("a.ts", true), summarized("b.ts", false)]));
    expect(files.complete).toBe(true);
    expect(files.list).toEqual([
      {
        path: "a.ts",
        anchor: "diff-a.ts",
        stats: { additions: 3, deletions: 2 },
        viewed: true,
        diff: { element: diff.element, container: diff.container },
        threads: [{ id: "1", line: "R1", state: "waiting", comment: "c1" }],
      },
      expect.objectContaining({ path: "b.ts", viewed: false, diff: null }),
    ]);
  });

  it("lets a Viewed toggle seen on the page win over the data, until the reader moves to another page", () => {
    collectFiles(siteWith([drawn("a.ts", false)], null));
    expect(collectFiles(siteWith([], [summarized("a.ts", true)])).list[0]?.viewed).toBe(false);
    history.replaceState(null, "", "/octo/web/pull/other/changes");
    expect(collectFiles(siteWith([], [summarized("a.ts", true)])).list[0]?.viewed).toBe(true);
  });

  it("without the site's data, lists only what's drawn, with its line counts read from the page", () => {
    const diff = drawn("abc.ts", null);
    const files = collectFiles(siteWith([diff, drawn("d.md", true)], null));
    expect(files.complete).toBe(false);
    expect(files.list).toEqual([
      {
        path: "abc.ts",
        anchor: "diff-abc.ts",
        stats: { additions: 6, deletions: 0 },
        viewed: false,
        diff: { element: diff.element, container: diff.container },
        threads: [],
      },
      expect.objectContaining({ path: "d.md", viewed: true }),
    ]);
  });
});
