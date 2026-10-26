// A pull request's review, in a tab: the desktop's review window.
import { getOrCreateWorkerPoolSingleton } from "@pierre/diffs/worker";
// oxlint-disable-next-line import/default -- Vite makes the default export of a `?worker` import, which the rule can't see
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";

import { startReview } from "@/components/review-page/review-page";
import { startPage } from "@/utils/start-page/start-page";

import "@/assets/pages.css";

// Syntax colouring off the main thread, as the desktop's review window does it.
const pool = getOrCreateWorkerPoolSingleton({
  poolOptions: {
    workerFactory: () => new DiffsWorker(),
    poolSize: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) >> 1)),
  },
  highlighterOptions: {
    theme: { dark: "github-dark-default", light: "github-light-default" },
    lineDiffType: "word",
  },
});

startReview(startPage(`review-${crypto.randomUUID()}`), pool);
