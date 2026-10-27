import type { Learned } from "@focus-diff/core/estimate";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { chord, FilterBar, type Next } from "@/components/filter-bar/filter-bar";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import type { DiffFilter } from "@/utils/config/config";
import type { Totals } from "@/utils/filters/filters";
import type { ReviewFile } from "@/utils/review/review";

const file = (path: string, additions: number, deletions: number): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions,
  deletions,
  patch: "",
});

const FILES = [file("src/cart.ts", 40, 10), file("src/cart.test.ts", 20, 0), file("README.md", 0, 0)];
const filter = (id: string, name: string, include: string): DiffFilter => ({
  id,
  name,
  include,
  exclude: "",
  repos: [],
});
const FILTERS = [
  filter("code", "Code", "\\.ts$"),
  filter("tests", "Tests", "\\.test\\."),
  filter("css", "Styles", "\\.css$"),
];
const VIEWED = new Set(["src/cart.test.ts"]);
const isViewed = (f: ReviewFile) => VIEWED.has(f.path);
const minutesOf = (path: string) => (path.endsWith(".md") ? 0 : 30);
const shown: Totals = { files: 3, viewed: 1, additions: 60, deletions: 10, minutes: 60, minutesLeft: 30 };

type Props = Parameters<typeof FilterBar>[0];

/** Tooltips without the second's wait. */
function AtOnce({ children }: { children: ReactNode }) {
  return <TooltipProvider delay={0}>{children}</TooltipProvider>;
}

function bar(extra: Partial<Props> = {}) {
  const props: Props = {
    files: FILES,
    filters: FILTERS,
    chosen: [],
    shown,
    next: { left: 2 },
    isViewed,
    minutesOf,
    learned: null,
    onToggle: vi.fn<(id: string) => void>(),
    onNextFile: vi.fn<() => void>(),
    ...extra,
  };
  render(<FilterBar {...props} />, { wrapper: AtOnce });
  return props;
}

const chips = () =>
  within(screen.getByRole("group", { name: "Review one part" }))
    .getAllByRole("button", { pressed: true })
    .concat(screen.getAllByRole("button", { pressed: false }))
    .map((b) => b.textContent);

describe("chord", () => {
  it("ends with what it's given (the comments' button), after a divider", () => {
    bar({ children: <button type="button">Comments</button> });
    const group = screen.getByRole("group", { name: "Review one part" });
    expect(group.lastElementChild?.textContent).toBe("Comments");
  });

  it("writes a filter's shortcut as the platform does", () => {
    expect(chord("J")).toMatch(/J$/u);
  });
});

