// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { FADE, scrollBehavior, scrollRow } from "./scroll-row";

const sized = (element: HTMLElement, { client, scroll }: { client: number; scroll: number }) => {
  Object.defineProperty(element, "clientWidth", { configurable: true, value: client });
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scroll });
};

describe("scrollBehavior", () => {
  it("scrolls smoothly unless motion is reduced", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    expect(scrollBehavior()).toBe("smooth");
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    expect(scrollBehavior()).toBe("instant");
  });
});

describe("scrollRow", () => {
  it("fades out each side with more to scroll to", () => {
    const chips = document.createElement("div");
    sized(chips, { client: 300, scroll: 900 });
    const { row, updateEdges } = scrollRow(chips);
    updateEdges();
    expect(row.classList.contains("more-before")).toBe(false);
    expect(row.classList.contains("more-after")).toBe(true);
    chips.scrollLeft = 300;
    chips.dispatchEvent(new Event("scroll"));
    expect(row.classList.contains("more-before")).toBe(true);
    expect(row.classList.contains("more-after")).toBe(true);
    chips.scrollLeft = 600;
    chips.dispatchEvent(new Event("scroll"));
    expect(row.classList.contains("more-after")).toBe(false);
  });

  it("scrolls a view's width, less the fades, from each arrow", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const chips = document.createElement("div");
    sized(chips, { client: 300, scroll: 900 });
    const scrollBy = vi.spyOn(chips, "scrollBy").mockImplementation(() => {});
    const { row } = scrollRow(chips);
    row.querySelector<HTMLElement>(".scroll-button.after")!.click();
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 300 - FADE * 2, behavior: "instant" });
    row.querySelector<HTMLElement>(".scroll-button.before")!.click();
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -(300 - FADE * 2), behavior: "instant" });
  });
});
