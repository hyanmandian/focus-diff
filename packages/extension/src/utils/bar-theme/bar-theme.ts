// Light or dark, for the bar: the one picked in the app's Settings, or with "system", the one GitHub's page shows
// (its data-color-mode, which follows the system itself when it's "auto"), so the bar matches what it sits on.

import type { Config } from "@focus-diff/desktop/utils/config";

const media = () => matchMedia("(prefers-color-scheme: dark)");

export const isDark = (theme: Config["theme"]): boolean => {
  if (theme !== "system") return theme === "dark";
  const mode = document.documentElement.dataset.colorMode;
  return mode === "dark" || (mode !== "light" && media().matches);
};

/** Calls `changed` whenever GitHub's appearance or the system's changes; returns how to stop. */
export const watchAppearance = (changed: () => void): (() => void) => {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributeFilter: ["data-color-mode"] });
  const scheme = media();
  scheme.addEventListener("change", changed);
  return () => {
    observer.disconnect();
    scheme.removeEventListener("change", changed);
  };
};
