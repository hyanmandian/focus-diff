import { describe, expect, it } from "vite-plus/test";

import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { byTime, loadTimeline, mapTimeline, type TimelineEvent, type TimelineNode } from "@/utils/timeline/timeline";

const at = "2026-01-01T10:00:00Z";
const base = { createdAt: at, actor: { login: "ana" } };
const ref = { owner: "a", repo: "b", number: 7 };

const commit = (oid: string, login: string, when: string): TimelineNode => ({
  __typename: "PullRequestCommit",
  id: `c-${oid}`,
  commit: {
    oid,
    abbreviatedOid: oid.slice(0, 7),
    messageHeadline: `Commit ${oid}`,
    committedDate: when,
    url: `https://github.com/a/b/commit/${oid}`,
    author: { user: { login }, name: login },
  },
});
const label = (kind: "LabeledEvent" | "UnlabeledEvent", name: string, when: string, login = "ana"): TimelineNode => ({
  __typename: kind,
  id: `${kind}-${name}-${when}`,
  createdAt: when,
  actor: { login },
  label: { name, color: "ff0000" },
});
const commitsOf = (event: TimelineEvent | undefined) => (event?.kind === "commits" ? event.commits : []);

function answer(nodes: unknown[], older: string | null = null) {
  const asked: string[] = [];
  const pageInfo = { hasPreviousPage: older !== null, startCursor: older };
  mockCommands((cmd, args) => {
    if (cmd !== "github") return null;
    asked.push(JSON.stringify(args));
    const data = { repository: { pullRequest: { timelineItems: { pageInfo, nodes } } } };
    return { status: 200, body: JSON.stringify({ data }) };
  });
  return asked;
}

