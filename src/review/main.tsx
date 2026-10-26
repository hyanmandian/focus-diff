// A pull request's review window. Made ahead of time as a spare (no pull request in its address),
// it waits to be told which one to show (lib.rs open_review); opened directly, it reads its address.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Viewer } from "@/shared/Viewer";
import { Review, type Target } from "./Review";
import { followLanguage } from "@/lib/language";
import "../index.css";

// In a plain browser during development, sample data stands in for the app (src/dev/mock.ts).
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) (await import("../dev/mock")).installMock();
else if (import.meta.env.DEV) (await import("../dev/log")).forwardErrors();
// The language picked in Settings, followed live.
followLanguage();

// Syntax colouring off the main thread, so scrolling never waits on it. Started with the page (a
// spare window warms them up before it's needed); the themes are the ones Diffs.tsx shows.
const POOL = { workerFactory: () => new DiffsWorker(), poolSize: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1)) };
const HIGHLIGHTER = { theme: { dark: "github-dark-default", light: "github-light-default" }, lineDiffType: "word" as const };
// Lives as long as the window. Handed down directly rather than through WorkerPoolContextProvider,
// which ends the pool when it unmounts, as StrictMode's rehearsal unmount does in development.
const pool = getOrCreateWorkerPoolSingleton({ poolOptions: POOL, highlighterOptions: HIGHLIGHTER });

const root = createRoot(document.getElementById("root")!);
const show = (target: Target) =>
  root.render(
    <StrictMode>
      <WorkerPoolContext.Provider value={pool}>
        <TooltipProvider>
          {/* A pull request of its own: moving on to the next one starts afresh. */}
          <Review key={target.id} target={target} />
          <Viewer />
        </TooltipProvider>
      </WorkerPoolContext.Provider>
    </StrictMode>,
  );

const params = new URLSearchParams(location.search);
// Told which pull request to show: as a spare, the first; then the next of its queue (switch_review).
void listen<Target>("review-open", ({ payload }) => {
  // From here to "loaded" is how long a click takes to show the pull request.
  performance.mark("opened");
  // In the address too, so reloading the window keeps the pull request.
  const query = new URLSearchParams({ id: payload.id, repo: payload.repo, number: String(payload.number), teams: payload.teams.join(","), queue: payload.queue ?? "" });
  history.replaceState(null, "", `?${query}`);
  show(payload);
});
if (params.get("id")) {
  show({
    id: params.get("id")!,
    repo: params.get("repo") ?? "",
    number: Number(params.get("number")),
    teams: (params.get("teams") ?? "").split(",").filter(Boolean),
    queue: params.get("queue") || null,
  });
} else {
  // Only now can it be told: until this, a click opens a fresh window instead.
  void invoke("spare_ready").catch(() => {});
}
