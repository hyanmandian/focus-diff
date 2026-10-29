import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

const host = process.env.TAURI_DEV_HOST;
const page = (name: string) => fileURLToPath(new URL(`./${name}.html`, import.meta.url));

export default defineConfig({
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
      "react/react-in-jsx-scope": "off",
      "typescript/prefer-readonly-parameter-types": "off",
      "typescript/strict-boolean-expressions": "off",
      "react-perf/jsx-no-new-function-as-prop": "off",
      "react-perf/jsx-no-new-object-as-prop": "off",
      "react-perf/jsx-no-new-array-as-prop": "off",
      "react-perf/jsx-no-jsx-as-prop": "off",
      "react/jsx-no-constructed-context-values": "off",
      "oxc/no-map-spread": "off",
      "promise/always-return": ["error", { ignoreLastCallback: true }],
      "jsdoc/require-param": "off",
      "jsdoc/require-returns": "off",
      "eslint/max-lines-per-function": "off",
      "eslint/max-lines": "off",
      "import/max-dependencies": "off",
      "eslint/no-inline-comments": "off",
      "typescript/consistent-return": "off",
      "typescript/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
      "import/no-unassigned-import": ["error", { allow: ["**/*.css"] }],
      "unicorn/prefer-dom-node-dataset": "off",
      "eslint/no-underscore-dangle": ["error", { allow: ["__typename", "__TAURI_INTERNALS__"] }],
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
    environmentOptions: {
      happyDOM: {
        settings: { navigator: { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15" } },
      },
    },
    setupFiles: ["src/utils/test-setup/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/entries/**",
        "src/utils/dev-log/**",
        "src/utils/mock*/**",
        "src/utils/test-setup/**",
        "src/utils/fake-platform/**",
        "src/**/*.d.ts",
        "src/locales/**",
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
      reporter: ["text-summary", "html"],
    },
  },
});
