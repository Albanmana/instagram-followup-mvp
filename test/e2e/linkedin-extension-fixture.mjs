import { cpSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect, test as base } from "@playwright/test";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionSourcePath = path.join(workspaceRoot, "extension");
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

export function waitForLinkedInContextClose(context) {
  return new Promise((resolve) => context.once("close", resolve));
}

export function createTemporaryExtensionPath() {
  const extensionPath = mkdtempSync(path.join(os.tmpdir(), "cold-dm-playwright-extension-"));
  cpSync(extensionSourcePath, extensionPath, { recursive: true });
  return extensionPath;
}

export async function launchLinkedInExtensionContext(env = process.env) {
  const extensionPath = createTemporaryExtensionPath();
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
  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return {
    context,
    extensionId,
    worker,
    sidepanel,
    cleanup: () => rmSync(extensionPath, { recursive: true, force: true }),
  };
}

export const liveTest = base.extend({
  extension: async ({}, use, testInfo) => {
    assertLiveLinkedInOptIn();
    const { context, extensionId, worker, sidepanel, cleanup } = await launchLinkedInExtensionContext();
    const consoleErrors = [];
    sidepanel.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    try {
      await use({
        context,
        extensionId,
        sidepanel,
        clearManualTestState: async () => worker.evaluate(async () => {
          await chrome.storage.local.remove([
            "manualTestHistory",
            "batchQueue",
            "batchIndex",
            "batchStatus",
            "batchLogs",
          ]);
        }),
        readManualTestHistory: () => worker.evaluate(
          async () => (await chrome.storage.local.get("manualTestHistory")).manualTestHistory ?? []
        ),
        waitForLinkedInConversation: async () => {
          const page = await context.waitForEvent("page", { timeout: 20_000 });
          await page.waitForURL(/https:\/\/www\.linkedin\.com\/(in|messaging)\//, { timeout: 30_000 });
          return page;
        },
      });
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("sidepanel.html", {
          body: await sidepanel.content(),
          contentType: "text/html",
        });
        await testInfo.attach("browser-console-errors.txt", {
          body: consoleErrors.join("\n"),
          contentType: "text/plain",
        });
        await testInfo.attach("sidepanel.png", {
          body: await sidepanel.screenshot(),
          contentType: "image/png",
        });
      }
      await context.close();
      cleanup();
    }
  },
});

export { expect };
