import { createShadowRootUi, type ContentScriptContext } from '#imports';
import { createPanel } from '@/components/panel/panel';
import { startController, type Controller } from '@/content/controller';
import { keepOutOfTransitions } from '@/content/transition';
import type { Provider } from '@/providers/provider';
import { uiLanguage } from '@/utils/i18n';

// The bar's styles, every component's, which the content script injects into the bar's shadow root. They're imported
// here rather than by each component, so the extension's pages, which show the bar only in the demo (with its own copies
// in its shadow roots), don't load them as page styles.
import.meta.glob(['../components/**/*.css', '!../components/demo/**', '!../components/toast/**', '!../components/button.css'], {
  eager: true,
});

/** Puts the bar on a review site's pages and starts filtering them; every provider's content script runs this. */
export const mountBar = async (ctx: ContentScriptContext, provider: Provider): Promise<void> => {
  let controller: Controller | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: 'focus-diff-panel',
    position: 'inline',
    anchor: 'html',
    append: 'last',
    inheritStyles: true,
    onMount: (container, root, host) => {
      keepOutOfTransitions(host);
      // Read out in the extension's language, not the page's.
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
