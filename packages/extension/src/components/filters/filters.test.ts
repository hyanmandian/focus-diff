// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFilters, type PanelOption } from "./filters";

const observed: (() => void)[] = [];
const frames: FrameRequestCallback[] = [];
const nextFrame = () => {
  for (const callback of frames.splice(0)) callback(0);
};

class FakeResizeObserver {
  constructor(callback: () => void) {
    observed.push(callback);
  }

  observe() {}

  disconnect() {}
}

const box = (
  element: HTMLElement,
  layout: Partial<Record<"offsetLeft" | "offsetWidth" | "offsetTop" | "offsetHeight", number>>,
) => {
  for (const [key, value] of Object.entries(layout)) Object.defineProperty(element, key, { value, configurable: true });
};

const LIST: PanelOption[] = [
  { id: "all", name: "All", count: 12 },
  { id: "frontend", name: "Frontend", count: 3 },
  { id: "docs", name: "Docs", count: 0 },
  { id: "tests", name: "Tests" },
];

const mount = () => {
  const controller = new AbortController();
  const onToggle = vi.fn<(id: string) => void>();
  const filters = createFilters(
    {
      host: document.body,
      signal: controller.signal,
      focused: () => (document.activeElement instanceof HTMLElement ? document.activeElement : null),
    },
    onToggle,
  );
  document.body.replaceChildren(filters.element);
  const toolbar = filters.element.querySelector<HTMLElement>(".filters")!;
  const chip = (id: string) => toolbar.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
  const indicator = toolbar.querySelector<HTMLElement>(".indicator")!;
  return { ...filters, controller, onToggle, toolbar, chip, indicator };
};

