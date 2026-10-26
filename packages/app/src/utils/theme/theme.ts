// Light or dark: the system's, unless the person picked one. The app sets the pick on every window
// natively (menu.rs apply_theme), so the web view's appearance, its system colours, scroll bars and
// the panel's material agree, and prefers-color-scheme follows it; here it's mirrored as shadcn's
// `dark` class. The pick is remembered here too and applied as soon as this loads, before the
// settings arrive, so a dark page doesn't open light and then flash over.
import { useEffect } from "react";

// Every page sets its theme through here, so the platform (<html data-platform>) is set with it.
// oxlint-disable-next-line import/no-unassigned-import -- loaded for that, nothing to name
import "../os/os";
import type { Config } from "../config/config";

const KEY = "theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply(theme: Config["theme"] | undefined) {
  const dark = theme === "dark" || ((theme ?? "system") === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function remembered(): Config["theme"] | undefined {
  try {
    const value = localStorage.getItem(KEY);
    return value === "system" || value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

apply(remembered());

export function useTheme(theme: Config["theme"] | undefined) {
  useEffect(() => {
    // Until the settings arrive, the one from last time.
    const current = theme ?? remembered();
    if (theme)
      try {
        localStorage.setItem(KEY, theme);
      } catch {
        // Picked up from the settings next time.
      }
    const update = () => {
      apply(current);
    };
    update();
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
    };
  }, [theme]);
}
