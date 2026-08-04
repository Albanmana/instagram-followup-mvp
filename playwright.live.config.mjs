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
  projects: [
    {
      name: "desktop-wide",
      use: { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } },
    },
    {
      name: "desktop-laptop",
      use: { viewport: { width: 1280, height: 720 }, screen: { width: 1280, height: 720 } },
    },
    {
      name: "desktop-compact",
      use: { viewport: { width: 1024, height: 768 }, screen: { width: 1024, height: 768 } },
    },
    {
      name: "desktop-narrow",
      use: { viewport: { width: 768, height: 1024 }, screen: { width: 768, height: 1024 } },
    },
  ],
});
