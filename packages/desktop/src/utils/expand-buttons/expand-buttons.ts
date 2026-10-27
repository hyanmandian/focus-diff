// The diff's "show more lines" controls, as @pierre/diffs draws them: a div with role="button" and
// only an icon, which a screen reader can't name and the keyboard can't reach. Each is given a name,
// a place in the tab order and Return and Space, as a button has.

import type { T } from "@/utils/i18n/i18n";

const NAMES = [
  ["data-expand-up", "diff.expandUp"],
  ["data-expand-down", "diff.expandDown"],
] as const;

/** Makes the expand controls in a rendered file (`node`, or its shadow root) work as buttons. */
export function labelExpandButtons(node: HTMLElement, t: T) {
  const root = node.shadowRoot ?? node;
  for (const el of root.querySelectorAll<HTMLElement>("[data-expand-button]:not([tabindex])")) {
    // "Expand all" says so in its text.
    if (!el.hasAttribute("data-expand-all-button")) {
      const name = NAMES.find(([attribute]) => el.hasAttribute(attribute))?.[1] ?? "diff.expandBoth";
      el.setAttribute("aria-label", t(name));
    }
    el.tabIndex = 0;
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      el.click();
    });
  }
}
