// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";

import { cloneOf, h, icon, wheelScrollsSideways } from "./dom";

describe("h", () => {
  it("builds an element with its properties, attributes, listeners and children", () => {
    const onClick = vi.fn<() => void>();
    const button = h(
      "button",
      { className: "primary", title: "Go", "aria-label": "Go now", role: "tab", onClick },
      "Go",
      h("span", {}, "!"),
      null,
      undefined,
      false,
      "",
    );
    expect(button.className).toBe("primary");
    expect(button.title).toBe("Go");
    expect(button.getAttribute("aria-label")).toBe("Go now");
    expect(button.getAttribute("role")).toBe("tab");
    expect(button.textContent).toBe("Go!");
    expect(button.childNodes).toHaveLength(3);
    button.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("sets an on* property that isn't a function as a property", () => {
    expect(h("div").childNodes).toHaveLength(0);
    expect(h("div", { onclick: null }).onclick).toBeNull();
  });
});

describe("icon", () => {
  it("draws one path, at the size asked, hidden from assistive technology", () => {
    const svg = icon("M0 0L16 16", 20);
    expect(svg.getAttribute("width")).toBe("20");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("path")?.getAttribute("d")).toBe("M0 0L16 16");
  });

  it("draws several shapes, at 16 pixels by default", () => {
    const svg = icon([
      ["circle", { cx: "8", cy: "8", r: "3" }],
      ["path", { d: "M1 1" }],
    ]);
    expect(svg.getAttribute("height")).toBe("16");
    expect(svg.querySelector("circle")?.getAttribute("r")).toBe("3");
    expect(svg.children).toHaveLength(2);
  });
});

describe("wheelScrollsSideways", () => {
  const row = (scrollWidth: number, clientWidth: number, scrollLeft = 0) => {
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollWidth", { value: scrollWidth });
    Object.defineProperty(element, "clientWidth", { value: clientWidth });
    element.scrollLeft = scrollLeft;
    let left = scrollLeft;
    Object.defineProperty(element, "scrollLeft", {
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    });
    wheelScrollsSideways(element);
    return element;
  };

  const wheel = (element: HTMLElement, { ctrlKey = false, ...init }: WheelEventInit) => {
    const event = new WheelEvent("wheel", { cancelable: true, ...init });
    // happy-dom leaves a wheel event's modifier keys out.
    Object.defineProperty(event, "ctrlKey", { value: ctrlKey });
    element.dispatchEvent(event);
    return event;
  };

  it("turns a vertical wheel into sideways scrolling, in pixels or lines, up to either end", () => {
    const element = row(300, 100);
    expect(wheel(element, { deltaY: 40 }).defaultPrevented).toBe(true);
    expect(element.scrollLeft).toBe(40);
    wheel(element, { deltaY: 5, deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(element.scrollLeft).toBe(120);
    wheel(element, { deltaY: 500 });
    expect(element.scrollLeft).toBe(200);
    wheel(element, { deltaY: -500 });
    expect(element.scrollLeft).toBe(0);
  });

  it("lets the page scroll at either end, when the row doesn't overflow, when zooming, and for sideways wheels", () => {
    const element = row(300, 100);
    expect(wheel(element, { deltaY: -40 }).defaultPrevented).toBe(false);
    expect(wheel(element, { deltaY: 40, ctrlKey: true }).defaultPrevented).toBe(false);
    expect(wheel(element, { deltaX: 40, deltaY: 10 }).defaultPrevented).toBe(false);
    expect(element.scrollLeft).toBe(0);
    expect(wheel(row(100, 100), { deltaY: 40 }).defaultPrevented).toBe(false);
  });

  it("stops when its signal aborts", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "scrollWidth", { value: 300 });
    const controller = new AbortController();
    wheelScrollsSideways(element, controller.signal);
    controller.abort();
    expect(wheel(element, { deltaY: 40 }).defaultPrevented).toBe(false);
  });
});

describe("cloneOf", () => {
  it("copies a node deeply, or only itself", () => {
    const list = h("ul", { className: "files" }, h("li", {}, "a.ts"));
    expect(cloneOf(list).outerHTML).toBe(list.outerHTML);
    const shallow = cloneOf(list, false);
    expect(shallow.className).toBe("files");
    expect(shallow.childNodes).toHaveLength(0);
  });
});
