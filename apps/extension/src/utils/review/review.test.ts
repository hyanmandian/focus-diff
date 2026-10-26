import { reviewMinutes } from "@focus-diff/core/estimate";
import { describe, expect, it, vi } from "vitest";

import type { Panel } from "@/components/panel/panel";
import { ALL } from "@/utils/filters/filters";

import {
  createReviewView,
  nextFilterWithWork,
  review,
  stepFrom,
  toggled,
  type Option,
  type ReviewFile,
} from "./review";

const file = (path: string, additions: number | null, viewed = false): ReviewFile => ({
  path,
  stats: additions === null ? null : { additions, deletions: 1 },
  viewed,
});

const options: Option[] = [
  { id: ALL, name: "All" },
  { id: "ts", name: "Code", matches: (path) => path.endsWith(".ts") },
  { id: "md", name: "Docs", matches: (path) => path.endsWith(".md") },
  { id: "py", name: "Python", matches: (path) => path.endsWith(".py") },
];

/** A minute a file, whatever is in it. */
const minutes = () => 1;

describe("toggled", () => {
  it("clears the selection for All, and adds or takes away a filter", () => {
    expect(toggled(["ts"], ALL)).toEqual([]);
    expect(toggled(["ts"], "md")).toEqual(["ts", "md"]);
    expect(toggled(["ts", "md"], "ts")).toEqual(["md"]);
  });
});

describe("stepFrom", () => {
  it("starts at either end, then steps and wraps around", () => {
    expect(stepFrom(0, 1, 4)).toBe(0);
    expect(stepFrom(0, -1, 4)).toBe(3);
    expect(stepFrom(2, 1, 4)).toBe(2);
    expect(stepFrom(4, 1, 4)).toBe(0);
    expect(stepFrom(1, -1, 4)).toBe(3);
  });
});

describe("nextFilterWithWork", () => {
  const filters = options.slice(1);
  const list = [file("a.ts", 1, true), file("b.md", 1), file("c.md", 1), file("d.py", 1, true)];

  it("names the next filter after the shown ones that still has unviewed files, wrapping around", () => {
    expect(nextFilterWithWork(list, filters, ["ts"])).toEqual({ id: "md", name: "Docs", left: 2 });
    expect(nextFilterWithWork(list, filters, ["py"])).toEqual({ id: "md", name: "Docs", left: 2 });
    expect(nextFilterWithWork(list, filters, [])).toEqual({ id: "md", name: "Docs", left: 2 });
  });

  it("finds none when every other filter is reviewed", () => {
    expect(nextFilterWithWork(list, filters, ["md"])).toBeUndefined();
    expect(nextFilterWithWork(list, [{ id: "x", name: "No matcher" }], [])).toBeUndefined();
  });
});

