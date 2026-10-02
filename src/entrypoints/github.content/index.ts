import '@/components/panel/panel.css';
import '@/components/panel/guide.css';
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
            guide: {
              start: () => controller?.guide.start(),
              confirm: (options) => controller?.guide.confirm(options),
              retry: () => controller?.guide.retry(),
              regenerate: () => controller?.guide.regenerate(),
              exit: () => controller?.guide.exit(),
              settings: () => controller?.guide.settings(),
              chapter: (index) => controller?.guide.chapter(index),
              reviewed: (index, reviewed) => controller?.guide.reviewed(index, reviewed),
              reveal: (path, anchor) => controller?.guide.reveal(path, anchor),
            },
          },
        ),
    });
    ui.mount();
    if (ui.mounted) controller = await startController(ctx, ui.mounted);
  },
});
