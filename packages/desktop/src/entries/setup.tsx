// The first-run setup window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Setup } from "@/components/setup/setup";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { boot } from "@/entries/boot";

import "@/index.css";

await boot();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Setup />
    </TooltipProvider>
  </StrictMode>,
);