describe("FilterBar", () => {
  it("shows the filters as chips with their counts, All on when none is", () => {
    bar();
    const group = screen.getByRole("group", { name: "Review one part" });
    expect(group.getAttribute("aria-keyshortcuts")).toBe("Alt+Shift+. Alt+Shift+,");
    expect(chips()).toEqual(["All3", "Code2", "Tests1", "Styles0"]);
    expect(screen.getByRole("button", { name: /^Styles/u }).className).toContain("text-muted-foreground");
    expect(screen.getByRole("button", { name: /^All/u }).getAttribute("aria-keyshortcuts")).toBe("Alt+Shift+0");
  });

  it("turns a filter on and off", async () => {
    const props = bar({ chosen: ["tests"] });
    expect(screen.getByRole("button", { name: /^Tests/u }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^All/u }).getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(screen.getByRole("button", { name: /^Code/u }));
    await userEvent.click(screen.getByRole("button", { name: /^All/u }));
    expect(vi.mocked(props.onToggle).mock.calls).toEqual([["code"], [""]]);
  });

  it("shows what's in view: files left, lines and time", () => {
    bar();
    expect(screen.getByLabelText("2 files").textContent).toBe("2");
    expect(screen.getByLabelText("Lines in view: 60 added, 10 removed").textContent).toBe("+60−10");
    expect(screen.getByLabelText("About 30 min left to review").textContent).toBe("~30 min");
  });

  it("says when everything in view is viewed", () => {
    bar({ shown: { ...shown, viewed: 3, minutesLeft: 0 } });
    expect(screen.getByLabelText("Done: every file here is viewed").textContent).toContain("Done");
  });

  it.each<[string, Next, string]>([
    ["files left", { left: 2 }, "Next file to review, 2 left"],
    [
      "another filter",
      { left: 0, nextFilter: { id: "tests", name: "Tests", left: 1 } },
      "Next: Tests, 1 file to review",
    ],
  ])("goes to the next file to review: %s", async (_, next, label) => {
    const props = bar({ next });
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(props.onNextFile).toHaveBeenCalled();
  });

  it("goes nowhere when every file is viewed", async () => {
    const props = bar({ next: { left: 0 } });
    const button = screen.getByRole("button", { name: "Every file here is viewed" });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(button);
    expect(props.onNextFile).not.toHaveBeenCalled();
  });

  it("explains the next file and the time in tooltips", async () => {
    bar({ learned: { all: { actual: 10, expected: 12, files: 4 }, kinds: {} } satisfies Learned });
    await userEvent.hover(screen.getByRole("button", { name: "Next file to review, 2 left" }));
    expect(await screen.findByText(chord("J"))).toBeTruthy();
    await userEvent.unhover(screen.getByRole("button", { name: "Next file to review, 2 left" }));
    await userEvent.hover(screen.getByLabelText("About 30 min left to review"));
    expect(await screen.findByText(/learned from 4 files/u)).toBeTruthy();
  });

  it("leaves the shortcut out of a next button that goes nowhere", async () => {
    bar({ next: { left: 0 } });
    await userEvent.hover(screen.getByRole("button", { name: "Every file here is viewed" }));
    const tip = await screen.findByText("Every file here is viewed", { selector: "[data-slot=tooltip-content]" });
    expect(tip.querySelector("kbd")).toBeNull();
  });

  it("shows only the totals for a repository without filters", () => {
    bar({ filters: [] });
    expect(screen.getByRole("group", { name: "Review one part" }).hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(screen.queryByRole("button", { name: /^All/u })).toBeNull();
    expect(screen.queryByRole("button", { name: "Breakdown by filter" })).toBeNull();
  });

  describe("breakdown", () => {
    const open = () => userEvent.click(screen.getByRole("button", { name: "Breakdown by filter" }));
    const rows = () =>
      within(screen.getByRole("group", { name: "Filters" }))
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("aria-pressed"));

    it("splits the pull request across the filters", async () => {
      bar({ chosen: ["code"] });
      await open();
      expect(screen.getByRole("dialog", { name: "Breakdown by Filter" })).toBeTruthy();
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual([
        "All: 3 files, 1 viewed, 60 lines added, 10 removed. ~30 min left to review",
        "Code: 2 files, 1 viewed, 60 lines added, 10 removed. ~30 min left to review",
        "Tests: 1 file, 1 viewed, 20 lines added, 0 removed. Done",
        "Styles: 0 files, 0 viewed, 0 lines added, 0 removed. Done",
      ]);
      expect(rows().map((r) => r.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
      const tests = rows()[2]!;
      expect(within(tests).getByText("1/1").className).toContain("text-success");
      const styles = rows()[3]!;
      expect(styles.getAttribute("aria-disabled")).toBe("true");
      expect(styles.title).toBe("No files in Styles");
    });

    it("turns filters on from its rows, but not an empty one", async () => {
      const props = bar();
      await open();
      await userEvent.click(rows()[1]!);
      await userEvent.click(rows()[3]!);
      expect(vi.mocked(props.onToggle).mock.calls).toEqual([["code"]]);
    });

    it("lets an empty filter that's on be turned off", async () => {
      const props = bar({ chosen: ["css"] });
      await open();
      await userEvent.click(rows()[3]!);
      expect(props.onToggle).toHaveBeenCalledWith("css");
    });

    it("draws each row's share of added and removed lines", async () => {
      bar({ files: [file("a.ts", 1, 3), file("b.css", 0, 0)] });
      await open();
      const squares = (row: HTMLElement) =>
        [...row.querySelectorAll("span.size-2")].map((s) =>
          s.className.includes("bg-success") ? "+" : s.className.includes("bg-destructive") ? "-" : ".",
        );
      expect(squares(rows()[0]!)).toEqual(["+", "-", "-", "-", "-"]);
      expect(squares(rows()[3]!)).toEqual([".", ".", ".", ".", "."]);
    });

    it("explains how the time is worked out", async () => {
      bar();
      await open();
      const info = screen.getByRole("button", { name: "Time left" });
      expect(info.getAttribute("aria-description")).toMatch(/lines an hour/u);
    });
  });
});