describe("mapTimeline", () => {
  it("reads a run of commits by one person as one event", () => {
    const events = mapTimeline([
      commit("aaa", "ana", "2026-01-01T10:00:00Z"),
      commit("bbb", "ana", "2026-01-01T11:00:00Z"),
      commit("ccc", "bruno", "2026-01-01T12:00:00Z"),
    ]);
    expect(events.map((e) => e.kind)).toEqual(["commits", "commits"]);
    expect(events[0]).toMatchObject({ actor: "ana", at: "2026-01-01T11:00:00Z" });
    expect(commitsOf(events[0]).map((c) => c.oid)).toEqual(["aaa", "bbb"]);
  });

  it("names a commit's author by name when they have no account, or nobody", () => {
    const events = mapTimeline([
      {
        __typename: "PullRequestCommit",
        id: "c1",
        commit: {
          oid: "a1",
          abbreviatedOid: "a1",
          messageHeadline: "One",
          committedDate: at,
          url: "u1",
          author: { user: null, name: "Ana Lima" },
        },
      },
      {
        __typename: "PullRequestCommit",
        id: "c2",
        commit: { oid: "b2", abbreviatedOid: "b2", messageHeadline: "Two", committedDate: at, url: "u2", author: null },
      },
    ]);
    expect(events.map((e) => e.actor)).toEqual(["Ana Lima", null]);
  });

  it("reads label changes made together as one, apart otherwise", () => {
    const events = mapTimeline([
      label("LabeledEvent", "bug", "2026-01-01T10:00:00Z"),
      label("UnlabeledEvent", "triage", "2026-01-01T10:00:30Z"),
      label("LabeledEvent", "docs", "2026-01-01T10:00:40Z"),
      label("LabeledEvent", "ui", "2026-01-01T12:00:00Z"),
      label("UnlabeledEvent", "ui", "2026-01-01T12:00:10Z", "bruno"),
    ]);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      kind: "labels",
      at: "2026-01-01T10:00:40Z",
      added: [{ name: "bug" }, { name: "docs" }],
      removed: [{ name: "triage" }],
    });
    expect(events[1]).toMatchObject({ kind: "labels", added: [{ name: "ui" }], removed: [] });
    expect(events[2]).toMatchObject({ kind: "labels", actor: "bruno", added: [], removed: [{ name: "ui" }] });
  });

  it("maps each kind with its details", () => {
    const events = mapTimeline([
      {
        __typename: "HeadRefForcePushedEvent",
        id: "1",
        ...base,
        beforeCommit: { abbreviatedOid: "1111111" },
        afterCommit: { abbreviatedOid: "2222222" },
        ref: { name: "feature" },
      },
      { __typename: "ReviewRequestedEvent", id: "2", ...base, requestedReviewer: { __typename: "Team", name: "Core" } },
      {
        __typename: "ReviewRequestRemovedEvent",
        id: "2b",
        ...base,
        requestedReviewer: { __typename: "User", login: "bruno" },
      },
      { __typename: "RenamedTitleEvent", id: "4", ...base, previousTitle: "Old", currentTitle: "New" },
      { __typename: "MergedEvent", id: "5", ...base, commit: { abbreviatedOid: "abcdef0" }, mergeRefName: "main" },
      {
        __typename: "CrossReferencedEvent",
        id: "6",
        ...base,
        willCloseTarget: true,
        source: {
          __typename: "Issue",
          number: 9,
          title: "Bug",
          url: "https://github.com/a/b/issues/9",
          repository: { nameWithOwner: "a/b" },
        },
      },
      { __typename: "ReadyForReviewEvent", id: "7", ...base },
      { __typename: "AssignedEvent", id: "8", ...base, assignee: { __typename: "User", login: "bruno" } },
      { __typename: "UnassignedEvent", id: "8b", ...base, assignee: { __typename: "Bot", login: "bot" } },
      {
        __typename: "ReferencedEvent",
        id: "9",
        ...base,
        commit: { abbreviatedOid: "fedcba9", messageHeadline: "Fix it", url: "https://github.com/a/b/commit/f" },
      },
      { __typename: "DeployedEvent", id: "10", ...base, deployment: { environment: "staging" } },
      { __typename: "MilestonedEvent", id: "11", ...base, milestoneTitle: "v1" },
      { __typename: "DemilestonedEvent", id: "12", ...base, milestoneTitle: "v1" },
      {
        __typename: "ReviewDismissedEvent",
        id: "13",
        ...base,
        dismissalMessage: "Stale",
        review: { author: { login: "carla" } },
      },
      { __typename: "BaseRefChangedEvent", id: "14", ...base, previousRefName: "dev", currentRefName: "main" },
    ]);
    expect(events).toEqual([
      expect.objectContaining({ kind: "forcePushed", before: "1111111", after: "2222222", ref: "feature" }),
      expect.objectContaining({ kind: "reviewRequested", reviewer: "Core", actor: "ana", at, id: "2" }),
      expect.objectContaining({ kind: "reviewRequestRemoved", reviewer: "bruno" }),
      expect.objectContaining({ kind: "renamed", from: "Old", to: "New" }),
      expect.objectContaining({ kind: "merged", commit: "abcdef0", into: "main" }),
      expect.objectContaining({
        kind: "referenced",
        number: 9,
        title: "Bug",
        repo: "a/b",
        willClose: true,
        isPull: false,
      }),
      expect.objectContaining({ kind: "ready" }),
      expect.objectContaining({ kind: "assigned", assignee: "bruno" }),
      expect.objectContaining({ kind: "unassigned", assignee: "bot" }),
      expect.objectContaining({ kind: "commitReferenced", commit: "fedcba9", headline: "Fix it" }),
      expect.objectContaining({ kind: "deployed", environment: "staging" }),
      expect.objectContaining({ kind: "milestoned", milestone: "v1" }),
      expect.objectContaining({ kind: "demilestoned", milestone: "v1" }),
      expect.objectContaining({ kind: "reviewDismissed", reviewer: "carla", message: "Stale" }),
      expect.objectContaining({ kind: "baseChanged", from: "dev", to: "main" }),
    ]);
  });

  it("maps the events that carry nothing but their kind", () => {
    const kinds = [
      ["ReadyForReviewEvent", "ready"],
      ["ConvertToDraftEvent", "draft"],
      ["ClosedEvent", "closed"],
      ["ReopenedEvent", "reopened"],
      ["AutoMergeEnabledEvent", "autoMergeEnabled"],
      ["AutoMergeDisabledEvent", "autoMergeDisabled"],
      ["AddedToMergeQueueEvent", "queued"],
      ["RemovedFromMergeQueueEvent", "dequeued"],
      ["HeadRefDeletedEvent", "branchDeleted"],
      ["HeadRefRestoredEvent", "branchRestored"],
    ] as const;
    const events = mapTimeline(kinds.map(([typename], i) => ({ __typename: typename, id: String(i), ...base })));
    expect(events.map((e) => e.kind)).toEqual(kinds.map(([, kind]) => kind));
  });

  it("fills in what GitHub left empty: deleted commits, refs, people and environments", () => {
    const events = mapTimeline([
      {
        __typename: "HeadRefForcePushedEvent",
        id: "1",
        createdAt: at,
        beforeCommit: null,
        afterCommit: null,
        ref: null,
      },
      { __typename: "MergedEvent", id: "2", ...base, commit: null, mergeRefName: "main" },
      { __typename: "DeployedEvent", id: "3", ...base, deployment: null },
      { __typename: "ReviewDismissedEvent", id: "4", ...base, dismissalMessage: null, review: null },
      { __typename: "ReviewDismissedEvent", id: "5", ...base, dismissalMessage: null, review: { author: null } },
      { __typename: "ReviewRequestedEvent", id: "6", ...base, requestedReviewer: { __typename: "Mannequin" } },
      { __typename: "ClosedEvent", id: "7", createdAt: at, actor: null },
    ]);
    expect(events).toEqual([
      expect.objectContaining({ kind: "forcePushed", actor: null, before: null, after: null, ref: "" }),
      expect.objectContaining({ kind: "merged", commit: null }),
      expect.objectContaining({ kind: "deployed", environment: "" }),
      expect.objectContaining({ kind: "reviewDismissed", reviewer: null, message: null }),
      expect.objectContaining({ kind: "reviewDismissed", reviewer: null }),
      expect.objectContaining({ kind: "reviewRequested", reviewer: "" }),
      expect.objectContaining({ kind: "closed", actor: null }),
    ]);
  });

  it("leaves out events about something it can no longer see", () => {
    const events = mapTimeline([
      { __typename: "ReviewRequestedEvent", id: "1", ...base, requestedReviewer: null },
      { __typename: "CrossReferencedEvent", id: "2", ...base, willCloseTarget: false, source: null },
      { __typename: "ReferencedEvent", id: "3", ...base, commit: null },
      { __typename: "AssignedEvent", id: "4", ...base, assignee: null },
      { __typename: "UnassignedEvent", id: "5", ...base, assignee: { __typename: "Team" } },
    ]);
    expect(events).toEqual([]);
  });
});

