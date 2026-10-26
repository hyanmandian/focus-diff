import { describe, expect, it, vi } from "vite-plus/test";

import { mergeDrafts, toPut, unsent, type PendingReview } from "@/utils/pending/pending";
import type { Draft, Thread } from "@/utils/review/review";

vi.mock("@/utils/bridge/bridge", () => ({ bridge: {}, graphql: vi.fn(), github: vi.fn() }));

const empty = { jobs: [], ids: {} };
const draft = (key: string, body: string, extra: Partial<Draft> = {}): Draft => ({
  key,
  path: "a.ts",
  side: "additions",
  line: 3,
  body,
  ...extra,
});
const onGitHub = (comments: Partial<PendingReview["comments"][number]>[]): PendingReview => ({
  id: "R_1",
  comments: comments.map((c) => ({
    id: "C_1",
    body: "",
    html: "",
    path: "a.ts",
    line: 3,
    startLine: null,
    file: false,
    replyTo: null,
    ...c,
  })),
});

describe("mergeDrafts", () => {
  it("shows the kept copy until GitHub's been asked", () => {
    const kept = [draft("k1", "kept")];
    expect(mergeDrafts(kept, null, empty, [])).toEqual(kept);
  });

  it("takes GitHub's comments under the keys the window gave them", () => {
    const merged = mergeDrafts(
      [draft("k1", "old", { side: "deletions" })],
      onGitHub([{ id: "C_1", body: "from github", html: "<p>from github</p>" }]),
      { jobs: [], ids: { k1: "C_1" } },
      [],
    );
    expect(merged).toEqual([
      {
        key: "k1",
        id: "C_1",
        body: "from github",
        html: "<p>from github</p>",
        path: "a.ts",
        side: "deletions",
        line: 3,
      },
    ]);
  });

  it("loads a review started on github.com, replies and file comments included", () => {
    const thread: Thread = {
      id: "T_1",
      path: "b.ts",
      side: "deletions",
      line: 8,
      resolved: false,
      outdated: false,
      comments: [{ id: "X_1", databaseId: 1, author: null, html: "", at: "", url: "" }],
    };
    const merged = mergeDrafts(
      [],
      onGitHub([
        { id: "C_2", body: "a reply", path: "b.ts", line: 0, replyTo: "X_1" },
        { id: "C_3", body: "on the file", line: 0, file: true },
      ]),
      empty,
      [thread],
    );
    expect(merged.map((d) => [d.key, d.replyTo, d.side, d.line, d.file])).toEqual([
      ["C_2", "T_1", "deletions", 8, undefined],
      ["C_3", undefined, "additions", 0, true],
    ]);
  });

  it("puts what's on its way over GitHub's: the newest text, new ones after, removed ones gone", () => {
    const github = onGitHub([
      { id: "C_1", body: "first", html: "<p>first</p>" },
      { id: "C_2", body: "second" },
    ]);
    const state = {
      ids: { k1: "C_1", k2: "C_2" },
      jobs: [
        { change: toPut("PR_1", draft("k1", "first, edited")), error: null },
        { change: { op: "remove" as const, key: "k2", pull: "PR_1" }, error: null },
        { change: toPut("PR_1", draft("k3", "new")), error: "refused" },
      ],
    };
    const merged = mergeDrafts([], github, state, []);
    expect(merged.map((d) => [d.key, d.body, d.id, d.html])).toEqual([
      ["k1", "first, edited", "C_1", undefined],
      ["k3", "new", undefined, undefined],
    ]);
  });
});

describe("unsent", () => {
  it("finds comments kept here that are neither on GitHub nor on their way", () => {
    const kept = [
      draft("old", "written before"),
      draft("k1", "queued"),
      draft("k2", "sent", { id: "C_2" }),
      draft("k3", "synced"),
    ];
    const state = { jobs: [{ change: toPut("PR_1", kept[1]!), error: null }], ids: { k3: "C_3" } };
    expect(unsent(kept, null, state).map((d) => d.key)).toEqual(["old"]);
  });
});
