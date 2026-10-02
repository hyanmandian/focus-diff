import { defineConfig } from '@playwright/test';

// Lets context.route intercept the extension service worker's requests: the diff download and the provider call.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    trace: 'on-first-retry',
  },
});
