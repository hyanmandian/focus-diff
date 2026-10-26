// The settings window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Settings } from "@/components/settings/settings";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { followLanguage } from "@/utils/language/language";

import "@/index.css";
import "@/components/settings/settings.css";

document.documentElement.classList.add("settings");

// In a plain browser during development, sample data stands in for the app (src/utils/mock/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("@/utils/mock/mock")).installMock();
else if (import.meta.env.DEV) (await import("@/utils/dev-log/dev-log")).forwardErrors();
// The language picked in Settings, followed live.
followLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* AppKit's tooltip delay, about a second: the provider's default. */}
    <TooltipProvider>
      <Settings />
    </TooltipProvider>
  </StrictMode>,
);
