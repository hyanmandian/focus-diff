import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [WxtVitest()],
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["vitest.setup.ts"],
    restoreMocks: true,
    // Themes are CSS read as text; without this, Vitest hands them over empty.
    css: true,
    // Every module is covered whole; the entry points only wire modules up, and the end-to-end tests run those.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/entrypoints/**", "src/**/*.test.{ts,tsx}", "src/**/*.d.ts"],
      reporter: ["text-summary", "lcov"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
