// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { rowMenu } from "./row-menu";

const press = (target: Element, key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

const setUp = () => {
  const runs = { open: vi.fn<() => void>(), copy: vi.fn<() => void>(), ignore: vi.fn<() => void>() };
  const slot = rowMenu("More for “Fix the header”", [
    { label: "Open on GitHub", run: runs.open },
    { label: "Copy link", run: runs.copy },
    { label: "Ignore", run: runs.ignore },
  ]);
  document.body.replaceChildren(slot, document.createElement("p"));
  const button = slot.querySelector<HTMLButtonElement>(".row-menu")!;
  const menu = slot.querySelector<HTMLElement>("[role=menu]")!;
  const items = [...menu.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  return { runs, button, menu, items };
};

describe("rowMenu", () => {
  beforeEach(() => {
    vi.stubGlobal("innerHeight", 600);
    vi.stubGlobal("innerWidth", 380);
  });

  it("is a button that names the row, opening its menu under it", () => {
    const { button, menu, items } = setUp();
    expect(button.getAttribute("aria-label")).toBe("More for “Fix the header”");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-controls")).toBe(menu.id);
    expect(menu.hidden).toBe(true);
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 330, y: 100, width: 24, height: 24 }),
    );
    button.click();
    expect(menu.hidden).toBe(false);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items[0]);
    expect(menu.style.top).toBe("128px");
    expect(menu.style.right).toBe("26px");
    button.click();
    expect(menu.hidden).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens over the button near the window's bottom", () => {
    const { button, menu } = setUp();
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(
      DOMRect.fromRect({ x: 330, y: 560, width: 24, height: 24 }),
    );
    Object.defineProperty(menu, "offsetHeight", { configurable: true, value: 100 });
    button.click();
    expect(menu.style.top).toBe("456px");
  });

  it("moves between its actions with the keys, and runs one", () => {
    const { runs, button, menu, items } = setUp();
    expect(press(button, "ArrowUp").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(items[2]);
    press(menu, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    press(menu, "End");
    expect(document.activeElement).toBe(items[2]);
    press(menu, "Home");
    press(menu, "ArrowUp");
    expect(document.activeElement).toBe(items[2]);
    press(menu, "a");
    expect(document.activeElement).toBe(items[2]);
    items[1]!.click();
    expect(runs.copy).toHaveBeenCalledOnce();
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    expect(press(button, "Enter").defaultPrevented).toBe(false);
    press(button, "ArrowDown");
    expect(document.activeElement).toBe(items[0]);
  });

  it("says when it closes", () => {
    const onClose = vi.fn<() => void>();
    const slot = rowMenu("More", [{ label: "Copy link", run: () => {} }], onClose);
    document.body.replaceChildren(slot);
    const button = slot.querySelector<HTMLButtonElement>(".row-menu")!;
    button.click();
    expect(onClose).not.toHaveBeenCalled();
    button.click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape and Tab, back on its button, and on a click or scroll elsewhere", () => {
    const { button, menu, items } = setUp();
    button.click();
    expect(press(menu, "Escape").defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);
    button.click();
    expect(press(menu, "Tab").defaultPrevented).toBe(false);
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(button);

    button.click();
    items[0]!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.dispatchEvent(new Event("scroll"));
    expect(menu.hidden).toBe(false);
    document.querySelector("p")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).not.toBe(button);

    button.click();
    vi.spyOn(button, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ y: 40 }));
    document.dispatchEvent(new Event("scroll"));
    expect(menu.hidden).toBe(true);
    document.dispatchEvent(new Event("scroll"));
    document.dispatchEvent(new Event("pointerdown"));
    expect(menu.hidden).toBe(true);
  });
});
