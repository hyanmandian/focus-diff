import process from "node:process";

import { defineConfig, devices } from "@playwright/test";

// The pages run in a plain browser against the dev server, where the sample data in
// src/utils/mock/mock.ts stands in for Rust and GitHub, so nothing here needs the app or a network.
const port = 1425;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    // The review window's narrowest is wider than Playwright's default page.
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `npx vp dev --port ${port} --strictPort`,
    url: baseURL,
    // Always its own: one left running from another checkout would test other code.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
