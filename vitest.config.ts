import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['vitest.setup.ts'],
    restoreMocks: true,
    // Themes are CSS read as text; without this, Vitest hands them over empty.
    css: true,
    // Unit tests cover the logic and the components; the pages and the content script are the end-to-end tests' job.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/entrypoints/**', 'src/**/*.test.ts', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'lcov'],
      // A ratchet just below what the tests reach today: coverage can't drop, and the floor moves up as tests do.
      thresholds: { statements: 40, branches: 27, functions: 35, lines: 42 },
    },
  },
});
