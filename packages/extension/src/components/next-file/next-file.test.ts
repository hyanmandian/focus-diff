// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { createNextFile } from "./next-file";

describe("createNextFile", () => {
  it("says how many files are left and goes to the next one", () => {
    const onNext = vi.fn<() => void>();
    const { element, render } = createNextFile(onNext);
    render({ left: 3 });
    expect(element.getAttribute("aria-label")).toBe("Next file to review, 3 left");
    expect(element.dataset.tip).toBe(element.getAttribute("aria-label"));
    expect(element.getAttribute("aria-disabled")).toBe("false");
    element.click();
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("moves on to the next filter with files left", () => {
    const { element, render } = createNextFile(vi.fn<() => void>());
    render({ left: 0, nextFilter: { name: "Backend", left: 2 } });
    expect(element.getAttribute("aria-label")).toBe("Go to Backend, 2 files to review");
    expect(element.getAttribute("aria-disabled")).toBe("false");
  });

  it("is disabled with nothing left anywhere", () => {
    const onNext = vi.fn<() => void>();
    const { element, render } = createNextFile(onNext);
    render({ left: 0 });
    expect(element.getAttribute("aria-label")).toBe("Every file here is viewed");
    expect(element.getAttribute("aria-disabled")).toBe("true");
    element.click();
    expect(onNext).not.toHaveBeenCalled();
  });
});
