// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createStats, isDone, type Totals } from "./stats";

const totals = (overrides: Partial<Totals> = {}): Totals => ({
  visible: 4,
  total: 10,
  additions: 120,
  deletions: 30,
  pending: 0,
  minutes: 90,
  viewed: 1,
  minutesLeft: 45,
  ...overrides,
});

const readOut = (element: HTMLElement) =>
  [...element.querySelectorAll(".visually-hidden")].map((span) => span.textContent).join("|");

describe("isDone", () => {
  it("is done once every shown file is viewed and loaded", () => {
    expect(isDone(totals({ minutesLeft: 0 }))).toBe(true);
  });

  it("isn't done with nothing shown, time left, or files still loading", () => {
    expect(isDone(totals({ visible: 0, minutesLeft: 0 }))).toBe(false);
    expect(isDone(totals())).toBe(false);
    expect(isDone(totals({ minutesLeft: 0, pending: 2 }))).toBe(false);
  });
});

describe("createStats", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
  });

  it("reads out the files left, the lines and the time left", () => {
    const { element, render } = createStats();
    render(totals());
    expect(readOut(element)).toBe(
      "3 files left to review| +120 lines added,| −30 lines removed|| ~45 min| left to review",
    );
    expect(element.querySelector<HTMLElement>(".files")!.dataset.tip).toBe("3 files left to review");
    expect(element.hasAttribute("data-done")).toBe(false);
    expect(element.dataset.tip).toBeUndefined();
  });

  it("gives the time left way to the Done badge when every file is viewed", () => {
    const { element, render } = createStats();
    render(totals({ viewed: 4, minutesLeft: 0 }));
    expect(element.hasAttribute("data-done")).toBe(true);
    expect(element.querySelector(".clock")?.textContent).toBe("–");
    expect(element.querySelector(".done")?.textContent).toBe("Done");
    expect(readOut(element)).toBe("0 files left to review| +120 lines added,| −30 lines removed|||");
  });

  it("says when files aren't loaded yet, and stops once they are", () => {
    const { element, render } = createStats();
    render(totals({ pending: 2 }));
    expect(element.dataset.tip).toBe("2 files not loaded yet, so line counts are partial");
    expect(readOut(element)).toContain(" 2 files not loaded yet, so line counts are partial");
    render(totals(), totals({ visible: 10 }));
    expect(element.dataset.tip).toBeUndefined();
    expect(readOut(element)).not.toContain("not loaded");
  });
});
