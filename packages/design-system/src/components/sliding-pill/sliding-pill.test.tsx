import { act, render, screen, waitFor } from "@testing-library/react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SlidingPill } from "./sliding-pill";

// happy-dom lays nothing out: each option says where it is in data-box="left top width height".
function box(this: HTMLElement, i: number) {
  return Number((this.dataset.box ?? "0 0 0 0").split(" ")[i]);
}
function layOut() {
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
    return box.call(this, 0);
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
    return box.call(this, 1);
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
    return box.call(this, 2);
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return box.call(this, 3);
  });
}

/** Keeps what a ResizeObserver would be told, to tell it by hand. */
function observeResizes() {
  const seen = { callback: null as (() => void) | null, observed: [] as Element[], disconnected: false };
  class Observer {
    constructor(callback: () => void) {
      seen.callback = callback;
    }
    observe(el: Element) {
      seen.observed.push(el);
    }
    unobserve() {}
    disconnect() {
      seen.disconnected = true;
    }
  }
  vi.stubGlobal("ResizeObserver", Observer);
  return seen;
}

function Row({ selected, line, sizes = "0 0 60 24" }: { selected: string; line?: boolean; sizes?: string }) {
  return (
    <div data-testid="row">
      <button type="button" data-pill="all" data-box={sizes}>
        All
      </button>
      <button type="button" data-pill="mine" data-box="64 0 80 24">
        Mine
      </button>
      <SlidingPill selected={selected} line={line} className="extra" />
    </div>
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
});

const pill = () => screen.getByTestId("row").querySelector<HTMLElement>("span")!;

describe("SlidingPill", () => {
  it("sits behind the chosen option, sliding only once it's been placed", async () => {
    layOut();
    const { rerender } = render(<Row selected="all" />);
    expect(pill().style.transform).toBe("translate(0px, 0px)");
    expect(pill().style.width).toBe("60px");
    expect(pill().style.height).toBe("24px");
    expect(pill().className).not.toContain("transition-");
    await waitFor(() => {
      expect(pill().className).toContain("transition-");
    });
    rerender(<Row selected="mine" />);
    expect(pill().style.transform).toBe("translate(64px, 0px)");
    expect(pill().style.width).toBe("80px");
  });

  it("can be a 2px line under the chosen tab", () => {
    layOut();
    render(<Row selected="mine" line />);
    expect(pill().style.transform).toBe("translate(64px, 22px)");
    expect(pill().style.height).toBe("2px");
    expect(pill().className).toContain("bg-foreground");
  });

  it("stays hidden while the chosen option has no size, and follows it as it resizes", () => {
    layOut();
    const resizes = observeResizes();
    const { unmount } = render(<Row selected="all" sizes="0 0 0 0" />);
    expect(pill().style.opacity).toBe("0");
    // The row and each option are watched.
    expect(resizes.observed).toHaveLength(3);
    screen.getByRole("button", { name: "All" }).dataset.box = "0 0 70 24";
    act(() => {
      resizes.callback?.();
    });
    expect(pill().style.width).toBe("70px");
    unmount();
    expect(resizes.disconnected).toBe(true);
  });

  it("stays hidden with no option of that key", () => {
    layOut();
    render(<Row selected="nobody" />);
    expect(pill().style.opacity).toBe("0");
  });

  it("does nothing without a parent element to slide in", () => {
    const host = document.createElement("div");
    const root = createRoot(host.attachShadow({ mode: "open" }));
    act(() => {
      root.render(<SlidingPill selected="all" />);
    });
    expect(host.shadowRoot?.querySelector("span")?.style.opacity).toBe("0");
    act(() => {
      root.unmount();
    });
  });
});
