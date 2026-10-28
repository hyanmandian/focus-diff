import { createShadowRootUi, type ContentScriptContext } from "#imports";
import { createPanel } from "@/components/panel/panel";
import { uiLanguage } from "@/utils/i18n/i18n";
import type { Provider } from "@/utils/provider/provider";
import { startController, type Controller } from "@/utils/review-controller/review-controller";
import { keepOutOfTransitions } from "@/utils/transition/transition";

import.meta.glob(["../**/*.css", "!../demo/**", "!../toast/**", "!../button/**", "!../github-theme/**"], {
  eager: true,
});

export const mountBar = async (ctx: ContentScriptContext, provider: Provider): Promise<void> => {
  let controller: Controller | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: "focus-diff-panel",
    position: "inline",
    anchor: "html",
    append: "last",
    inheritStyles: true,
    onMount: (container, root, host) => {
      keepOutOfTransitions(host);
      host.lang = uiLanguage();
      return createPanel(
        { root, container, host, signal: ctx.signal },
        {
          onToggle: (id) => controller?.toggle(id),
          onSettings: () => controller?.openSettings(),
          onComment: (step) => controller?.comment(step),
          onNextFile: () => controller?.nextUnviewed(),
          onUpdateSeen: () => controller?.dismissUpdate(),
        },
      );
    },
  });
  ui.mount();
  if (ui.mounted) controller = await startController(ctx, ui.mounted, provider);
};
