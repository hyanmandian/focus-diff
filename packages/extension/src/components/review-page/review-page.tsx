// A pull request's review in a tab of its own: the desktop's review window (packages/desktop/src/entries/review.tsx).
// Its address says which pull request it shows; moving on to the next of its queue (switch_review), the background
// tells it which one instead, and the tab shows that one in place.

import { Review, type Target } from "@focus-diff/app/components/review";
import { Viewer } from "@focus-diff/app/components/viewer";
import { DIRECTION } from "@focus-diff/app/hooks/use-next-in-queue";
import { platform } from "@focus-diff/app/utils/platform";
import { WorkerPoolContext } from "@pierre/diffs/react";
import type { ComponentProps } from "react";
import { flushSync } from "react-dom";
import type { Root } from "react-dom/client";

import { render } from "@/utils/start-page/start-page";

type Pool = ComponentProps<typeof WorkerPoolContext.Provider>["value"];

/** Which pull request to show, with the tab's title ("#12 · Fix login · Ana"), as the background sends it. */
export type Shown = Target & { title?: string };

/** The pull request in the page's address, or null when it names none. */
export const targetOf = (search: string): Shown | null => {
  const params = new URLSearchParams(search);
  const id = params.get("id");
  if (!id) return null;
  return {
    id,
    repo: params.get("repo") ?? "",
    number: Number(params.get("number")),
    teams: (params.get("teams") ?? "").split(",").filter(Boolean),
    queue: params.get("queue") || null,
    title: params.get("title") ?? "",
  };
};

/** The page's address for a pull request, so reloading the tab keeps it. */
export const searchOf = (target: Shown): string =>
  `?${new URLSearchParams({
    id: target.id,
    repo: target.repo,
    number: String(target.number),
    teams: target.teams.join(","),
    queue: target.queue ?? "",
    title: target.title ?? "",
  })}`;

/** Shows the pull request in the address, and the ones the background sends after it. `pool`: syntax colouring's
 *  workers, for the page's life. */
export const startReview = (root: Root, pool: Pool) => {
  const show = (target: Shown) => {
    if (target.title) document.title = target.title;
    render(
      root,
      <WorkerPoolContext.Provider value={pool}>
        {/* A pull request of its own: moving on to the next one starts afresh. */}
        <Review key={target.id} target={target} />
        <Viewer />
      </WorkerPoolContext.Provider>,
    );
  };

  void platform().listenToWindow<Shown>("review-open", (target) => {
    history.replaceState(null, "", searchOf(target));
    // Moving through a queue slides the page the way it went, as on the desktop; a first showing, or with Reduce
    // Motion, just shows.
    const direction = sessionStorage.getItem(DIRECTION);
    sessionStorage.removeItem(DIRECTION);
    if (!direction || matchMedia("(prefers-reduced-motion: reduce)").matches || !("startViewTransition" in document)) {
      show(target);
      return;
    }
    document.documentElement.dataset.direction = direction;
    const moving = document.startViewTransition(() => {
      flushSync(() => {
        show(target);
      });
    });
    void moving.finished.finally(() => {
      delete document.documentElement.dataset.direction;
    });
  });

  const target = targetOf(location.search);
  if (target) show(target);
};
