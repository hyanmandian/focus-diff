import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
  },
});
