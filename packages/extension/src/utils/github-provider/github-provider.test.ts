// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { github } from "./github-provider";

const load = (name: string, address: string) => {
  const page = new DOMParser().parseFromString(readFileSync(path.resolve("tests/fixtures", name), "utf8"), "text/html");
  const script = page.querySelector("body > script")!;
  script.remove();
  history.replaceState(null, "", address);
  document.head.innerHTML = page.head.innerHTML;
  document.body.innerHTML = page.body.innerHTML;
  // oxlint-disable-next-line typescript/no-implied-eval -- runs the saved page's own script, which draws it.
  Reflect.apply(new Function(script.textContent), undefined, []);
};

const fileOf = (diff: ReturnType<typeof github.diffs>[number]) => ({
  path: diff.path,
  anchor: diff.anchor,
  stats: diff.stats(),
  viewed: false,
  diff: { element: diff.element, container: diff.container },
  threads: [],
});

describe("github", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("reads the classic view from the page itself", () => {
    load("pull-request.html", "/octo/web/pull/1/changes");
    expect(github.repository()).toBe("octo/web");
    expect(github.isVirtualized()).toBe(false);
    expect(github.summary()).toBeNull();
    const diffs = github.diffs();
    expect(diffs.map((diff) => [diff.path, diff.stats(), diff.viewed()])).toEqual([
      ["web/src/book-card.tsx", { additions: 40, deletions: 10 }, false],
      ["web/src/book-card.test.tsx", { additions: 30, deletions: 5 }, false],
      ["web/src/book-card.stories.tsx", { additions: 10, deletions: 0 }, false],
      ["api/books/service.py", { additions: 25, deletions: 10 }, false],
      ["api/tests/test_service.py", { additions: 10, deletions: 5 }, false],
      ["docs/books.md", { additions: 5, deletions: 0 }, false],
      ["api/books/__init__.py", { additions: 0, deletions: 0 }, false],
      ["api/legacy/routes.py", null, null],
    ]);
    expect(github.reportedFileCount()).toBe(8);
    expect(github.counters().additions?.textContent).toBe("+120");
    expect(github.counters().deletions?.textContent).toBe("−30");
    expect(github.tree.files().map((file) => github.tree.pathOf(file.element))).toEqual([
      "web/src/book-card.tsx",
      "web/src/book-card.test.tsx",
      "web/src/book-card.stories.tsx",
      "api/books/__init__.py",
      "api/books/service.py",
      "api/legacy/routes.py",
      "api/tests/test_service.py",
      "docs/books.md",
    ]);
    expect(github.tree.folders().map((folder) => folder.path)).toContain("api/books");
    expect(github.diffAt("0")).toBe(diffs[0]?.element);
    expect(github.hashOf("0")).toBe("#diff-0");
    expect(
      github
        .conversations(
          diffs.map((diff) => fileOf(diff)),
          false,
        )
        .map(({ file, line, state }) => [file.path, line, state]),
    ).toEqual([
      ["web/src/book-card.tsx", 12, "waiting"],
      ["api/books/service.py", 3, "resolved"],
      ["api/books/service.py", 40, "answered"],
      ["docs/books.md", 7, "answered"],
    ]);
  });

  it("reads the newer view from the data GitHub embeds", () => {
    load("pull-request-virtualized.html", "/octo/web/pull/2/changes");
    expect(github.isVirtualized()).toBe(true);
    const summary = github.summary();
    expect(summary?.map((file) => [file.path, file.additions, file.deletions, file.viewed])).toEqual([
      ["web/src/book-card.tsx", 40, 10, false],
      ["web/src/book-card.test.tsx", 30, 5, false],
      ["web/src/book-card.stories.tsx", 10, 0, false],
      ["api/books/service.py", 25, 10, false],
      ["api/tests/test_service.py", 10, 5, false],
      ["docs/books.md", 5, 0, true],
      ["api/books/__init__.py", 0, 0, false],
      ["api/legacy/routes.py", 0, 0, false],
    ]);
    expect(summary?.[3]?.threads.map(({ line, state, comment }) => [line, state, comment])).toEqual([
      ["R3", "resolved", "1020"],
      ["R40", "answered", "1030"],
    ]);
    expect(github.diffs()[0]?.viewed()).toBe(false);
    expect(github.tree.files()[0]?.anchor).toBe(summary?.[0]?.anchor);
  });

  it("writes numbers the way GitHub's counters do, whatever the reader's language", () => {
    expect(github.formatCount(12_345)).toBe("12,345");
  });
});
