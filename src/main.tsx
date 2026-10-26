// The panel under the tray icon.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { start } from "@/lib/store";
import { Panel } from "@/panel/Panel";
import { followLanguage } from "@/lib/language";
import "./index.css";

document.documentElement.classList.add("panel");
// In a plain browser during development, sample data stands in for the app (src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("./dev/mock")).installMock();
else if (import.meta.env.DEV) (await import("./dev/log")).forwardErrors();
// The language picked in Settings, followed live.
followLanguage();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Panel />
    </TooltipProvider>
  </StrictMode>,
);
void start();
