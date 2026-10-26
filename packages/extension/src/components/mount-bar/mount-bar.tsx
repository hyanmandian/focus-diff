import { createShadowRootUi, type ContentScriptContext } from "#imports";
import { createBarView } from "@/components/bar/bar";
import type { Provider } from "@/utils/provider/provider";
import { startController } from "@/utils/review-controller/review-controller";
import { keepOutOfTransitions } from "@/utils/transition/transition";

import "@/components/bar/bar.css";

/** Puts the bar on a review site's pages and starts filtering them; every provider's content script runs this. */
export const mountBar = async (ctx: ContentScriptContext, provider: Provider): Promise<void> => {
  const ui = await createShadowRootUi(ctx, {
    name: "focus-diff-bar",
    position: "inline",
    anchor: "html",
    append: "last",
    onMount: (container, _root, host) => {
      keepOutOfTransitions(host);
      return createBarView(container, host);
    },
  });
  ui.mount();
  if (ui.mounted) await startController(ctx, ui.mounted, provider);
};
