// Light or dark: the system's, unless the person picked one. Applied as shadcn's `dark` class.
// The pick is remembered here too and applied as soon as this loads, before the settings arrive,
// so a dark page doesn't open light and then flash over.
import { useEffect } from "react";
import type { Config } from "./config";

const KEY = "theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

function apply(theme: Config["theme"] | undefined) {
  const dark =
    theme === "dark" || ((theme ?? "system") === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function remembered(): Config["theme"] | undefined {
  try {
    return (localStorage.getItem(KEY) as Config["theme"] | null) ?? undefined;
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
    const update = () => apply(current);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);
}
