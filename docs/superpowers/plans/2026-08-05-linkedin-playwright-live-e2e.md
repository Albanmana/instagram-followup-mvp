# LinkedIn Playwright Live E2E Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in Playwright test that runs the unpacked extension through the real LinkedIn Brice test profile and verifies a confirmed manual send.

**Architecture:** Keep `node --test` as the fast, offline suite. Add a separate Playwright project that launches bundled Chromium with `extension/` loaded in a dedicated persistent profile; the test drives `sidepanel.html`, waits for the extension-created LinkedIn tab, then asserts both extension history and real LinkedIn conversation state.

**Tech Stack:** Node.js ESM, `@playwright/test`, bundled Chromium, Chrome Manifest V3, existing extension sidepanel.

## Global Constraints

- Execute the live test only when `LIVE_LINKEDIN_E2E=1`.
- Only send to `https://www.linkedin.com/in/brice-biaou-32387b156/`.
- Never use the user's Google Chrome profile; use `.playwright-linkedin-profile/` only.
- Keep the normal `npm test` network-free.
- Run the live test with one worker and retain traces/screenshots on failure.
- Do not push or open a PR unless explicitly requested.

---

### Task 1: Preserve the LinkedIn visibility regression fix

**Files:**
- Modify: `extension/linkedin-send.js:47-58`
- Modify: `test/linkedin-send.test.mjs:208-257`

**Interfaces:**
- Consumes: `discoverLinkedInComposeHref(expectedProfileUrl)`.
- Produces: a ready compose result when LinkedIn wraps a visible action in `display: contents` containers.

- [ ] **Step 1: Run the focused regression test before the fix**

Run: `node --test test/linkedin-send.test.mjs`

Expected before implementation: the test named `keeps a direct Message action visible through LinkedIn display contents wrappers` fails because it returns `skipped`.

- [ ] **Step 2: Change only the visibility rule**

```js
const rect = current.getBoundingClientRect?.();
if (style.display !== "contents" && rect && (rect.width === 0 || rect.height === 0)) return false;
```

- [ ] **Step 3: Verify the focused suite is green**

Run: `node --test test/linkedin-send.test.mjs`

Expected: all LinkedIn sender tests pass, including the `display: contents` regression.

- [ ] **Step 4: Commit the isolated fix**

```bash
git add extension/linkedin-send.js test/linkedin-send.test.mjs
git commit -m "fix(extension): detect visible LinkedIn profile actions"
```

### Task 2: Add isolated Playwright live-test infrastructure

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `playwright.live.config.mjs`
- Create: `test/e2e/linkedin-extension-fixture.mjs`
- Create: `scripts/open-linkedin-playwright-profile.mjs`

**Interfaces:**
- Consumes: `LIVE_LINKEDIN_E2E`, `PLAYWRIGHT_LINKEDIN_PROFILE_DIR`, and unpacked `extension/`.
- Produces: `liveTest`, `expect`, and an `extension` fixture containing `{ context, extensionId, sidepanel }`.

- [ ] **Step 1: Add the failing opt-in guard test**

Create `test/e2e/linkedin-extension-fixture.test.mjs` with a unit-tested guard that rejects every value except `LIVE_LINKEDIN_E2E === "1"`:

```js
test("requires explicit opt-in for a live LinkedIn send", () => {
  assert.throws(() => assertLiveLinkedInOptIn({}), /LIVE_LINKEDIN_E2E=1/);
  assert.doesNotThrow(() => assertLiveLinkedInOptIn({ LIVE_LINKEDIN_E2E: "1" }));
});
```

- [ ] **Step 2: Verify the guard fails before implementation**

Run: `node --test test/e2e/linkedin-extension-fixture.test.mjs`

Expected: failure because `assertLiveLinkedInOptIn` does not exist.

- [ ] **Step 3: Install Playwright and define scripts**

Run:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

Add these `package.json` scripts:

```json
{
  "test:e2e:linkedin": "playwright test --config=playwright.live.config.mjs",
  "login:e2e:linkedin": "node scripts/open-linkedin-playwright-profile.mjs"
}
```

- [ ] **Step 4: Implement the fixture and persistent login launcher**

`test/e2e/linkedin-extension-fixture.mjs` must:

```js
export function assertLiveLinkedInOptIn(env = process.env) {
  if (env.LIVE_LINKEDIN_E2E !== "1") {
    throw new Error("Refusing live LinkedIn send. Set LIVE_LINKEDIN_E2E=1.");
  }
}
```

