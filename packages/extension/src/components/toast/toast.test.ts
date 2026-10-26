// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toaster } from "./toast";

describe("toaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a message, fades it out, then empties the live region", () => {
    const region = document.createElement("div");
    const toast = toaster(region);
    toast("Saved");
    expect(region.textContent).toBe("Saved");
    expect(region.classList.contains("visible")).toBe(true);
    vi.advanceTimersByTime(2800);
    expect(region.classList.contains("visible")).toBe(false);
    expect(region.textContent).toBe("Saved");
    vi.advanceTimersByTime(250);
    expect(region.textContent).toBe("");
  });

  it("starts the clock again for a new message", () => {
    const region = document.createElement("div");
    const toast = toaster(region);
    toast("One");
    vi.advanceTimersByTime(2000);
    toast("Two");
    vi.advanceTimersByTime(2000);
    expect(region.classList.contains("visible")).toBe(true);
    expect(region.textContent).toBe("Two");
  });
});
