// The first-run setup window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { Setup } from "@/components/setup/setup";
import { followLanguage } from "@/utils/language/language";
import "@/index.css";

// In a plain browser during development, sample data stands in for the app (src/utils/mock/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("@/utils/mock/mock")).installMock();
else if (import.meta.env.DEV) (await import("@/utils/dev-log/dev-log")).forwardErrors();
// The language picked in Settings, followed live.
followLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Setup />
    </TooltipProvider>
  </StrictMode>,
);
