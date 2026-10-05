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
  },
});
