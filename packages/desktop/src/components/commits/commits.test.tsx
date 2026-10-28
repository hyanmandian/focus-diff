import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { CommitsSection, RangeBanner, RangePicker, rangeLabel } from "@/components/commits/commits";
import type { Pull } from "@/hooks/use-pull/use-pull";
import { sinceReview, type Commits, type Range } from "@/utils/commits/commits";
import { i18n } from "@/utils/i18n/i18n";
import { fakeCommit, fakePull } from "@/utils/mock-pull/mock-pull";

const commit = (n: number, extra: Parameters<typeof fakeCommit>[0] = {}) =>
  fakeCommit({
    oid: `oid${n}`,
    short: `c${n}`,
    headline: `Commit ${n}`,
    at: `2026-10-20T1${n}:00:00Z`,
    parent: n === 1 ? "base0" : `oid${n - 1}`,
    ...extra,
  });

const COMMITS = [
  commit(1, { verified: true, ci: "success", body: "Why it changed" }),
  commit(2, { verified: false, ci: "failure", author: { login: null, name: "Bot", avatarUrl: null } }),
  commit(3, { ci: "pending" }),
  commit(4),
];
const list = (extra: Partial<Commits> = {}): Commits => ({
  commits: COMMITS,
  forcePushes: [],
  reviewed: null,
  ...extra,
});

const withList = (commits: Commits | null, extra: Partial<Pull> = {}) =>
  fakePull({ commits, since: commits ? sinceReview(commits) : null, ...extra });

describe("rangeLabel", () => {
  const t = i18n();
  const l = list({ reviewed: "oid2" });
  const since = sinceReview(l);

  it("names a range as the toolbar does", () => {
    expect(rangeLabel(null, l, since, t)).toBe("All Changes");
    expect(rangeLabel({ from: "oid2", to: "oid4" }, l, since, t)).toBe("Since Your Last Review");
    expect(rangeLabel({ from: "oid1", to: "oid2" }, l, since, t)).toBe("c2");
    expect(rangeLabel({ from: "base0", to: "oid3" }, l, null, t)).toBe("3 commits");
    expect(rangeLabel({ from: "aaaaaaaaaa", to: "bbbbbbbbbb" }, l, since, t)).toBe("aaaaaaa…bbbbbbb");
    expect(rangeLabel({ from: "base0", to: "oid3" }, null, null, t)).toBe("base0…oid3");
  });
});

describe("CommitsSection", () => {
  it("shows nothing without commits", () => {
    const onOpen = vi.fn<(range: Range) => void>();
    const { container } = render(<CommitsSection pull={withList(null)} onOpen={onOpen} />);
    render(<CommitsSection pull={withList(list({ commits: [] }))} onOpen={onOpen} />, { container });
    expect(container.textContent).toBe("");
  });

  it("lists the commits with force pushes where they happened, and opens one", async () => {
    const onOpen = vi.fn<(range: Range) => void>();
    const pushes = [
      { at: "2026-10-20T12:30:00Z", actor: "ana", before: "1234567890", after: "abcdefabcd" },
      { at: "2026-10-20T13:30:00Z", actor: null, before: null, after: null },
    ];
    render(<CommitsSection pull={withList(list({ forcePushes: pushes, reviewed: "oid3" }))} onOpen={onOpen} />);
    const section = screen.getByRole("region", { name: "Commits 4" });
    expect(screen.getByRole("heading", { level: 2 }).querySelector("button")).toBeTruthy();
    expect(section.textContent).toContain("force-pushed 2 times");
    await userEvent.click(screen.getByRole("button", { name: /Commits/u }));
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("OCCommit 1 Verifiedc1"),
      expect.stringContaining("BOCommit 2 Unverifiedc2"),
      expect.stringContaining("ana force-pushed from 1234567 to abcdefa"),
      expect.stringContaining("Commit 3your reviewc3"),
      expect.stringContaining("Someone force-pushed from ? to ?"),
      expect.stringContaining("Commit 4c4"),
    ]);
    expect(within(items[0]!).getByLabelText("Passed")).toBeTruthy();
    expect(within(items[1]!).getByLabelText("Failed")).toBeTruthy();
    expect(within(items[3]!).getByLabelText("Running")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Commit 1/u }).title).toBe("Commit 1\n\nWhy it changed");
    expect(screen.getByRole("button", { name: /Commit 4/u }).title).toBe("Commit 4");
    await userEvent.click(screen.getByRole("button", { name: /Commit 2/u }));
    expect(onOpen).toHaveBeenCalledWith({ from: "oid1", to: "oid2" });
  });

  it("explains a signature in a tooltip", async () => {
    render(<CommitsSection pull={withList(list())} onOpen={vi.fn<(range: Range) => void>()} />);
    await userEvent.click(screen.getByRole("button", { name: /Commits/u }));
    await userEvent.hover(screen.getByText("Verified"));
    expect(await screen.findByText("Signed, and GitHub checked the signature")).toBeTruthy();
    await userEvent.unhover(screen.getByText("Verified"));
    await userEvent.hover(screen.getByText("Unverified"));
    expect(await screen.findByText("Signed, but GitHub couldn't check the signature")).toBeTruthy();
  });

  it("opens what's new since your review", async () => {
    const onOpen = vi.fn<(range: Range) => void>();
    render(<CommitsSection pull={withList(list({ reviewed: "oid2" }))} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "2 New Since Your Review" }));
    expect(onOpen).toHaveBeenCalledWith({ from: "oid2", to: "oid4" });
  });

  it("says when what you reviewed was rewritten", () => {
    render(<CommitsSection pull={withList(list({ reviewed: "gone" }))} onOpen={vi.fn<(range: Range) => void>()} />);
    expect(screen.getByRole("button", { name: "Changed Since Your Review" })).toBeTruthy();
  });
});

