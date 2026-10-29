import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Settings } from "@/components/settings/settings";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { boot } from "@/entries/boot";

import "@/index.css";
import "@/components/settings/settings.css";

document.documentElement.classList.add("settings");

await boot();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Settings />
    </TooltipProvider>
  </StrictMode>,
);
