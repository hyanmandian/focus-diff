import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Panel } from "@/components/panel/panel";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { boot } from "@/entries/boot";
import { start } from "@/utils/store/store";

import "@/index.css";

document.documentElement.classList.add("panel");
await boot();

createRoot(document.querySelector("#root")!).render(
  <StrictMode>
    <TooltipProvider>
      <Panel />
    </TooltipProvider>
  </StrictMode>,
);
void start();
