import { WorkerPoolContext } from "@pierre/diffs/react";
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
// oxlint-disable-next-line import/default -- Vite makes the default export of a `?worker` import, which the rule can't see
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";
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

const POOL = {
  workerFactory: () => new DiffsWorker(),
  poolSize: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1)),
};
const HIGHLIGHTER = {
  theme: { dark: "github-dark-default", light: "github-light-default" },
  lineDiffType: "word" as const,
};
const pool = getOrCreateWorkerPoolSingleton({ poolOptions: POOL, highlighterOptions: HIGHLIGHTER });

const root = createRoot(document.querySelector("#root")!);
const show = (target: Target) => {
  root.render(
    <StrictMode>
      <WorkerPoolContext.Provider value={pool}>
        <TooltipProvider>
          <Review key={target.id} target={target} />
          <Viewer />
        </TooltipProvider>
      </WorkerPoolContext.Provider>
    </StrictMode>,
  );
};

const params = new URLSearchParams(location.search);
void platform().listenToWindow<Target>("review-open", (payload) => {
  performance.mark("opened");
  const query = new URLSearchParams({
    id: payload.id,
    repo: payload.repo,
    number: String(payload.number),
    teams: payload.teams.join(","),
    queue: payload.queue ?? "",
  });
  history.replaceState(null, "", `?${query}`);
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
  try {
    await platform().invoke("spare_ready");
  } catch {}
}
