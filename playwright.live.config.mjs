import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.live.spec.mjs",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  use: {
    headless: false,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "live-linkedin" }],
});
