import { TooltipProvider } from "@focus-diff/design-system/components/tooltip";
// The settings window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Settings } from "@/components/settings/settings";
import { followLanguage } from "@/utils/language/language";
import { setPlatform } from "@/utils/platform/platform";
import { tauriPlatform } from "@/utils/tauri-platform/tauri-platform";

import "@/index.css";
import "@/components/settings/settings.css";

document.documentElement.classList.add("settings");

// The app the screens run in: Tauri, or in a plain browser during development, sample data
// (src/utils/mock/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window))
  setPlatform((await import("@/utils/mock/mock")).mockPlatform);
else {
  setPlatform(tauriPlatform);
  if (import.meta.env.DEV) (await import("@/utils/dev-log/dev-log")).forwardErrors();
}
// The language picked in Settings, followed live.
followLanguage();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    {/* AppKit's tooltip delay, about a second: the provider's default. */}
    <TooltipProvider>
      <Settings />
    </TooltipProvider>
  </StrictMode>,
);
