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
  // Not while testing: coverage measures the code as written, not the compiler's cache checks
  // (some of which no render can reach).
  plugins: [react(), ...(process.env.VITEST ? [] : [babel({ presets: [reactCompilerPreset()] })]), tailwindcss()],
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
      "react/jsx-no-constructed-context-values": "off",
      // Immutable state updates copy with a spread on purpose.
      "oxc/no-map-spread": "off",
      // `void p.then(() => {...})` ends a chain on purpose.
      "promise/always-return": ["error", { ignoreLastCallback: true }],
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "eslint/max-lines-per-function": "off",
      "eslint/max-lines": "off",
      "import/max-dependencies": "off",
      "eslint/no-inline-comments": "off",
      // An effect that returns its cleanup on one path can't satisfy both of these on another
      // ("return;" or "return undefined;"); the cleanup contract is React's, not ours.
      "typescript/consistent-return": "off",
      // "" means missing in the person's settings and GitHub's fields (x?.trim() || null).
      "typescript/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
      // Stylesheets are imported for what they do.
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
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
    overrides: [
      {
        files: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**"],
        rules: {
          "vitest/no-conditional-in-test": "off",
          "unicorn/consistent-function-scoping": "off",
          "eslint/prefer-promise-reject-errors": "off",
          "typescript/prefer-promise-reject-errors": "off",
        },
      },
    ],
  },

  test: {
    environment: "happy-dom",
    setupFiles: ["src/utils/test-setup/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      // The windows' entry points, the development sample data and type declarations aren't units.
      exclude: [
        "src/entries/**",
        "src/utils/mock*/**",
        "src/utils/dev-log/**",
        "src/utils/test-setup/**",
        "src/**/*.d.ts",
        "src/locales/**",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text-summary", "html"],
    },
  },
});
