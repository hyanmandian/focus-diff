// The first-run setup window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Setup } from "./Setup";
import { followLanguage } from "@/lib/language";
import "../index.css";

// In a plain browser during development, sample data stands in for the app (src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("../dev/mock")).installMock();
else if (import.meta.env.DEV) (await import("../dev/log")).forwardErrors();
// The language picked in Settings, followed live.
followLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Setup />
    </TooltipProvider>
  </StrictMode>,
);
