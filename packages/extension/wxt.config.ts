import process from "node:process";
import { fileURLToPath } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

/** The React Compiler, as @vitejs/plugin-react's reactCompilerPreset() runs it for the desktop: only over files that
 *  have components or hooks, for the pages (not the background). WXT's own Vite turns JSX into React's runtime calls. */
const reactCompiler = {
  preset: () => ({
    plugins: [[fileURLToPath(import.meta.resolve("babel-plugin-react-compiler")), {}] satisfies [string, object]],
  }),
  rolldown: {
    filter: { code: /forwardRef|memo|\b(?:[A-Z]|use[A-Z0-9])/u },
    applyToEnvironmentHook: (env: { config: { consumer: string } }) => env.config.consumer === "client",
  },
};

export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/i18n/module"],
  manifestVersion: 3,
  // The Mac app's screens (@focus-diff/desktop) and design system, built here as the desktop builds them: React with the
  // React Compiler (run over those packages' files too, as they resolve outside node_modules) and Tailwind v4.
  vite: () => ({
    plugins: [babel({ presets: [reactCompiler] }), tailwindcss()],
    oxc: { jsx: { runtime: "automatic" } },
    define: {
      // The GitHub OAuth app's client id for signing in with a code (the device flow), as the desktop's build takes
      // it; without one, a personal access token is how to sign in.
      "import.meta.env.FOCUS_DIFF_GITHUB_CLIENT_ID": JSON.stringify(process.env.FOCUS_DIFF_GITHUB_CLIENT_ID ?? ""),
    },
    build: { target: "es2022", chunkSizeWarningLimit: 4096 },
    // The review's syntax colouring worker loads each language's grammar when it's needed, as a module, rather than
    // carrying them all in one file (which Firefox Add-ons can't review).
    worker: { format: "es" },
  }),
  manifest: ({ browser }) => ({
    name: "__MSG_extensionName__",
    description: "__MSG_extensionDescription__",
    default_locale: "en",
    homepage_url: "https://focus-diff.com",
    // `alarms` looks at GitHub on the queues' rhythm and keeps review times; `notifications` says what's new.
    // `unlimitedStorage` (Chrome's, which asks nothing of the reader) keeps the queues' pull requests and the last copy
    // of each review past storage's 10 MB.
    permissions: ["storage", "alarms", "notifications", ...(browser === "chrome" ? ["unlimitedStorage"] : [])],
    // The GitHub API, with the token the reader signs in with, and github.com for signing in with a code.
    host_permissions: ["https://api.github.com/*", "https://github.com/*"],
    action: { default_title: "__MSG_actionTitle__" },
    // The review's syntax colouring compiles its grammars' patterns with WebAssembly (Shiki, through @pierre/diffs).
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    minimum_chrome_version: "123",
    commands: {
      "next-filter": { suggested_key: { default: "Alt+Shift+Period" }, description: "__MSG_commandNext__" },
      "previous-filter": { suggested_key: { default: "Alt+Shift+Comma" }, description: "__MSG_commandPrevious__" },
      "show-all": { suggested_key: { default: "Alt+Shift+0" }, description: "__MSG_commandAll__" },
      "next-unviewed": { suggested_key: { default: "Alt+Shift+J" }, description: "__MSG_commandNextUnviewed__" },
    },
    ...(browser === "firefox"
      ? {
          author: "Hyan Mandian",
          browser_specific_settings: {
            gecko: {
              id: "focus-diff@hyan.com.br",
              strict_min_version: "140.0",
              data_collection_permissions: { required: ["none"] },
            },
            gecko_android: { strict_min_version: "142.0" },
          },
        }
      : { author: { email: "focus-diff@hyan.com.br" } }),
  }),
  zip: {
    artifactTemplate: "{{name}}-{{version}}-{{browser}}.zip",
    sourcesTemplate: "{{name}}-{{version}}-sources.zip",
    excludeSources: ["store/**", "site/**"],
  },
});
