import path from 'node:path';
import { defineConfig } from 'vite';

/**
 * The welcome page's demo as one script for the site: no extension APIs, the messages read from the locales. Mount it
 * with `<div data-focus-diff-demo></div>` and `<script type="module" src="focus-diff-demo.js"></script>`.
 */
export default defineConfig({
  resolve: {
    alias: {
      '#i18n': path.resolve('src/utils/i18n-web/i18n-web.ts'),
      '@': path.resolve('src'),
    },
  },
  publicDir: false,
  plugins: [
    {
      // Its styles are adopted into its shadow roots from the script itself; the stylesheet the components also import
      // would only restyle the page around it.
      name: 'focus-diff-drop-stylesheet',
      enforce: 'post',
      generateBundle(_, bundle) {
        for (const name of Object.keys(bundle)) if (name.endsWith('.css')) delete bundle[name];
      },
    },
  ],
  build: {
    outDir: '.output/demo',
    emptyOutDir: true,
    lib: { entry: 'src/components/demo/embed.ts', formats: ['es'], fileName: () => 'focus-diff-demo.js' },
  },
});
