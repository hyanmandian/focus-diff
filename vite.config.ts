import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import tailwindcss from "@tailwindcss/vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

// Four pages: the panel under the tray icon (index.html), settings, first-run setup, and a pull
// request's review.
export default defineConfig(() => ({
  // React Compiler memoizes components and hooks at build time, so renders stay cheap without
  // hand-written useMemo/useCallback.
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    target: "safari16",
    rollupOptions: {
      input: {
        panel: fileURLToPath(new URL("./index.html", import.meta.url)),
        settings: fileURLToPath(new URL("./settings.html", import.meta.url)),
        setup: fileURLToPath(new URL("./setup.html", import.meta.url)),
        review: fileURLToPath(new URL("./review.html", import.meta.url)),
      },
    },
  },
  // Tauri expects a fixed port, keeps Rust errors visible, and rebuilds itself.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
