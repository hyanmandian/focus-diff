import '@/components/panel/panel.css';
import { createShadowRootUi, defineContentScript } from '#imports';
import { createPanel } from '@/components/panel';
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
            onSelect: (id) => controller?.select(id),
            onToggle: (id) => controller?.toggle(id),
            onSettings: () => controller?.openSettings(),
            onNextUnviewed: () => controller?.nextUnviewed(),
            onComment: (step) => controller?.comment(step),
          },
        ),
    });
    ui.mount();
    if (ui.mounted) controller = await startController(ctx, ui.mounted);
  },
});
