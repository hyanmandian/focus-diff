// The panel under the tray icon.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Panel } from "@/components/panel/panel";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { followLanguage } from "@/utils/language/language";
import { setPlatform } from "@/utils/platform/platform";
import { start } from "@/utils/store/store";
import { tauriPlatform } from "@/utils/tauri-platform/tauri-platform";

import "@/index.css";

document.documentElement.classList.add("panel");
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
    <TooltipProvider>
      <Panel />
    </TooltipProvider>
  </StrictMode>,
);
void start();
