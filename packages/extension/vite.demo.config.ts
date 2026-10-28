import path from "node:path";

import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "#i18n": path.resolve("src/utils/i18n-web/i18n-web.ts"),
      "@": path.resolve("src"),
    },
  },
  publicDir: false,
  plugins: [
    {
      name: "focus-diff-drop-stylesheet",
      enforce: "post",
      generateBundle(_, bundle) {
        for (const name of Object.keys(bundle)) if (name.endsWith(".css")) delete bundle[name];
      },
    },
  ],
  build: {
    outDir: ".output/demo",
    emptyOutDir: true,
    lib: { entry: "src/components/demo-embed/demo-embed.ts", formats: ["es"], fileName: () => "focus-diff-demo.js" },
  },
});
