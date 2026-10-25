// A pull request's review window. Made ahead of time as a spare (no pull request in its address),
// it waits to be told which one to show (lib.rs open_review); opened directly, it reads its address.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Viewer } from "@/shared/Viewer";
import { Review, type Target } from "./Review";
import "../index.css";

// In a plain browser during development, sample data stands in for the app (src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("../dev/mock")).installMock();
else if (import.meta.env.DEV) (await import("../dev/log")).forwardErrors();

const root = createRoot(document.getElementById("root")!);
const show = (target: Target) =>
  root.render(
    <StrictMode>
      <TooltipProvider delay={400}>
        <Review target={target} />
        <Viewer />
      </TooltipProvider>
    </StrictMode>,
  );

const params = new URLSearchParams(location.search);
if (params.get("id")) {
  show({ id: params.get("id")!, repo: params.get("repo") ?? "", number: Number(params.get("number")), teams: (params.get("teams") ?? "").split(",").filter(Boolean) });
} else {
  const stop = await listen<Target>("review-open", ({ payload }) => {
    stop();
    // From here to "loaded" is how long a click takes to show the pull request.
    performance.mark("opened");
    // In the address too, so reloading the window keeps the pull request.
    const query = new URLSearchParams({ id: payload.id, repo: payload.repo, number: String(payload.number), teams: payload.teams.join(",") });
    history.replaceState(null, "", `?${query}`);
    show(payload);
  });
  // Only now can it be told: until this, a click opens a fresh window instead.
  void invoke("spare_ready").catch(() => {});
}
