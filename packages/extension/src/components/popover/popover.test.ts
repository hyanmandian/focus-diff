// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { centreOver, returnFocus } from "./popover";

const rect = (left: number, width: number) => DOMRect.fromRect({ x: left, y: 0, width, height: 20 });

const at = (element: HTMLElement, left: number, width: number) => {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect(left, width));
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
};

describe("centreOver", () => {
  let popover: HTMLElement;
  let trigger: HTMLElement;
  let parent: HTMLElement;

  beforeEach(() => {
    popover = document.createElement("div");
    trigger = document.createElement("button");
    parent = document.createElement("div");
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1000 });
  });

  it("centres the popover over its button, the arrow pointing at the button", () => {
    at(parent, 100, 800);
    at(trigger, 480, 40);
    at(popover, 400, 200);
    centreOver(popover, trigger, parent);
    expect(popover.style.left).toBe("300px");
    expect(popover.style.right).toBe("auto");
    expect(popover.style.getPropertyValue("--fd-arrow-x")).toBe("100px");
  });

  it("keeps the popover inside its parent, the arrow clear of the corners", () => {
    at(parent, 100, 800);
    at(trigger, 100, 10);
    at(popover, 100, 200);
    centreOver(popover, trigger, parent);
    expect(popover.style.left).toBe("0px");
    expect(popover.style.getPropertyValue("--fd-arrow-x")).toBe("18px");
  });

  it("keeps a popover wider than its parent on screen", () => {
    at(parent, 0, 200);
    at(trigger, 990, 10);
    at(popover, 0, 300);
    centreOver(popover, trigger, parent);
    expect(popover.style.left).toBe("684px");
  });

  it("leaves a hidden popover, or one whose button isn't shown, where it is", () => {
    at(parent, 0, 800);
    at(trigger, 0, 0);
    at(popover, 0, 200);
    centreOver(popover, trigger, parent);
    expect(popover.style.left).toBe("");
    at(trigger, 0, 40);
    popover.hidden = true;
    centreOver(popover, trigger, parent);
    expect(popover.style.left).toBe("");
  });
});

describe("returnFocus", () => {
  const setUp = () => {
    const popover = document.createElement("div");
    const inside = document.createElement("button");
    const toggle = document.createElement("button");
    const fallback = document.createElement("button");
    popover.append(inside);
    document.body.append(popover, toggle, fallback);
    return { popover, inside, toggle, fallback };
  };

  it("sends focus inside the popover back to its toggle", () => {
    const { popover, inside, toggle, fallback } = setUp();
    returnFocus(popover, toggle, fallback, inside);
    expect(document.activeElement).toBe(toggle);
  });

  it("sends it to the fallback when the toggle is hidden", () => {
    const { popover, inside, toggle, fallback } = setUp();
    toggle.hidden = true;
    returnFocus(popover, toggle, fallback, inside);
    expect(document.activeElement).toBe(fallback);
  });

  it("leaves focus outside the popover alone", () => {
    const { popover, toggle, fallback } = setUp();
    returnFocus(popover, toggle, fallback, fallback);
    expect(document.activeElement).not.toBe(toggle);
  });
});
