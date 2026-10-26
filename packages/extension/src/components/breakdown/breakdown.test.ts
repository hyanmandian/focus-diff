// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createBreakdown, type BreakdownRow } from "./breakdown";

const row = (overrides: Partial<BreakdownRow> & Pick<BreakdownRow, "id" | "name">): BreakdownRow => ({
  visible: 4,
  total: 10,
  additions: 30,
  deletions: 10,
  pending: 0,
  minutes: 20,
  viewed: 1,
  minutesLeft: 15,
  ...overrides,
});

const ROWS: BreakdownRow[] = [
  row({ id: "frontend", name: "Frontend" }),
  row({ id: "docs", name: "Docs", visible: 2, viewed: 2, minutesLeft: 0, additions: 0, deletions: 0 }),
  row({ id: "styles", name: "Styles", visible: 0, viewed: 0, minutesLeft: 0, additions: 0, deletions: 0 }),
];

const mount = () => {
  const host = document.createElement("div");
  const fallback = document.createElement("button");
  const onToggle = vi.fn<(id: string) => void>();
  const onOpen = vi.fn<() => void>();
  const breakdown = createBreakdown(
    {
      host,
      signal: new AbortController().signal,
      focused: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    },
    { onToggle, onOpen, fallback },
  );
  host.append(breakdown.toggle, breakdown.popover, fallback);
  document.body.replaceChildren(host);
  const rowOf = (id: string) => breakdown.popover.querySelector<HTMLButtonElement>(`[data-row="${id}"]`)!;
  const squares = (id: string) =>
    [...rowOf(id).querySelectorAll(".diffstat span")].map((square) => square.className || "-").join(" ");
  return { ...breakdown, host, fallback, onToggle, onOpen, rowOf, squares };
};

describe("createBreakdown", () => {
  it("only works out its rows while it's open", () => {
    const { render, toggle, popover, onOpen, isOpen } = mount();
    const rows = vi.fn<() => BreakdownRow[]>(() => ROWS);
    render(rows, ["frontend"]);
    expect(rows).not.toHaveBeenCalled();
    toggle.click();
    expect(isOpen()).toBe(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(rows).toHaveBeenCalledOnce();
    expect(popover.querySelectorAll(".row")).toHaveLength(3);
    toggle.click();
    expect(isOpen()).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows each filter's files viewed, lines and time left", () => {
    const { render, setOpen, rowOf, squares, popover } = mount();
    setOpen(true);
    render(() => ROWS, ["frontend"]);
    expect([...popover.querySelectorAll(".columns span")].map((column) => column.textContent)).toEqual([
      "",
      "Filter",
      "Viewed",
      "Lines",
      "Time left",
    ]);
    const frontend = rowOf("frontend");
    expect(frontend.getAttribute("aria-pressed")).toBe("true");
    expect(frontend.querySelector(".row-check svg")).not.toBeNull();
    expect(frontend.querySelector(".row-viewed")?.textContent).toBe("1/4");
    expect(frontend.querySelector(".row-viewed")?.classList.contains("complete")).toBe(false);
    expect(frontend.querySelector(".additions")?.textContent).toBe("+30");
    expect(frontend.querySelector(".deletions")?.textContent).toBe("−10");
    expect(frontend.querySelector(".row-time")?.textContent).toBe("~15 min");
    expect(frontend.getAttribute("aria-label")).toBe(
      "Frontend: 4 files, 1 viewed, 30 lines added, 10 removed. ~15 min left to review",
    );
    expect(squares("frontend")).toBe("add add add add del");
    const docs = rowOf("docs");
    expect(docs.querySelector(".row-check")?.childElementCount).toBe(0);
    expect(docs.querySelector(".row-viewed")?.classList.contains("complete")).toBe(true);
    expect(docs.querySelector(".row-time")?.textContent).toBe("");
    expect(docs.getAttribute("aria-label")).toBe("Docs: 2 files, 2 viewed, 0 lines added, 0 removed. Done");
    expect(squares("docs")).toBe("- - - - -");
    expect(popover.querySelector(".info")?.getAttribute("data-tip")).toContain("1,000 changed lines an hour");
  });

  it("toggles a filter from its row, unless there's nothing in it", () => {
    const { render, setOpen, rowOf, onToggle } = mount();
    setOpen(true);
    render(() => ROWS, ["frontend"]);
    expect(rowOf("styles").getAttribute("aria-disabled")).toBe("true");
    expect(rowOf("styles").dataset.tip).toBe("No files in this pull request match Styles");
    expect(rowOf("styles").getAttribute("aria-description")).toBe("No files in this pull request match Styles");
    rowOf("styles").click();
    expect(onToggle).not.toHaveBeenCalled();
    rowOf("docs").click();
    expect(onToggle).toHaveBeenCalledWith("docs");
    expect(rowOf("docs").hasAttribute("data-tip")).toBe(false);
  });

  it("keeps focus on a row, or on the time hint, as it's redrawn", () => {
    const { render, setOpen, rowOf, popover } = mount();
    setOpen(true);
    render(() => ROWS, []);
    rowOf("docs").focus();
    render(() => ROWS, ["docs"]);
    expect(document.activeElement).toBe(rowOf("docs"));
    expect(rowOf("docs").getAttribute("aria-pressed")).toBe("true");
    popover.querySelector<HTMLElement>(".info")!.focus();
    render(() => ROWS, ["frontend"]);
    expect(document.activeElement).toBe(popover.querySelector(".info"));
    // The same rows aren't drawn again.
    const before = rowOf("frontend");
    render(() => structuredClone(ROWS), ["frontend"]);
    expect(rowOf("frontend")).toBe(before);
  });

  it("draws afresh when reopened, and gives focus back to its toggle or the fallback", () => {
    const { render, setOpen, rowOf, toggle, fallback } = mount();
    render(() => ROWS, []);
    setOpen(true);
    rowOf("docs").focus();
    setOpen(false);
    expect(document.activeElement).toBe(toggle);
    setOpen(true);
    const before = rowOf("docs");
    setOpen(false);
    setOpen(true);
    expect(rowOf("docs")).not.toBe(before);
    rowOf("docs").focus();
    toggle.hidden = true;
    setOpen(false);
    expect(document.activeElement).toBe(fallback);
  });

  it("centres itself over its toggle", () => {
    const { setOpen, toggle, popover, host, reposition } = mount();
    Object.defineProperty(toggle, "offsetWidth", { value: 32 });
    vi.spyOn(host, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, width: 800 }));
    vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 400, width: 32 }));
    vi.spyOn(popover, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, width: 200 }));
    Object.defineProperty(document.documentElement, "clientWidth", { value: 1000, configurable: true });
    setOpen(true);
    expect(popover.style.left).toBe("316px");
    popover.style.left = "";
    reposition();
    expect(popover.style.left).toBe("316px");
  });
});