const press = (target: HTMLElement, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("createFilters", () => {
  beforeEach(() => {
    observed.length = 0;
    frames.length = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  });

  it("draws a chip per filter with its count, and says it changed only when the filters did", () => {
    const { render, chip, toolbar } = mount();
    expect(render(LIST, ["all"])).toBe(true);
    expect([...toolbar.querySelectorAll(".option-name")].map((name) => name.textContent)).toEqual([
      "All",
      "Frontend",
      "Docs",
      "Tests",
    ]);
    expect(chip("frontend").querySelector(".option-count")?.textContent).toBe("3");
    expect(chip("frontend").querySelector(".option-count-label")?.textContent).toBe(" 3 files");
    expect(chip("tests").querySelector(".option-count")?.textContent).toBe("");
    expect(chip("all").getAttribute("aria-pressed")).toBe("true");
    expect(chip("frontend").getAttribute("aria-pressed")).toBe("false");
    expect(chip("all").tabIndex).toBe(0);
    expect(chip("frontend").tabIndex).toBe(-1);
    expect(
      render(
        LIST.map((item) => ({ ...item, count: 1 })),
        ["all"],
      ),
    ).toBe(false);
    expect(chip("docs").classList.contains("empty")).toBe(false);
  });

  it("turns off a filter with nothing to show, and says why", () => {
    const { render, chip, onToggle } = mount();
    render(LIST, ["all"]);
    expect(chip("docs").classList.contains("empty")).toBe(true);
    expect(chip("docs").getAttribute("aria-disabled")).toBe("true");
    expect(chip("docs").dataset.tip).toBe("No files in this pull request match Docs");
    expect(chip("docs").getAttribute("aria-description")).toBe("No files in this pull request match Docs");
    chip("docs").click();
    expect(onToggle).not.toHaveBeenCalled();
    chip("frontend").click();
    expect(onToggle).toHaveBeenCalledWith("frontend");
  });

  it("lets an empty filter that's on be turned off, and one still loading be picked", () => {
    const { render, chip } = mount();
    render(LIST, ["docs"]);
    expect(chip("docs").getAttribute("aria-disabled")).toBe("false");
    expect(chip("docs").dataset.tip).toBeUndefined();
    expect(chip("docs").hasAttribute("aria-description")).toBe(false);
    render(
      LIST.map((item) => (item.id === "docs" ? { ...item, loading: true } : item)),
      ["all"],
    );
    expect(chip("docs").getAttribute("aria-disabled")).toBe("false");
  });

  it("moves between chips with the arrow keys, Home and End, wrapping around", () => {
    const { render, chip, toolbar } = mount();
    render(LIST, ["all"]);
    chip("all").focus();
    expect(press(chip("all"), "ArrowRight")).toBe(true);
    expect(document.activeElement).toBe(chip("frontend"));
    expect(chip("frontend").tabIndex).toBe(0);
    expect(chip("all").tabIndex).toBe(-1);
    press(chip("frontend"), "End");
    expect(document.activeElement).toBe(chip("tests"));
    press(chip("tests"), "ArrowDown");
    expect(document.activeElement).toBe(chip("all"));
    press(chip("all"), "ArrowUp");
    expect(document.activeElement).toBe(chip("tests"));
    press(chip("tests"), "Home");
    expect(document.activeElement).toBe(chip("all"));
    press(chip("all"), "ArrowLeft");
    expect(document.activeElement).toBe(chip("tests"));
    expect(press(chip("tests"), "a")).toBe(false);
    expect(document.activeElement).toBe(chip("tests"));
    // The focused chip keeps the tab stop as the counts update.
    render(LIST, ["all"]);
    expect(chip("tests").tabIndex).toBe(0);
    expect(chip("all").tabIndex).toBe(-1);
    // Keys from outside the chips aren't the toolbar's.
    chip("tests").blur();
    expect(press(toolbar, "ArrowRight")).toBe(false);
  });

  it("puts focus back on the pressed chip when the filters are redrawn under it", () => {
    const { render, chip } = mount();
    render(LIST, ["all"]);
    chip("frontend").focus();
    render([...LIST, { id: "styles", name: "Styles", count: 2 }], ["frontend"]);
    nextFrame();
    expect(document.activeElement).toBe(chip("frontend"));
  });

  it("slides the highlight to the one pressed chip, and combines it when several are", () => {
    const { render, chip, toolbar, indicator } = mount();
    // Chips not laid out yet leave the highlight alone.
    render(LIST, ["all"]);
    expect(indicator.style.width).toBe("");
    box(chip("all"), { offsetLeft: 0, offsetWidth: 60, offsetTop: 4, offsetHeight: 28 });
    box(chip("frontend"), { offsetLeft: 60, offsetWidth: 100, offsetTop: 4, offsetHeight: 28 });
    box(chip("tests"), { offsetLeft: 240, offsetWidth: 80 });
    box(indicator, { offsetHeight: 36 });
    render(LIST, ["frontend"]);
    expect(indicator.style.width).toBe("320px");
    expect(indicator.style.clipPath).toBe("inset(4px 160px 4px 60px round 8px)");
    expect(indicator.classList.contains("ready")).toBe(false);
    nextFrame();
    expect(indicator.classList.contains("ready")).toBe(true);
    render(LIST, ["all"]);
    expect(indicator.style.clipPath).toBe("inset(4px 260px 4px 0px round 8px)");
    render(LIST, ["all", "frontend"]);
    expect(toolbar.classList.contains("combined")).toBe(true);
    render(LIST, ["all"]);
    expect(toolbar.classList.contains("combined")).toBe(false);
  });

  it("moves the highlight as chips resize, until it's torn down", () => {
    const { render, chip, indicator, controller } = mount();
    render(LIST, ["frontend"]);
    box(chip("frontend"), { offsetLeft: 60, offsetWidth: 100 });
    box(chip("tests"), { offsetLeft: 240, offsetWidth: 80 });
    for (const callback of observed) callback();
    expect(indicator.style.width).toBe("320px");
    controller.abort();
  });

  it("scrolls the row just enough to show the pressed chip whole", () => {
    const { render, chip, toolbar } = mount();
    const scrollTo = vi.spyOn(toolbar, "scrollTo").mockImplementation(() => {});
    render(LIST, ["all"]);
    Object.defineProperty(toolbar, "clientWidth", { value: 300, configurable: true });
    box(chip("all"), { offsetLeft: 0, offsetWidth: 60 });
    box(chip("frontend"), { offsetLeft: 60, offsetWidth: 100 });
    box(chip("tests"), { offsetLeft: 400, offsetWidth: 80 });
    render(LIST, ["tests"]);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 236, behavior: "instant" });
    toolbar.scrollLeft = 300;
    render(LIST, ["all"]);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: -56, behavior: "instant" });
    scrollTo.mockClear();
    toolbar.scrollLeft = 0;
    render(LIST, ["frontend"]);
    expect(scrollTo).not.toHaveBeenCalled();
    // Nothing pressed, nothing to reveal.
    render(LIST, []);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
