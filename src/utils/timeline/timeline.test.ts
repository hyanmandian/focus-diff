import { describe, expect, it } from "vitest";
import { byTime, mapTimeline } from "@/utils/timeline/timeline";

const commit = (oid: string, login: string, at: string) => ({ __typename: "PullRequestCommit", id: `c-${oid}`, commit: { oid, abbreviatedOid: oid.slice(0, 7), messageHeadline: `Commit ${oid}`, committedDate: at, url: `https://github.com/a/b/commit/${oid}`, author: { user: { login }, name: login } } });
const label = (kind: "LabeledEvent" | "UnlabeledEvent", name: string, at: string, login = "ana") => ({ __typename: kind, id: `${kind}-${name}-${at}`, createdAt: at, actor: { login }, label: { name, color: "ff0000" } });

describe("timeline", () => {
  it("reads a run of commits by one person as one event", () => {
    const events = mapTimeline([commit("aaa", "ana", "2026-01-01T10:00:00Z"), commit("bbb", "ana", "2026-01-01T11:00:00Z"), commit("ccc", "bruno", "2026-01-01T12:00:00Z")]);
    expect(events.map((e) => e.kind)).toEqual(["commits", "commits"]);
    expect(events[0]).toMatchObject({ actor: "ana", at: "2026-01-01T11:00:00Z" });
    expect(events[0]!.kind === "commits" && events[0]!.commits.map((c) => c.oid)).toEqual(["aaa", "bbb"]);
  });

  it("reads label changes made together as one, apart otherwise", () => {
    const events = mapTimeline([label("LabeledEvent", "bug", "2026-01-01T10:00:00Z"), label("UnlabeledEvent", "triage", "2026-01-01T10:00:30Z"), label("LabeledEvent", "ui", "2026-01-01T12:00:00Z")]);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "labels", added: [{ name: "bug" }], removed: [{ name: "triage" }] });
    expect(events[1]).toMatchObject({ kind: "labels", added: [{ name: "ui" }], removed: [] });
  });

  it("maps each kind, and leaves out what it can't read", () => {
    const at = "2026-01-01T10:00:00Z";
    const base = { createdAt: at, actor: { login: "ana" } };
    const events = mapTimeline([
      { __typename: "HeadRefForcePushedEvent", id: "1", ...base, beforeCommit: { abbreviatedOid: "1111111" }, afterCommit: { abbreviatedOid: "2222222" }, ref: { name: "feature" } },
      { __typename: "ReviewRequestedEvent", id: "2", ...base, requestedReviewer: { __typename: "Team", name: "Core" } },
      { __typename: "ReviewRequestedEvent", id: "3", ...base, requestedReviewer: null },
      { __typename: "RenamedTitleEvent", id: "4", ...base, previousTitle: "Old", currentTitle: "New" },
      { __typename: "MergedEvent", id: "5", ...base, commit: { abbreviatedOid: "abcdef0" }, mergeRefName: "main" },
      { __typename: "CrossReferencedEvent", id: "6", ...base, willCloseTarget: true, source: { __typename: "Issue", number: 9, title: "Bug", url: "https://github.com/a/b/issues/9", repository: { nameWithOwner: "a/b" } } },
      { __typename: "ReadyForReviewEvent", id: "7", ...base },
      { __typename: "AssignedEvent", id: "8", ...base, assignee: { __typename: "User", login: "bruno" } },
      { __typename: "SomethingNewEvent", id: "9", ...base },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["forcePushed", "reviewRequested", "renamed", "merged", "referenced", "ready", "assigned"]);
    expect(events[0]).toMatchObject({ before: "1111111", after: "2222222", ref: "feature" });
    expect(events[1]).toMatchObject({ reviewer: "Core" });
    expect(events[4]).toMatchObject({ number: 9, willClose: true, isPull: false });
  });

  it("puts what was said and what happened in one list, newest first", () => {
    const entries = [{ id: "e2", at: "2026-01-01T12:00:00Z" }, { id: "e1", at: "2026-01-01T09:00:00Z" }];
    const events = mapTimeline([commit("aaa", "ana", "2026-01-01T10:00:00Z")]);
    expect(byTime(entries, events).map((x) => (x.kind === "entry" ? x.entry.id : x.event.kind))).toEqual(["e2", "commits", "e1"]);
    expect(byTime([], events)).toHaveLength(1);
  });
});