describe("loadTimeline", () => {
  it("loads the newest page, without a cursor when there's nothing older", async () => {
    const asked = answer([{ __typename: "ClosedEvent", id: "1", ...base }]);
    const page = await loadTimeline(ref);
    expect(page).toEqual({ nodes: [{ __typename: "ClosedEvent", id: "1", ...base }], older: null });
    expect(asked[0]).toContain('"path":"/graphql"');
    expect(asked[0]).toContain(String.raw`\"variables\":{\"owner\":\"a\",\"name\":\"b\",\"number\":7,\"before\":null}`);
  });

  it("asks for an older page by its cursor and passes on the next one", async () => {
    const asked = answer([], "cursor-2");
    const page = await loadTimeline(ref, "cursor-1");
    expect(page.older).toBe("cursor-2");
    expect(asked[0]).toContain(String.raw`\"before\":\"cursor-1\"`);
  });

  it("drops nodes it doesn't know, and kinds newer than it, from what GitHub sends", async () => {
    answer([
      {},
      { __typename: "SomethingNewEvent", id: "x", ...base },
      { __typename: "ClosedEvent", id: "1", ...base },
    ]);
    const { nodes } = await loadTimeline(ref);
    expect(nodes).toHaveLength(2);
    expect(mapTimeline(nodes).map((e) => e.kind)).toEqual(["closed"]);
  });
});

describe("byTime", () => {
  it("puts what was said and what happened in one list, newest first", () => {
    const entries = [
      { id: "e2", at: "2026-01-01T12:00:00Z" },
      { id: "e1", at: "2026-01-01T09:00:00Z" },
    ];
    const events = mapTimeline([commit("aaa", "ana", "2026-01-01T10:00:00Z")]);
    expect(byTime(entries, events)).toEqual([
      { kind: "entry", entry: entries[0] },
      { kind: "event", event: events[0] },
      { kind: "entry", entry: entries[1] },
    ]);
  });

  it("keeps a list as it is when the other is empty", () => {
    const events = mapTimeline([commit("aaa", "ana", at)]);
    expect(byTime([], events)).toEqual([{ kind: "event", event: events[0] }]);
    expect(byTime([{ at }], [])).toEqual([{ kind: "entry", entry: { at } }]);
  });
});
