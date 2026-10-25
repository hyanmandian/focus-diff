// The first-run setup window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Setup } from "./Setup";
import "../index.css";

// In a plain browser during development, sample data stands in for the app (src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("../dev/mock")).installMock();
else if (import.meta.env.DEV) (await import("../dev/log")).forwardErrors();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delay={400}>
      <Setup />
    </TooltipProvider>
  </StrictMode>,
);
