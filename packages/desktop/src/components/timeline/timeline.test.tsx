import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vite-plus/test";

import { describe as words, TimelineRow } from "@/components/timeline/timeline";
import { mockCommands } from "@/utils/fake-platform/fake-platform";
import { i18n } from "@/utils/i18n/i18n";
import type { Args } from "@/utils/platform/platform";
import type { TimelineEvent } from "@/utils/timeline/timeline";

const at = "2026-10-20T10:00:00Z";
const base = { id: "E1", at, actor: "ana" };
const commit = (n: number) => ({ oid: `oid${n}`, short: `abc${n}`, headline: `Commit ${n}`, url: `https://c/${n}` });
const red = { name: "bug", color: "d73a4a" };
const blue = { name: "docs", color: "0075ca" };

const arg = (args: Args | undefined, key: string): unknown => new Map(Object.entries(args ?? {})).get(key);

function opened() {
  const urls: unknown[] = [];
  mockCommands((cmd, args) => {
    if (cmd === "open_url") urls.push(arg(args, "url"));
  });
  return urls;
}

const row = (event: TimelineEvent) => render(<TimelineRow event={event} />);

describe("an event in words", () => {
  const t = i18n();
  const say = (event: TimelineEvent) => words(event, t);

  it("puts each event in words, with who did it", () => {
    expect(say({ ...base, kind: "commits", commits: [commit(1), commit(2)] })).toBe("ana added 2 commits");
    expect(say({ ...base, kind: "forcePushed", ref: "main", before: "a1", after: "b2" })).toBe(
      "ana force-pushed main from a1 to b2",
    );
    expect(say({ ...base, kind: "forcePushed", ref: "main", before: null, after: null })).toBe(
      "ana force-pushed main from ? to ?",
    );
    expect(say({ ...base, kind: "reviewRequested", reviewer: "bo" })).toBe("ana asked bo to review");
    expect(say({ ...base, kind: "reviewRequestRemoved", reviewer: "bo" })).toBe(
      "ana took back the review request for bo",
    );
    expect(say({ ...base, kind: "labels", added: [red], removed: [blue] })).toBe("ana changed labels");
    expect(say({ ...base, kind: "labels", added: [red], removed: [] })).toBe("ana added");
    expect(say({ ...base, kind: "labels", added: [], removed: [blue] })).toBe("ana removed");
    expect(say({ ...base, kind: "renamed", from: "Old", to: "New" })).toBe("ana changed the title from “Old” to “New”");
    expect(say({ ...base, kind: "merged", commit: "abc", into: "main" })).toBe("ana merged abc into main");
    expect(say({ ...base, kind: "merged", commit: null, into: "main" })).toBe("ana merged  into main");
    const reference = {
      ...base,
      kind: "referenced",
      number: 7,
      title: "Bug",
      url: "https://x",
      repo: "acme/a",
    } as const;
    expect(say({ ...reference, isPull: false, willClose: false })).toBe("ana mentioned this in acme/a#7: Bug");
    expect(say({ ...reference, isPull: true, willClose: true })).toBe("ana linked acme/a#7, which this closes: Bug");
    expect(say({ ...base, kind: "commitReferenced", commit: "abc", headline: "Fix", url: "https://c" })).toBe(
      "ana referenced this in abc: Fix",
    );
    expect(say({ ...base, kind: "deployed", environment: "prod" })).toBe("ana deployed to prod");
    expect(say({ ...base, kind: "assigned", assignee: "bo" })).toBe("ana assigned bo");
    expect(say({ ...base, kind: "assigned", assignee: "ana" })).toBe("ana self-assigned this");
    expect(say({ ...base, kind: "unassigned", assignee: "ana" })).toBe("ana removed their assignment");
    expect(say({ ...base, kind: "milestoned", milestone: "v2" })).toBe("ana added this to the v2 milestone");
    expect(say({ ...base, kind: "demilestoned", milestone: "v2" })).toBe("ana removed this from the v2 milestone");
    expect(say({ ...base, kind: "reviewDismissed", reviewer: "bo", message: null })).toBe("ana dismissed bo's review");
    expect(say({ ...base, kind: "reviewDismissed", reviewer: null, message: null })).toBe(
      "ana dismissed Someone's review",
    );
    expect(say({ ...base, kind: "baseChanged", from: "dev", to: "main" })).toBe(
      "ana changed the base from dev to main",
    );
  });

  it("says only who did it for the rest", () => {
    expect(say({ ...base, kind: "ready" })).toBe("ana marked this ready for review");
    expect(say({ ...base, kind: "branchDeleted" })).toBe("ana deleted the branch");
    expect(say({ ...base, actor: null, kind: "closed" })).toBe("Someone closed this");
  });
});

describe("TimelineRow", () => {
  it("shows the event and when", () => {
    row({ ...base, kind: "closed" });
    expect(screen.getByText("ana closed this")).toBeTruthy();
    expect(screen.getByRole("time").getAttribute("datetime")).toBe(at);
  });

  it("shows a lone commit's headline", () => {
    row({ ...base, kind: "commits", commits: [commit(1)] });
    expect(screen.getByText("ana added a commit")).toBeTruthy();
    expect(screen.getByText("Commit 1")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("opens a run of commits to list them", async () => {
    row({ ...base, kind: "commits", commits: [commit(1), commit(2)] });
    const toggle = screen.getByRole("button", { name: "ana added 2 commits" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Commit 2").nextElementSibling?.textContent).toBe("abc2");
    await userEvent.click(toggle);
    expect(screen.queryByText("Commit 2")).toBeNull();
  });

  it("shows the labels changed, the removed ones struck through", () => {
    row({ ...base, kind: "labels", added: [red], removed: [blue] });
    expect(screen.getByText("bug").parentElement?.className).not.toContain("line-through");
    expect(screen.getByText("docs").parentElement?.className).toContain("line-through");
  });

  it("opens what referenced it in the browser", async () => {
    const urls = opened();
    row({
      ...base,
      kind: "commitReferenced",
      commit: "abc",
      headline: "Fix",
      url: "https://github.com/acme/a/commit/abc",
    });
    await userEvent.click(screen.getByRole("button", { name: "ana referenced this in abc: Fix" }));
    expect(urls).toEqual(["https://github.com/acme/a/commit/abc"]);
  });

  it("doesn't link to anything but https", () => {
    row({
      ...base,
      kind: "referenced",
      number: 7,
      title: "Bug",
      url: "javascript:alert(1)",
      repo: "acme/a",
      isPull: false,
      willClose: false,
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("ana mentioned this in acme/a#7: Bug")).toBeTruthy();
  });
});