describe("RangePicker", () => {
  function Picker({ pull }: { pull: Pull }) {
    const [open, setOpen] = useState(false);
    return <RangePicker pull={pull} className="extra" open={open} onOpenChange={setOpen} />;
  }
  const trigger = () => screen.getByRole("button", { name: /^Changes shown/u });
  const options = () => screen.getAllByRole("option");

  it("offers all changes, since your review, and each commit", async () => {
    const pull = withList(list({ reviewed: "oid2" }));
    render(<Picker pull={pull} />);
    expect(trigger().getAttribute("aria-label")).toBe("Changes shown: All Changes");
    await userEvent.click(trigger());
    expect(screen.getByRole("listbox", { name: "Changes to Show" })).toBeTruthy();
    expect(options().map((o) => o.textContent)).toEqual([
      "All Changes4 commits",
      "Since Your Last Review2 commits",
      expect.stringMatching(/^Commit 1c1 · octocat · /u),
      expect.stringMatching(/^Commit 2c2 · Bot · /u),
      expect.stringMatching(/^Commit 3/u),
      expect.stringMatching(/^Commit 4/u),
    ]);
    expect(options()[0]!.getAttribute("aria-selected")).toBe("true");
    await userEvent.click(options()[1]!);
    expect(pull.setRange).toHaveBeenCalledWith({ from: "oid2", to: "oid4" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("picks one commit, or a run with shift", async () => {
    const user = userEvent.setup();
    const pull = withList(list());
    render(<Picker pull={pull} />);
    await user.click(trigger());
    await user.click(options()[1]!);
    expect(pull.setRange).toHaveBeenLastCalledWith({ from: "base0", to: "oid1" });
    await user.click(trigger());
    await user.keyboard("{Shift>}");
    await user.click(options()[3]!);
    await user.keyboard("{/Shift}");
    expect(pull.setRange).toHaveBeenLastCalledWith({ from: "base0", to: "oid3" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    await user.click(options()[0]!);
    expect(pull.setRange).toHaveBeenLastCalledWith(null);
  });

  it("starts a shift-click run at the commit clicked when nothing was", async () => {
    const user = userEvent.setup();
    const pull = withList(list());
    render(<Picker pull={pull} />);
    await user.click(trigger());
    await user.keyboard("{Shift>}");
    await user.click(options()[2]!);
    expect(pull.setRange).toHaveBeenLastCalledWith({ from: "oid1", to: "oid2" });
  });

  it("names the range shown and marks its commits", async () => {
    const l = list({ reviewed: "gone" });
    render(<Picker pull={withList(l, { range: { from: "oid1", to: "oid3" } })} />);
    expect(trigger().getAttribute("aria-label")).toBe("Changes shown: 2 commits");
    expect(trigger().className).toContain("text-primary");
    await userEvent.click(trigger());
    expect(options().map((o) => o.getAttribute("aria-selected"))).toEqual([
      "false",
      "false",
      "false",
      "true",
      "true",
      "false",
    ]);
    expect(options()[1]!.textContent).toBe("Since Your Last ReviewChanged Since Your Review");
  });

  it("waits for the commits", async () => {
    render(<Picker pull={withList(null)} />);
    await userEvent.click(trigger());
    expect(screen.getByLabelText("Loading")).toBeTruthy();
    expect(options().map((o) => o.textContent)).toEqual(["All Changes"]);
  });
});

describe("RangeBanner", () => {
  it("shows nothing while all changes show", () => {
    const { container } = render(<RangeBanner pull={withList(list())} loading={false} error={null} />);
    expect(container.textContent).toBe("");
  });

  it("says which changes show, and goes back to all of them", async () => {
    const pull = withList(list(), { range: { from: "oid1", to: "oid2" } });
    render(<RangeBanner pull={pull} loading={false} error={null} below />);
    const banner = screen.getByRole("status");
    expect(banner.textContent).toBe("Showing c2 · an older version: comments are offShow All Changes");
    expect(banner.className).toContain("top-12");
    await userEvent.click(screen.getByRole("button", { name: "Show All Changes" }));
    expect(pull.setRange).toHaveBeenCalledWith(null);
  });

  it("doesn't call the head's own changes older, and says why they couldn't load", () => {
    render(<RangeBanner pull={withList(list(), { range: { from: "oid3", to: "oid4" } })} loading error={null} />);
    expect(screen.getByRole("status").textContent).toBe("Showing c4Show All Changes");
    render(<RangeBanner pull={withList(null, { range: { from: "a", to: "b" } })} loading={false} error="Not found" />);
    expect(screen.getAllByRole("status")[1]!.textContent).toBe("Not foundShow All Changes");
  });
});
