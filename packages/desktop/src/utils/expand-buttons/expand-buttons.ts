import type { T } from "@/utils/i18n/i18n";

const NAMES = [
  ["data-expand-up", "diff.expandUp"],
  ["data-expand-down", "diff.expandDown"],
] as const;

export function labelExpandButtons(node: HTMLElement, t: T) {
  const root = node.shadowRoot ?? node;
  for (const el of root.querySelectorAll<HTMLElement>("[data-expand-button]:not([tabindex])")) {
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