It must launch `chromium.launchPersistentContext(profileDir, { channel: "chromium", args: [\`--disable-extensions-except=${extensionPath}\`, \`--load-extension=${extensionPath}\`] })`, derive `extensionId` from the MV3 service worker URL, and open `chrome-extension://${extensionId}/sidepanel.html`.

`scripts/open-linkedin-playwright-profile.mjs` must launch the same persistent context, navigate to `https://www.linkedin.com/login`, and remain open until the user closes Chromium so the completed login is persisted.

`playwright.live.config.mjs` must set `testDir: "test/e2e"`, `workers: 1`, `retries: 0`, `use: { headless: false, trace: "retain-on-failure", screenshot: "only-on-failure" }`, and a single `live-linkedin` project.

Add `.playwright-linkedin-profile/`, `playwright-report/`, and `test-results/` to `.gitignore`.

- [ ] **Step 5: Verify the offline guard and normal suite**

Run:

```bash
node --test test/e2e/linkedin-extension-fixture.test.mjs
npm test
```

Expected: guard test passes; all existing Node tests remain green without Playwright or LinkedIn network calls.

- [ ] **Step 6: Commit the infrastructure**

```bash
git add package.json package-lock.json .gitignore playwright.live.config.mjs test/e2e/linkedin-extension-fixture.mjs test/e2e/linkedin-extension-fixture.test.mjs scripts/open-linkedin-playwright-profile.mjs
git commit -m "test(extension): add isolated Playwright LinkedIn harness"
```

### Task 3: Exercise the manual sender against the real LinkedIn test profile

**Files:**
- Create: `test/e2e/linkedin-manual-send.live.spec.mjs`
- Modify: `test/e2e/linkedin-extension-fixture.mjs`

**Interfaces:**
- Consumes: `extension` fixture and `assertLiveLinkedInOptIn()`.
- Produces: a live e2e assertion that one timestamped test message reaches Brice and is recorded as sent.

- [ ] **Step 1: Write the live test before its fixture helpers exist**

```js
liveTest("sends one manual LinkedIn test message to Brice", async ({ extension }) => {
  const message = `Cold DM Playwright e2e ${new Date().toISOString()}`;
  await extension.sidepanel.locator("#manual-test-platform").selectOption("linkedin");
  await extension.sidepanel.locator("#manual-test-target").fill(ALLOWED_TEST_PROFILE_URL);
  await extension.sidepanel.locator("#manual-test-message").fill(message);
  await extension.sidepanel.locator("#manual-test-send-button").click();
  await expect(extension.sidepanel.getByText("✓ Sent")).toBeVisible({ timeout: 45_000 });
  await expect(extension.linkedInConversation.getByText(message, { exact: true })).toBeVisible();
});
```

- [ ] **Step 2: Verify opt-in prevents accidental execution**

Run: `npm run test:e2e:linkedin`

Expected: immediate failure with `Refusing live LinkedIn send. Set LIVE_LINKEDIN_E2E=1.` before Chromium or LinkedIn opens.

- [ ] **Step 3: Implement bounded live helpers**

Add `ALLOWED_TEST_PROFILE_URL` and a strict equality assertion for the sidepanel target. Wait for the tab created by the extension, verify it is a `linkedin.com` profile/compose tab, and retain it as `linkedInConversation`. After the send, select the `History` tab and scope the `✓ Sent` assertion to the unique message's manual history row. Attach the latest sidepanel HTML, browser console errors, and a screenshot through `testInfo` in `afterEach` when the test fails.

- [ ] **Step 4: Complete the one-time profile login**

Run: `npm run login:e2e:linkedin`

Expected: dedicated bundled Chromium opens. Sign in to LinkedIn manually, confirm the Brice profile is reachable, then close Chromium to save the isolated session.

- [ ] **Step 5: Run and verify the real test explicitly**

Run: `LIVE_LINKEDIN_E2E=1 npm run test:e2e:linkedin`

Expected: one new timestamped `Cold DM Playwright e2e` message appears in the Brice conversation, and the extension history contains the same row with `✓ Sent`.

- [ ] **Step 6: Run the complete validation set**

Run:

```bash
npm test
node --check extension/linkedin-send.js
node --check test/e2e/linkedin-extension-fixture.mjs
node --check test/e2e/linkedin-manual-send.live.spec.mjs
git diff --check
```

Expected: all commands pass. The live test result is reported separately and only after its opt-in run.

- [ ] **Step 7: Commit the live e2e test**

```bash
git add test/e2e/linkedin-manual-send.live.spec.mjs test/e2e/linkedin-extension-fixture.mjs
git commit -m "test(extension): cover live LinkedIn manual sender"
```
