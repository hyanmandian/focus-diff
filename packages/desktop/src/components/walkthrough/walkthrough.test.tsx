import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { WalkthroughRail, WalkthroughStart } from "@/components/walkthrough/walkthrough";
import type { AnalysisState } from "@/hooks/use-analysis/use-analysis";
import type { Finding } from "@/utils/ai/ai";
import type { Saved } from "@/utils/bridge/bridge";
import { useDiagrams } from "@/utils/diagrams/diagrams";
import { fakeAnalysis } from "@/utils/mock-analysis/mock-analysis";
import type { ReviewFile } from "@/utils/review/review";
import type { Section } from "@/utils/walkthrough/walkthrough";

vi.mock("@/utils/diagrams/diagrams", () => ({ useDiagrams: vi.fn<typeof useDiagrams>() }));

type RailProps = ComponentProps<typeof WalkthroughRail>;

const file = (path: string): ReviewFile => ({
  path,
  previousPath: null,
  status: "modified",
  additions: 4,
  deletions: 2,
  patch: "",
});

const FILES = ["api/orders.go", "src/routes/a.ts", "src/routes/b.ts", "src/odd.ts", "src/x.test.ts"].map((p) =>
  file(p),
);

const section = (over: Partial<Section>): Section => ({
  title: "",
  kind: "change",
  weight: "normal",
  before: "",
  after: "",
  summary: "",
  diagram: "",
  flow: [],
  files: [],
  alike: [],
  alikeNote: "",
  deep: false,
  ...over,
});

const MANY = Array.from({ length: 10 }, (_, i) => ({ path: `src/many/${String(i)}.ts`, note: "" }));

const SECTIONS: Section[] = [
  section({
    title: "Orders endpoint",
    weight: "high",
    before: "Orders were made by hand.",
    after: "`POST /orders` makes them.",
    summary: "Creates orders.",
    diagram: "flowchart LR\n  A[handler] --> B[store]:::added",
    flow: [
      { depth: 0, change: "same", code: "res = handle(req)", path: "api/orders.go", line: 3 },
      { depth: 1, change: "removed", code: "manual(req)" },
      { depth: 1, change: "added", code: "order = create(req)", path: "src/odd.ts" },
    ],
    files: [{ path: "api/orders.go", note: "Checks `total`", line: 12, end: 20 }, ...MANY],
    deep: true,
  }),
  section({
    title: "Routes",
    kind: "pattern",
    weight: "low",
    after: "Nothing changes for callers.",
    files: [{ path: "src/routes/a.ts", note: "", line: 4 }],
    alike: [{ path: "src/routes/b.ts", note: "" }],
    alikeNote: "Each wraps `handler`",
  }),
  section({
    title: "Odd one",
    kind: "exception",
    before: "Was odd.",
    files: [{ path: "src/odd.ts", note: "" }],
    alike: [{ path: "src/odd2.ts", note: "" }],
  }),
  section({
    kind: "rest",
    weight: "low",
    files: [
      { path: "src/x.test.ts", note: "" },
      { path: "gone.ts", note: "" },
    ],
  }),
];

const run = (over: Partial<Saved>): Saved => ({
  id: "r1",
  kind: "analysis",
  key: "",
  head: "abcdef1234",
  at: Date.now(),
  status: "done",
  project: false,
  meta: "",
  archived: false,
  dismissed: [],
  ...over,
});

const state = (over: Partial<AnalysisState> = {}): AnalysisState =>
  fakeAnalysis({
    analysis: {
      walkthrough: { overview: "Adds orders.", diagram: "", sections: SECTIONS, project: false, at: 1 },
      review: { summary: "", findings: [], project: false, at: 1 },
    },
    record: run({}),
    runs: [
      run({ id: "r0", status: "failed" }),
      run({ id: "r2", status: "stopped" }),
      run({}),
      run({ id: "r3", status: "running" }),
    ],
    split: { kept: FILES.slice(0, 4), leftOut: [{ reason: "tests", files: [FILES[4]!] }] },
    current: true,
    ...over,
  });

const finding = (path: string): Finding => ({ path, line: 1, severity: "issue", body: "x", inDiff: true });

