import { TooltipProvider } from "@focus-diff/design-system/components/tooltip";
// The panel under the tray icon.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Panel } from "@/components/panel/panel";
import { followLanguage } from "@/utils/language/language";
import { start } from "@/utils/store/store";

import "@/index.css";

document.documentElement.classList.add("panel");
// In a plain browser during development, sample data stands in for the app (src/utils/mock/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("@/utils/mock/mock")).installMock();
else if (import.meta.env.DEV) (await import("@/utils/dev-log/dev-log")).forwardErrors();
// The language picked in Settings, followed live.
followLanguage();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Panel />
    </TooltipProvider>
  </StrictMode>,
);
void start();
