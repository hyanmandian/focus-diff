import { Panel } from "@focus-diff/app/components/panel";
import { followLanguage } from "@focus-diff/app/utils/language";
import { setPlatform } from "@focus-diff/app/utils/platform";
import { start } from "@focus-diff/app/utils/store";
import { TooltipProvider } from "@focus-diff/design-system/components/tooltip";
// The panel under the tray icon.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { tauriPlatform } from "@/utils/tauri-platform/tauri-platform";

import "@/index.css";

document.documentElement.classList.add("panel");
// The app the screens run in: Tauri, or in a plain browser during development, sample data
// (src/utils/mock/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window))
  setPlatform((await import("@focus-diff/app/utils/mock")).mockPlatform);
else {
  setPlatform(tauriPlatform);
  if (import.meta.env.DEV) (await import("@/utils/dev-log/dev-log")).forwardErrors();
}
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