describe("review", () => {
  const list = [file("a.ts", 10, true), file("b.ts", null), file("c.md", 4)];

  it("shows every file with All, and counts what's left to review", () => {
    const current = review({ list, complete: true }, options, [], { minutes });
    expect(current).toMatchObject({ filtering: false, selection: [ALL], name: "All" });
    expect(current.shown).toEqual(list);
    expect(current.totals).toEqual({
      visible: 3,
      total: 3,
      additions: 14,
      deletions: 2,
      pending: 1,
      minutes: 3,
      viewed: 1,
      minutesLeft: 2,
    });
    expect(current.all).toBe(current.totals);
    expect(current.nextFile).toEqual({ left: 2, nextFilter: undefined });
    expect(current.options).toEqual([
      { id: ALL, name: "All", count: 3, loading: false },
      { id: "ts", name: "Code", count: 2, loading: false },
      { id: "md", name: "Docs", count: 1, loading: false },
      { id: "py", name: "Python", count: 0, loading: false },
    ]);
    expect(current.matches("anything")).toBe(true);
  });

  it("narrows to the chosen filters, in the bar's order, and names them together", () => {
    const current = review({ list, complete: true }, options, ["md", "ts", "gone"], { minutes, loading: true });
    expect(current).toMatchObject({ filtering: true, selection: ["ts", "md"], name: "Code + Docs" });
    expect(current.shown.map(({ path }) => path)).toEqual(["a.ts", "b.ts", "c.md"]);
    expect(current.options[1]).toEqual({ id: "ts", name: "Code", count: 2, loading: true });
    expect(current.matches("x.py")).toBe(false);
  });

  it("points to the next filter with work once the chosen one is reviewed", () => {
    const current = review({ list, complete: true }, options, ["py"], { minutes });
    expect(current.totals.visible).toBe(0);
    expect(current.nextFile).toEqual({ left: 0, nextFilter: { id: "ts", name: "Code", left: 1 } });
    expect(current.all.visible).toBe(3);
  });

  it("counts files the site hasn't drawn as pending, and estimates them only when everything is shown", () => {
    const drawn = { list: [file("a.ts", 10)], complete: false };
    const all = review(drawn, options, [], { minutes, reported: 4 });
    expect(all.totals).toMatchObject({ visible: 4, total: 4, pending: 3, minutes: 4, minutesLeft: 4 });
    const filtered = review(drawn, options, ["ts"], { minutes, reported: 4 });
    expect(filtered.totals).toMatchObject({ visible: 1, total: 4, pending: 3, minutes: 1 });
    expect(review(drawn, options, [], { minutes, reported: 0 }).totals.total).toBe(1);
  });

  it("works the minutes out at the default pace when none is given", () => {
    const current = review({ list: [file("a.ts", 10)], complete: true }, options, []);
    expect(current.totals.minutes).toBe(reviewMinutes("a.ts", { additions: 10, deletions: 1 }));
  });

  it("works out a row per option for the breakdown", () => {
    const rows = review({ list, complete: true }, options, ["ts"], { minutes }).rows();
    expect(rows.map(({ id, visible }) => [id, visible])).toEqual([
      [ALL, 3],
      ["ts", 2],
      ["md", 1],
      ["py", 0],
    ]);
  });
});

describe("createReviewView", () => {
  const panelSpy = () => {
    const panel = {
      renderOptions: vi.fn<Panel["renderOptions"]>(),
      renderNextFile: vi.fn<Panel["renderNextFile"]>(),
      renderStats: vi.fn<Panel["renderStats"]>(),
      renderBreakdown: vi.fn<Panel["renderBreakdown"]>(),
      announce: vi.fn<Panel["announce"]>(),
      celebrate: vi.fn<Panel["celebrate"]>(),
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the view only uses these parts of the panel.
    return { panel, show: createReviewView(panel as unknown as Panel) };
  };
  const unfinished = [file("a.ts", 1)];
  const finished = [file("a.ts", 1, true)];

  it("draws the review, and reads it out only when asked", () => {
    const { panel, show } = panelSpy();
    const current = review({ list: unfinished, complete: true }, options, [], { minutes });
    show(current, "k");
    expect(panel.renderOptions).toHaveBeenCalledWith(current.options, [ALL]);
    expect(panel.renderNextFile).toHaveBeenCalledWith(current.nextFile);
    expect(panel.renderStats).toHaveBeenCalledWith(current.totals, current.all);
    expect(panel.renderBreakdown).toHaveBeenCalledWith(current.rows, [ALL]);
    expect(panel.announce).not.toHaveBeenCalled();
    show(current, "k", { announce: true });
    expect(panel.announce).toHaveBeenCalledWith({ name: "All", ...current.totals });
  });

  it("celebrates a selection once, when its last file is marked viewed", () => {
    const { panel, show } = panelSpy();
    const done = review({ list: finished, complete: true }, options, [], { minutes });
    show(done, "k");
    expect(panel.celebrate).not.toHaveBeenCalled();
    show(review({ list: unfinished, complete: true }, options, [], { minutes }), "k");
    show(done, "other");
    expect(panel.celebrate).not.toHaveBeenCalled();
    show(review({ list: unfinished, complete: true }, options, [], { minutes }), "k");
    show(done, "k");
    show(done, "k");
    expect(panel.celebrate).toHaveBeenCalledOnce();
    expect(panel.celebrate).toHaveBeenCalledWith("All");
  });
});
