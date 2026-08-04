import { launchLinkedInExtensionContext } from "../test/e2e/linkedin-extension-fixture.mjs";

const { context } = await launchLinkedInExtensionContext();
const page = context.pages()[0] || await context.newPage();
await page.goto("https://www.linkedin.com/login");
console.log("Sign in to LinkedIn in this dedicated browser, verify the Brice test profile, then close the browser window to save the session.");
await new Promise((resolve) => context.browser()?.once("disconnected", resolve));
