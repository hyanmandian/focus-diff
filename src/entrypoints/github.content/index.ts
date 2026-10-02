import { createShadowRootUi, defineContentScript } from '#imports';
import { createPanel } from '@/components/panel/panel';
import { startController, type Controller } from './controller';

export default defineContentScript({
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    let controller: Controller | null = null;
    const ui = await createShadowRootUi(ctx, {
      name: 'focus-diff-panel',
      position: 'inline',
      anchor: 'html',
      append: 'last',
      inheritStyles: true,
      onMount: (container, root, host) =>
        createPanel(
          { root, container, host, signal: ctx.signal },
          {
            onToggle: (id) => controller?.toggle(id),
            onSettings: () => controller?.openSettings(),
            onComment: (step) => controller?.comment(step),
            onUpdateSeen: () => controller?.dismissUpdate(),
          },
        ),
    });
    ui.mount();
    if (ui.mounted) controller = await startController(ctx, ui.mounted);
  },
});
