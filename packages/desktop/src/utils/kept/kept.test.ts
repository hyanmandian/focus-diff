import type { InvokeArgs } from "@tauri-apps/api/core";
import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it, vi } from "vite-plus/test";

import type { Details } from "@/utils/details/details";
import { keep, keptCurrent, readKept, type Kept } from "@/utils/kept/kept";
import type { ReviewFile, Thread } from "@/utils/review/review";

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
  updatedAt: "2026-01-01T00:00:00Z",
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
const file = (path: string, patch = "@@ -0,0 +1 @@\n+a"): ReviewFile => ({
  path,
  previousPath: null,
  status: "added",
  additions: 1,
  deletions: 0,
  patch,
});
const thread: Thread = {
  id: "T_1",
  path: "a.ts",
  side: "additions",
  line: 1,
  resolved: false,
  outdated: false,
  comments: [],
};
const kept = (files = [file("a.ts")]): Kept => ({ details, files, threads: [thread] });

/** One of the arguments a command was sent with. */
function sent(args: InvokeArgs | undefined, key: string): unknown {
  if (args === undefined || Array.isArray(args) || args instanceof ArrayBuffer || args instanceof Uint8Array)
    return undefined;
  return args[key];
}

/** Rust's kept files, in memory: what's written, and each write. */
function disk(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  mockIPC((cmd, args) => {
    const id = String(sent(args, "id"));
    if (cmd === "kept_read") return files.get(id) ?? null;
    writes.push(id);
    files.set(id, String(sent(args, "contents")));
    return null;
  });
  return { files, writes };
}

describe("keeping a review", () => {
  it("keeps nothing under an id GitHub wouldn't give", async () => {
    const written: string[] = [];
    mockIPC((cmd) => {
      if (cmd === "kept_write") written.push(cmd);
      return null;
    });
    await keep("__proto__", kept());
    await keep("../outside", kept());
    expect(written).toEqual([]);
    expect(localStorage.length).toBe(0);
  });

  it("writes the files apart from the rest and reads them back together", async () => {
    const { files } = disk();
    await keep("PR_1", kept());
    expect([...files.keys()]).toEqual(["PR_1-files", "PR_1"]);
    expect(await readKept("PR_1")).toEqual(kept());
  });

  it("writes only the part that changed", async () => {
    const { writes } = disk();
    await keep("PR_1", kept());
    await keep("PR_1", kept());
    expect(writes).toEqual(["PR_1-files", "PR_1"]);
    await keep("PR_1", kept([file("a.ts", "@@ -0,0 +1 @@\n+b")]));
    expect(writes).toEqual(["PR_1-files", "PR_1", "PR_1-files"]);
    await keep("PR_1", { ...kept([file("a.ts", "@@ -0,0 +1 @@\n+b")]), threads: [] });
    expect(writes.at(-1)).toBe("PR_1");
  });

  it("writes everything again after a week, in case the copy was swept away", async () => {
    const { writes } = disk();
    vi.spyOn(Date, "now").mockReturnValue(0);
    await keep("PR_1", kept());
    vi.spyOn(Date, "now").mockReturnValue(8 * 24 * 3600_000);
    await keep("PR_1", kept());
    expect(writes).toEqual(["PR_1-files", "PR_1", "PR_1-files", "PR_1"]);
  });

  it("notes which version it keeps", async () => {
    disk();
    await keep("PR_1", kept(), "v1");
    expect(keptCurrent("PR_1", "v1")).toBe(true);
    expect(keptCurrent("PR_1", "v2")).toBe(false);
    expect(keptCurrent("PR_2", "v1")).toBe(false);
  });

  it("is only slower next time when the disk refuses", async () => {
    mockIPC(() => {
      throw new Error("disk full");
    });
    await expect(keep("PR_1", kept(), "v1")).resolves.toBeUndefined();
    expect(keptCurrent("PR_1", "v1")).toBe(false);
  });

  it("starts over when its notes can't be read", async () => {
    localStorage.setItem("kept-written", "{");
    localStorage.setItem("kept-versions", "{");
    expect(keptCurrent("PR_1", "v1")).toBe(false);
    const { writes } = disk();
    await keep("PR_1", kept(), "v1");
    expect(writes).toEqual(["PR_1-files", "PR_1"]);
    expect(keptCurrent("PR_1", "v1")).toBe(true);
  });
});

describe("reading a kept review", () => {
  it("has nothing when nothing was kept", async () => {
    disk();
    expect(await readKept("PR_1")).toBeNull();
  });

  it("reads a copy from before the files were kept apart", async () => {
    disk({ PR_1: JSON.stringify(kept()) });
    expect(await readKept("PR_1")).toEqual(kept());
  });

  it("has nothing when the files are missing or the copy is damaged", async () => {
    disk({ PR_1: JSON.stringify({ details, threads: [] }) });
    expect(await readKept("PR_1")).toBeNull();
    disk({ PR_1: "{ damaged" });
    expect(await readKept("PR_1")).toBeNull();
    disk({ PR_1: JSON.stringify({ details }), "PR_1-files": "[]" });
    expect(await readKept("PR_1")).toBeNull();
  });

  it("has nothing when the disk can't be read", async () => {
    mockIPC(() => {
      throw new Error("no disk");
    });
    expect(await readKept("PR_1")).toBeNull();
  });
});

describe("when storage can't be read", () => {
  it("knows no copy is current, rather than failing whoever asked", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage off");
    });
    try {
      expect(keptCurrent("PR_1", "2026-01-01T00:00:00Z")).toBe(false);
    } finally {
      getItem.mockRestore();
    }
  });
});
