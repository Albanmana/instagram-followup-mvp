import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test as base } from "@playwright/test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionPath = path.join(workspaceRoot, "extension");
const defaultProfileDir = path.join(workspaceRoot, ".playwright-linkedin-profile");

export const ALLOWED_TEST_PROFILE_URL = "https://www.linkedin.com/in/brice-biaou-32387b156/";

export function assertLiveLinkedInOptIn(env = process.env) {
  if (env.LIVE_LINKEDIN_E2E !== "1") {
    throw new Error("Refusing live LinkedIn send. Set LIVE_LINKEDIN_E2E=1.");
  }
}

export function getLinkedInProfileDir(env = process.env) {
  return path.resolve(env.PLAYWRIGHT_LINKEDIN_PROFILE_DIR || defaultProfileDir);
}

export async function launchLinkedInExtensionContext(env = process.env) {
  const context = await chromium.launchPersistentContext(getLinkedInProfileDir(env), {
    channel: "chromium",
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId };
}

export const liveTest = base.extend({
  extension: async ({}, use) => {
    assertLiveLinkedInOptIn();
    const { context, extensionId } = await launchLinkedInExtensionContext();
    const sidepanel = await context.newPage();
    await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await use({ context, extensionId, sidepanel });
    await context.close();
  },
});

export { expect };
