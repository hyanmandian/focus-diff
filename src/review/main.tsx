// A pull request's review window.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Review } from "./Review";
import "../index.css";

// In a plain browser during development, sample data stands in for the app (src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("../dev/mock")).installMock();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delay={400}>
      <Review />
    </TooltipProvider>
  </StrictMode>,
);
