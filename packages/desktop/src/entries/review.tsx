import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
// oxlint-disable-next-line import/default -- Vite makes the default export of a `?worker` import, which the rule can't see
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
// A pull request's review window. Made ahead of time as a spare (no pull request in its address),
// it waits to be told which one to show (lib.rs open_review); opened directly, it reads its address.
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import { Review, type Target } from "@/components/review/review";
import { TooltipProvider } from "@/components/tooltip/tooltip";
import { Viewer } from "@/components/viewer/viewer";
import { boot } from "@/entries/boot";
import { DIRECTION } from "@/hooks/use-next-in-queue/use-next-in-queue";
import { platform } from "@/utils/platform/platform";

import "@/index.css";

await boot();

// Syntax colouring off the main thread, so scrolling never waits on it. Started with the page (a
// spare window warms them up before it's needed); the themes are the ones diffs.tsx shows.
const POOL = {
  workerFactory: () => new DiffsWorker(),
  poolSize: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1)),
};
const HIGHLIGHTER = {
  theme: { dark: "github-dark-default", light: "github-light-default" },
  lineDiffType: "word" as const,
};
// Lives as long as the window. Handed down directly rather than through WorkerPoolContextProvider,
// which ends the pool when it unmounts, as StrictMode's rehearsal unmount does in development.
const pool = getOrCreateWorkerPoolSingleton({ poolOptions: POOL, highlighterOptions: HIGHLIGHTER });

const root = createRoot(document.querySelector("#root")!);
const show = (target: Target) => {
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
};

const params = new URLSearchParams(location.search);
// Told which pull request to show: as a spare, the first; then the next of its queue (switch_review).
// This window's own events only.
void platform().listenToWindow<Target>("review-open", (payload) => {
  // From here to "loaded" is how long a click takes to show the pull request.
  performance.mark("opened");
  // In the address too, so reloading the window keeps the pull request.
  const query = new URLSearchParams({
    id: payload.id,
    repo: payload.repo,
    number: String(payload.number),
    teams: payload.teams.join(","),
    queue: payload.queue ?? "",
  });
  history.replaceState(null, "", `?${query}`);
  // Moving through a queue slides the page the way it went: on to the next from the right, back
  // from the left (index.css); a first showing, or with Reduce Motion, just shows.
  const direction = sessionStorage.getItem(DIRECTION);
  sessionStorage.removeItem(DIRECTION);
  if (!direction || matchMedia("(prefers-reduced-motion: reduce)").matches || !("startViewTransition" in document)) {
    show(payload);
    return;
  }
  document.documentElement.dataset.direction = direction;
  const moving = document.startViewTransition(() => {
    flushSync(() => {
      show(payload);
    });
  });
  void moving.finished.finally(() => {
    delete document.documentElement.dataset.direction;
  });
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
  try {
    await platform().invoke("spare_ready");
  } catch {
    // Nothing more to do: until it hears, a click just opens a fresh window.
  }
}
