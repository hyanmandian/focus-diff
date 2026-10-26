// The bar on github.com: the app's own filter bar (packages/app's FilterBar), floating at the bottom of the screen
// over GitHub's page, in its shadow root (components/mount-bar). Its tooltips and its breakdown are drawn in that
// container too, where its styles are.

import { FilterBar } from "@focus-diff/app/components/filter-bar";
import { TooltipProvider } from "@focus-diff/design-system/components/tooltip";
import { PortalContainer } from "@focus-diff/design-system/utils/portal-container";
import { createRoot } from "react-dom/client";

import type { BarProps, BarView } from "@/utils/review-controller/review-controller";

export function Bar({ props, container }: { props: BarProps; container: HTMLElement }) {
  return (
    <PortalContainer value={container}>
      <TooltipProvider>
        {/* The filter bar places itself at the bottom of what holds it: here, the screen. */}
        <div className="fixed inset-x-0 bottom-0 z-2147483000 h-0">
          <FilterBar {...props} />
        </div>
      </TooltipProvider>
    </PortalContainer>
  );
}

/** Draws the bar in `container`, inside the shadow root of `host`. */
export const createBarView = (container: HTMLElement, host: HTMLElement): BarView => {
  container.setAttribute("data-focus-diff-bar", "");
  // The Mac's look, and its live system colours where the browser has them (Safari).
  host.dataset.platform = "macos";
  const mount = document.createElement("div");
  container.append(mount);
  const root = createRoot(mount);
  return {
    render: (props) => {
      root.render(props ? <Bar props={props} container={container} /> : null);
    },
    setDark: (dark) => {
      container.classList.toggle("dark", dark);
      host.style.colorScheme = dark ? "dark" : "light";
    },
    setLocale: (locale) => {
      host.lang = locale;
    },
  };
};
