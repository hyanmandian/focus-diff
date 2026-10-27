import { describe, expect, it, vi } from "vite-plus/test";

import { labelExpandButtons } from "@/utils/expand-buttons/expand-buttons";
import { i18n } from "@/utils/i18n/i18n";

/** A rendered file's separators, as @pierre/diffs draws them, in a shadow root or not. */
function file(shadow: boolean) {
  const host = document.createElement("div");
  const root = shadow ? host.attachShadow({ mode: "open" }) : host;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div role="button" data-expand-button data-expand-up></div>
    <div role="button" data-expand-button data-expand-down></div>
    <div role="button" data-expand-button data-expand-both></div>
    <div role="button" data-expand-button data-expand-all-button>Expand all</div>`;
  root.append(wrapper);
  return { host, buttons: [...root.querySelectorAll<HTMLElement>("[data-expand-button]")] };
}

describe("labelExpandButtons", () => {
  it("names each control and puts it in the tab order, in a shadow root or not", () => {
    for (const shadow of [true, false]) {
      const { host, buttons } = file(shadow);
      labelExpandButtons(host, i18n());
      expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
        "Show lines above",
        "Show lines below",
        "Show hidden lines",
        null,
      ]);
      expect(buttons.every((b) => b.tabIndex === 0)).toBe(true);
    }
  });

  it("presses it with Return and Space, once however many times it's rendered", () => {
    const { host, buttons } = file(true);
    labelExpandButtons(host, i18n());
    labelExpandButtons(host, i18n());
    const [up] = buttons;
    const click = vi.fn<() => void>();
    up?.addEventListener("click", click);
    for (const key of ["Enter", " ", "a"]) up?.dispatchEvent(new KeyboardEvent("keydown", { key, cancelable: true }));
    expect(click).toHaveBeenCalledTimes(2);
  });
});
