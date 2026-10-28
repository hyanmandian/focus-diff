import { useEffect } from "react";

// oxlint-disable-next-line import/no-unassigned-import -- loaded for that, nothing to name
import "@/utils/os/os";
import type { Config } from "@/utils/config/config";

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
    const current = theme ?? remembered();
    if (theme)
      try {
        localStorage.setItem(KEY, theme);
      } catch {}
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