function rail(over: Partial<RailProps> = {}) {
  const props: RailProps = {
    state: state(),
    provider: "Claude Code",
    files: FILES,
    findings: [finding("api/orders.go"), finding("src/routes/b.ts"), finding("src/routes/b.ts")],
    at: 0,
    isViewed: (path) => path.startsWith("src/odd"),
    onPick: vi.fn<RailProps["onPick"]>(),
    onOpen: vi.fn<RailProps["onOpen"]>(),
    ...over,
  };
  render(<WalkthroughRail {...props} />);
  return props;
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });

describe("WalkthroughStart", () => {
  const start = (over: Partial<AnalysisState> = {}, problem: string | null = null) => {
    const onOpenSettings = vi.fn<() => void>();
    const s = state({ analysis: null, ...over });
    render(<WalkthroughStart state={s} provider="Claude Code" problem={problem} onOpenSettings={onOpenSettings} />);
    return { s, onOpenSettings };
  };

  it("opens an archived run from the start, and offers no history before any run is done", async () => {
    const archived = run({ archived: true });
    const { s } = start({ record: null, runs: [archived] });
    await userEvent.click(button("Earlier runs"));
    await userEvent.click(screen.getAllByRole("menuitemradio")[0]!);
    expect(s.show).toHaveBeenCalledWith("r1");
    cleanup();
    start({ record: null, runs: [run({ status: "failed" })] });
    expect(screen.queryByRole("button", { name: "Earlier runs" })).toBeNull();
  });

  it("says what it does and what it sets aside, and builds it", async () => {
    const { s } = start();
    expect(screen.getByText(/Claude Code reviews the pull request/u)).toBeTruthy();
    expect(screen.getByText("4 files to walk through")).toBeTruthy();
    expect(screen.getByText(/1 set aside\. Tests, fixtures/u)).toBeTruthy();
    await userEvent.click(button("Review and Build Walkthrough"));
    expect(s.build).toHaveBeenCalledOnce();
  });

  it("says what's wrong with the AI, and why the last try failed", async () => {
    const { onOpenSettings } = start({ error: "No quota" }, "Sign in to Claude Code");
    expect(screen.getByText("Sign in to Claude Code")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("No quota");
    await userEvent.click(button("Open AI Settings"));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows what it's reading while it builds, and stops", async () => {
    const { s } = start({ building: true });
    expect(screen.getByText("Reading 4 files…")).toBeTruthy();
    expect(screen.getByText(/keeps going if you close the window/u)).toBeTruthy();
    await userEvent.click(button("Stop"));
    expect(s.stop).toHaveBeenCalledOnce();
  });

  it("has nothing to build when every file is set aside, and waits for the files", () => {
    start({ split: { kept: [], leftOut: [{ reason: "tests", files: FILES }] } });
    expect(screen.getByText(/Nothing to walk through/u)).toBeTruthy();
    document.body.replaceChildren();
    start({ split: { kept: FILES, leftOut: [] } });
    expect(screen.getByText("5 files to walk through").parentElement?.textContent).toBe("5 files to walk through");
    document.body.replaceChildren();
    start({ split: null });
    expect(button("Review and Build Walkthrough").hasAttribute("disabled")).toBe(true);
    expect(screen.queryByText(/to walk through/u)).toBeNull();
  });
});

describe("WalkthroughRail", () => {
  it("opens the part it's on, with what it does, how it changed, its picture and call path", async () => {
    const props = rail();
    expect(screen.getByRole("heading", { name: "Walkthrough" })).toBeTruthy();
    expect(screen.getByText("by Claude Code")).toBeTruthy();
    expect(button(/Part 1: Orders endpoint/u).getAttribute("aria-current")).toBe("step");
    expect(screen.getByText("Creates orders.")).toBeTruthy();
    expect(screen.getByText("Before").nextElementSibling?.textContent).toBe("Orders were made by hand.");
    expect(screen.getByText("After").nextElementSibling?.textContent).toBe("POST /orders makes them.");
    expect(useDiagrams).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Explain This Part" })).toBeNull();
    const flow = within(screen.getByRole("figure", { name: "Call path" }));
    expect(flow.getAllByRole("listitem")).toHaveLength(3);
    expect(flow.getByLabelText("Removed").textContent).toBe("−");
    await userEvent.click(flow.getByRole("button", { name: /res = handle\(req\)/u }));
    expect(props.onOpen).toHaveBeenLastCalledWith("api/orders.go", 3);
    await userEvent.click(flow.getByRole("button", { name: /order = create\(req\)/u }));
    expect(props.onOpen).toHaveBeenLastCalledWith("src/odd.ts", null);
    expect(flow.getByTitle("manual(req)")).toBeTruthy();
  });

  it("lists the part's files, what to look at in each, and folds a long list", async () => {
    const props = rail();
    const row = button(/api\/orders\.go/u);
    expect(row.textContent).toContain("L12–20");
    expect(row.textContent).toContain("Checks total");
    await userEvent.click(row);
    expect(props.onOpen).toHaveBeenLastCalledWith("api/orders.go", 12);
    expect(screen.queryByTitle("src/many/9.ts")).toBeNull();
    await userEvent.click(button("3 more files"));
    await userEvent.click(screen.getByTitle("src/many/9.ts"));
    expect(props.onOpen).toHaveBeenLastCalledWith("src/many/9.ts", null);
  });

  it("marks the parts to look at closely or to skim, the patterns and the exceptions, with their comments", () => {
    rail();
    expect(within(button(/Part 1:/u)).getByText("Look closely")).toBeTruthy();
    expect(within(button(/Part 1:/u)).getByTitle("1 AI comment")).toBeTruthy();
    expect(within(button(/Part 2:/u)).getByText("Skim")).toBeTruthy();
    expect(within(button(/Part 2:/u)).getByText("Pattern")).toBeTruthy();
    expect(within(button(/Part 2:/u)).getByTitle("2 AI comments")).toBeTruthy();
    expect(within(button(/Part 3:/u)).getByText("Exception")).toBeTruthy();
    expect(button(/Part 4: Everything else/u).textContent).toBe("4Part 4: Everything else");
  });

  it("folds the files that follow a pattern, and explains a part on demand", async () => {
    const s = state();
    rail({ state: s, at: 1 });
    expect(screen.queryByTitle("src/routes/b.ts")).toBeNull();
    await userEvent.click(button("1 more file like these"));
    expect(screen.getByText(/Each wraps/u).textContent).toBe("Each wraps handler");
    expect(screen.queryByText("Before")).toBeNull();
    expect(screen.getByText("Nothing changes for callers.")).toBeTruthy();
    expect(screen.getByTitle("src/routes/b.ts")).toBeTruthy();
    expect(button(/src\/routes\/a\.ts/u).textContent).toContain("L4");
    await userEvent.click(button("Explain This Part"));
    expect(s.deepen).toHaveBeenCalledWith(1);
  });

  it("shows it's reading a part, stops it, and says why it failed", async () => {
    const s = state({ deepening: (i) => i === 2, partError: (i) => (i === 2 ? "No quota" : null) });
    rail({ state: s, at: 2 });
    expect(screen.getByText("Reading this part's full diff…")).toBeTruthy();
    expect(screen.getByText("Before").nextElementSibling?.textContent).toBe("Was odd.");
    expect(screen.queryByText("After")).toBeNull();
    await userEvent.click(button("1 more file like these"));
    expect(screen.getByTitle("src/odd2.ts")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("No quota");
    await userEvent.click(button("Stop"));
    expect(s.stopPart).toHaveBeenCalledWith(2);
  });

  it("groups the rest by why it was set aside", async () => {
    rail({ at: 3 });
    expect(screen.getByText(/Tests, fixtures, docs and the files no part took/u)).toBeTruthy();
    await userEvent.click(button("Tests · 1"));
    await userEvent.click(button("Not in a part · 1"));
    expect(screen.getByTitle("src/x.test.ts")).toBeTruthy();
    expect(screen.getByTitle("gone.ts")).toBeTruthy();
  });

  it("goes part by part, from the list and the buttons, with how far along the review is", async () => {
    const props = rail({ at: 2 });
    expect(screen.getByText("1 of 4 parts reviewed")).toBeTruthy();
    expect(screen.getByText("3 of 4")).toBeTruthy();
    await userEvent.click(button(/Part 1:/u));
    expect(props.onPick).toHaveBeenLastCalledWith(0);
    await userEvent.click(button("Previous"));
    expect(props.onPick).toHaveBeenLastCalledWith(1);
    await userEvent.click(button("Next"));
    expect(props.onPick).toHaveBeenLastCalledWith(3);
  });

  it("keeps the part it's on at the top while the parts open and close, until the reader scrolls", () => {
    let now = 0;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => frames.push(callback));
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const top = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return new DOMRect(0, this.querySelector("[aria-current]") ? 300 : 20);
    });
    rail({ at: 2 });
    const list = button(/Part 1:/u).closest("ol")!;
    expect(list.scrollTop).toBe(280);
    top.mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.querySelector("[aria-current]") ? 250 : 20);
    });
    for (const frame of frames.splice(0)) frame(0);
    expect(list.scrollTop).toBe(230);
    now = 700;
    for (const frame of frames.splice(0)) frame(0);
    expect(frames).toHaveLength(0);
    list.dispatchEvent(new WheelEvent("wheel"));
    expect(cancel).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("can't go before the first part nor past the last", () => {
    rail({ at: 0, state: state({ analysis: null }) });
    expect(button("Previous").hasAttribute("disabled")).toBe(true);
    expect(button("Next").hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("0 of 0 parts reviewed")).toBeTruthy();
    expect(screen.queryByText("More")).toBeNull();
  });

  it("shows the whole overview on demand", async () => {
    rail();
    await userEvent.click(button("More"));
    await userEvent.click(button("Less"));
    expect(button("More")).toBeTruthy();
  });

  it("reviews again, says when there are newer commits, and why the last try failed", async () => {
    const s = state({ stale: true, error: "No quota" });
    rail({ state: s });
    expect(screen.getByText("There are new commits since this walkthrough.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("No quota");
    await userEvent.click(button("Review Again"));
    expect(s.build).toHaveBeenCalledOnce();
  });

  it("shows it's reviewing again instead of offering to", async () => {
    const s = state({ building: true, stale: true, split: null });
    rail({ state: s });
    expect(screen.getByText("Reading 0 files…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review Again" })).toBeNull();
    expect(screen.queryByText("There are new commits since this walkthrough.")).toBeNull();
    await userEvent.click(button("Stop"));
    expect(s.stop).toHaveBeenCalledOnce();
  });

  it("lists the earlier runs, shows one, and archives it", async () => {
    const s = state();
    rail({ state: s });
    await userEvent.click(button("Earlier runs"));
    const items = screen.getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["nowabcdef1", "nowabcdef1· stopped", "nowabcdef1· failed"]);
    expect(items[0]!.getAttribute("aria-checked")).toBe("true");
    expect(items[1]!.getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive This Run" }));
    expect(s.archive).toHaveBeenCalledWith("r1", true);
  });

  it("shows an archived run as such, and unarchives it", async () => {
    const archived = run({ archived: true });
    const s = state({ record: archived, runs: [archived, run({ id: "r9" })] });
    rail({ state: s });
    await userEvent.click(button("Earlier runs"));
    expect(screen.getAllByRole("menuitemradio")[1]!.textContent).toBe("nowabcdef1· archived");
    await userEvent.click(screen.getAllByRole("menuitemradio")[0]!);
    expect(s.show).toHaveBeenCalledWith("r9");
    await userEvent.click(button("Earlier runs"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Unarchive This Run" }));
    expect(s.archive).toHaveBeenCalledWith("r1", false);
  });

  it("has nothing to archive before a run is shown, nor a change to tell in a bare part", async () => {
    const bare = section({ title: "Bare", files: [{ path: "a.ts", note: "" }] });
    const analysis = {
      walkthrough: { overview: "", diagram: "", sections: [bare], project: false, at: 1 },
      review: { summary: "", findings: [], project: false, at: 1 },
    };
    rail({ state: state({ record: null, runs: [], analysis }) });
    expect(screen.queryByText("Before")).toBeNull();
    expect(screen.queryByText("After")).toBeNull();
    await userEvent.click(button("Earlier runs"));
    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});
