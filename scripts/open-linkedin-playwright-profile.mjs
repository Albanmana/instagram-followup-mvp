import {
  launchLinkedInExtensionContext,
  waitForLinkedInContextClose,
} from "../test/e2e/linkedin-extension-fixture.mjs";

const { context, cleanup } = await launchLinkedInExtensionContext();
const page = await context.newPage();
await page.goto("https://www.linkedin.com/login");
console.log("Sign in to LinkedIn in this dedicated browser, verify the Brice test profile, then close the browser window to save the session.");
await waitForLinkedInContextClose(context);
cleanup();
