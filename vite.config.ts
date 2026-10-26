import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const host = process.env.TAURI_DEV_HOST;
const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

// Vite+ runs it all from here (vp dev, vp build, vp check, vp test): four pages (the panel under
// the tray icon, settings, first-run setup and a pull request's review), Oxfmt, Oxlint, Vitest.
export default defineConfig({
  // React Compiler memoizes components and hooks at build time, so renders stay cheap without
  // hand-written useMemo/useCallback.
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    target: "safari16",
    rollupOptions: {
      input: { panel: page("index"), settings: page("settings"), setup: page("setup"), review: page("review") },
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

  fmt: {
    printWidth: 120,
    sortImports: true,
    sortPackageJson: true,
    sortTailwindcss: { stylesheet: "./src/index.css", functions: ["cn", "cva"] },
    ignorePatterns: ["dist/**", "src-tauri/**", "node_modules/**", "coverage/**", "package-lock.json"],
  },

  lint: {
    ignorePatterns: ["dist/**", "src-tauri/**", "coverage/**"],
    options: { typeAware: true, typeCheck: true },
    plugins: [
      "eslint",
      "typescript",
      "unicorn",
      "oxc",
      "react",
      "react-perf",
      "jsx-a11y",
      "import",
      "jsdoc",
      "promise",
      "vitest",
    ],
    categories: { correctness: "error", suspicious: "error", perf: "error", pedantic: "error" },
    rules: {
      // What the categories turn on that doesn't fit: the old JSX transform's rule, readonly
      // parameters and strict booleans (outside typescript-eslint's strict sets too), render
      // performance rules the React Compiler makes moot, JSDoc @param/@returns that would only
      // repeat the types, and size limits on files and functions.
      "react/react-in-jsx-scope": "off",
      "typescript/prefer-readonly-parameter-types": "off",
      "typescript/strict-boolean-expressions": "off",
      "react-perf/jsx-no-new-function-as-prop": "off",
      "react-perf/jsx-no-new-object-as-prop": "off",
      "react-perf/jsx-no-new-array-as-prop": "off",
      "react-perf/jsx-no-jsx-as-prop": "off",
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "eslint/max-lines-per-function": "off",
      "eslint/max-lines": "off",
      "import/max-dependencies": "off",
      "eslint/no-inline-comments": "off",
      // Not type-aware: it would have data-* set through .dataset on elements that have none (an Element).
      "unicorn/prefer-dom-node-dataset": "off",
      // GraphQL's __typename and Tauri's __TAURI_INTERNALS__ are names we don't choose.
      "eslint/no-underscore-dangle": ["error", { allow: ["__typename", "__TAURI_INTERNALS__"] }],
      // No barrels, no cycles, nothing unused.
      "import/no-cycle": "error",
      "import/no-self-import": "error",
      "import/no-duplicates": "error",
      "import/no-namespace": "error",
      "eslint/no-unused-vars": "error",
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "off",
      "typescript/consistent-type-imports": "error",
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/await-thenable": "error",
      "typescript/switch-exhaustiveness-check": "error",
      "react/jsx-key": "error",
      "react/no-array-index-key": "error",
      "react/self-closing-comp": "error",
      "react/jsx-no-useless-fragment": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      "jsx-a11y/no-autofocus": "off",
      "jsdoc/check-tag-names": "error",
      "jsdoc/no-defaults": "error",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      "unicorn/no-null": "off",
      "eslint/no-console": ["error", { allow: ["error"] }],
      "eslint/eqeqeq": "error",
      "eslint/no-var": "error",
      "eslint/prefer-const": "error",
    },
  },

  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // The windows' entry points, the development sample data and type declarations aren't units.
      exclude: ["src/entries/**", "src/utils/mock*/**", "src/utils/dev-log/**", "src/**/*.d.ts", "src/locales/**"],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text-summary", "html"],
    },
  },
});
