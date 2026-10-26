// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTooltip } from "./tooltip";

const mount = () => {
  const within = document.createElement("div");
  const control = document.createElement("button");
  control.dataset.tip = "Settings";
  control.append(document.createElement("span"));
  const info = document.createElement("span");
  info.dataset.tip = "What this means";
  info.dataset.tipInstant = "";
  const plain = document.createElement("span");
  within.append(control, info, plain);
  document.body.append(within);
  const tooltip = createTooltip({ signal: new AbortController().signal }, within);
  const tip = within.querySelector<HTMLElement>(".tip")!;
  return { within, control, info, plain, tip, tooltip };
};

const over = (target: EventTarget) => target.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
const out = (target: EventTarget, relatedTarget: EventTarget | null = null) =>
  target.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget }));

describe("createTooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1000 });
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("shows a control's tip above it after a moment's hover", () => {
    const { control, tip, tooltip } = mount();
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 480, y: 100, width: 40, height: 20 }),
    );
    vi.spyOn(tip, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width: 100, height: 30 }));
    over(control);
    expect(tooltip.isVisible()).toBe(false);
    vi.advanceTimersByTime(350);
    expect(tooltip.isVisible()).toBe(true);
    expect(tip.textContent).toBe("Settings");
    expect(tip.style.left).toBe("450px");
    expect(tip.style.top).toBe("60px");
    expect(tip.style.getPropertyValue("--fd-tip-arrow-x")).toBe("50px");
  });

  it("keeps the tip on screen, its arrow on the control", () => {
    const { control, tip } = mount();
    vi.spyOn(control, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 0, y: 100, width: 10, height: 20 }),
    );
    vi.spyOn(tip, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ width: 100, height: 30 }));
    over(control);
    vi.advanceTimersByTime(350);
    expect(tip.style.left).toBe("8px");
    expect(tip.style.getPropertyValue("--fd-tip-arrow-x")).toBe("14px");
  });

  it("shows an (i)'s tip at once", () => {
    const { info, tooltip } = mount();
    over(info);
    expect(tooltip.isVisible()).toBe(true);
  });

  it("stays put moving within the control, and hides over nothing with a tip", () => {
    const { control, plain, tooltip } = mount();
    over(control);
    vi.advanceTimersByTime(350);
    over(control.firstChild!);
    expect(tooltip.isVisible()).toBe(true);
    over(plain);
    expect(tooltip.isVisible()).toBe(false);
  });

  it("lingers for the pointer to move onto it, and stays while it's there", () => {
    const { control, tip, tooltip } = mount();
    over(control);
    vi.advanceTimersByTime(350);
    out(control, control.firstChild);
    out(control, tip);
    vi.advanceTimersByTime(500);
    expect(tooltip.isVisible()).toBe(true);
    over(tip);
    expect(tooltip.isVisible()).toBe(true);
    out(control, null);
    vi.advanceTimersByTime(119);
    expect(tooltip.isVisible()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tooltip.isVisible()).toBe(false);
  });

  it("ignores leaving with nothing shown, and cancels a tip about to show", () => {
    const { control, plain, tooltip } = mount();
    out(plain, null);
    over(control);
    out(control, plain);
    vi.advanceTimersByTime(1000);
    expect(tooltip.isVisible()).toBe(false);
  });

  it("shows on keyboard focus, not on a click's focus, and hides on blur", () => {
    const { control, info, tooltip } = mount();
    vi.spyOn(control, "matches").mockReturnValue(true);
    control.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(tooltip.isVisible()).toBe(true);
    control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(tooltip.isVisible()).toBe(false);
    vi.spyOn(info, "matches").mockReturnValue(false);
    info.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(tooltip.isVisible()).toBe(false);
  });

  it("hides on a press, except on the tip or an (i)", () => {
    const { control, info, tip, tooltip } = mount();
    over(info);
    info.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    tip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(tooltip.isVisible()).toBe(true);
    control.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(tooltip.isVisible()).toBe(false);
  });

  it("toggles an (i)'s tip on click, and ignores clicks on anything else", () => {
    const { control, info, tooltip } = mount();
    info.click();
    expect(tooltip.isVisible()).toBe(true);
    control.click();
    expect(tooltip.isVisible()).toBe(true);
    info.click();
    expect(tooltip.isVisible()).toBe(false);
    document.body.dispatchEvent(new MouseEvent("click"));
    info.click();
    expect(tooltip.isVisible()).toBe(true);
  });

  it("follows its control's text, and shows nothing for a control without text or gone", () => {
    const { control, info, tip, tooltip } = mount();
    tooltip.refresh();
    expect(tooltip.isVisible()).toBe(false);
    over(info);
    info.dataset.tip = "Changed";
    tooltip.refresh();
    expect(tip.textContent).toBe("Changed");
    tooltip.hide();
    info.dataset.tip = "";
    over(info);
    expect(tooltip.isVisible()).toBe(false);
    over(control);
    control.remove();
    vi.advanceTimersByTime(350);
    expect(tooltip.isVisible()).toBe(false);
  });

  it("hides over text outside any control", () => {
    const { within, info, tooltip } = mount();
    over(info);
    const text = document.createTextNode("words");
    within.append(text);
    over(text);
    expect(tooltip.isVisible()).toBe(false);
  });
});
