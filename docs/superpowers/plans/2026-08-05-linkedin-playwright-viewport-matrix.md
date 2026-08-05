# LinkedIn Playwright Viewport Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exercise the opt-in, real LinkedIn manual-send test at four representative desktop window sizes while keeping sends serial and guarded.

**Architecture:** Playwright projects define the four viewport profiles. The existing persistent-context fixture reads the selected project's viewport, applies it both to Playwright's CSS viewport/screen and Chromium's native window-size argument, then exposes the profile name for attributable diagnostics. The existing live spec remains a single workflow; Playwright runs it once per project.

**Tech Stack:** Node.js ESM, `node:test`, Playwright Chromium persistent contexts, Chrome unpacked extensions.

## Global Constraints

- Preserve the existing real-recipient guard: only `https://www.linkedin.com/in/brice-biaou-32387b156/` may be used by the live test.
- A real browser session and message send require `LIVE_LINKEDIN_E2E=1`; without it, the fixture must reject before launching Chromium or reaching LinkedIn.
- Keep the live suite at `workers: 1`; every real message send is serial.
- Use the persistent profile supplied by `PLAYWRIGHT_LINKEDIN_PROFILE_DIR` when set, so an authenticated profile is reusable across worktrees.
- Cover desktop responsive layouts only: no mobile user-agent, touch emulation, or LinkedIn mobile-site coverage.
- Keep `npm test` offline; the live test remains under the separate `test:e2e:linkedin` script.

---

## File Structure

- Modify: `playwright.live.config.mjs` — declare the four named Playwright desktop projects and their viewport/screen dimensions.
- Modify: `test/e2e/linkedin-extension-fixture.mjs` — validate viewport input, derive Chromium window-size arguments, and pass the selected project viewport into the persistent browser context.
- Modify: `test/e2e/linkedin-extension-fixture.test.mjs` — unit-test viewport validation and Chromium argument construction without launching a browser.
- Modify: `test/e2e/linkedin-manual-send.live.spec.mjs` — label each live run with its Playwright project and attach its dimensions for failure diagnosis.

### Task 1: Make viewport launch configuration testable

**Files:**
- Modify: `test/e2e/linkedin-extension-fixture.mjs:10-43`
- Modify: `test/e2e/linkedin-extension-fixture.test.mjs:1-28`

**Interfaces:**
- Produces: `getChromiumWindowSizeArgs(viewport)` returning `[]` for an omitted viewport or `["--window-size=<width>,<height>"]` for a valid desktop viewport.
- Produces: `launchLinkedInExtensionContext(env, viewport)` accepting an optional `{ width: number, height: number }` and forwarding it as `viewport` and `screen` to `chromium.launchPersistentContext`.
- Consumes: existing `getLinkedInProfileDir(env)` and `createTemporaryExtensionPath()`.

- [ ] **Step 1: Write failing unit tests for the pure window-size helper**

  In `test/e2e/linkedin-extension-fixture.test.mjs`, import `getChromiumWindowSizeArgs` and add these cases:

  ```js
  test("builds a native Chromium window-size argument from a viewport", () => {
    assert.deepEqual(
      getChromiumWindowSizeArgs({ width: 1280, height: 720 }),
      ["--window-size=1280,720"]
    );
  });

  test("rejects malformed viewport dimensions", () => {
    assert.throws(() => getChromiumWindowSizeArgs({ width: 0, height: 720 }), /positive integers/);
    assert.throws(() => getChromiumWindowSizeArgs({ width: 1280.5, height: 720 }), /positive integers/);
  });
  ```

- [ ] **Step 2: Run the fixture unit test to verify it fails**

  Run: `node --test test/e2e/linkedin-extension-fixture.test.mjs`

  Expected: FAIL because `getChromiumWindowSizeArgs` is not exported yet.

- [ ] **Step 3: Implement viewport validation and native window arguments**

  In `test/e2e/linkedin-extension-fixture.mjs`, add the exported helper immediately before `launchLinkedInExtensionContext`:

  ```js
  export function getChromiumWindowSizeArgs(viewport) {
    if (viewport == null) return [];
    const { width, height } = viewport;
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      throw new TypeError("Viewport width and height must be positive integers.");
    }
    return [`--window-size=${width},${height}`];
  }
  ```

  Change the launcher signature and options so the same valid dimensions control both layout layers:

  ```js
  export async function launchLinkedInExtensionContext(env = process.env, viewport) {
    const windowSizeArgs = getChromiumWindowSizeArgs(viewport);
    // retain extensionPath creation
    const context = await chromium.launchPersistentContext(getLinkedInProfileDir(env), {
      channel: "chromium",
      headless: false,
      ...(viewport ? { viewport, screen: viewport } : {}),
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        ...windowSizeArgs,
      ],
    });
  }
  ```

  Do not alter the live opt-in guard, temporary extension copy, or cleanup path.

- [ ] **Step 4: Run the fixture unit test to verify it passes**

  Run: `node --test test/e2e/linkedin-extension-fixture.test.mjs`

  Expected: PASS for the existing opt-in/context-close tests plus the new window-size tests, with no browser launch.

- [ ] **Step 5: Commit the testable fixture capability**

  ```bash
  git add test/e2e/linkedin-extension-fixture.mjs test/e2e/linkedin-extension-fixture.test.mjs
  git commit -m "test(extension): configure Playwright viewport windows"
  ```

### Task 2: Declare the desktop matrix and propagate the selected project

**Files:**
- Modify: `playwright.live.config.mjs:3-16`
- Modify: `test/e2e/linkedin-extension-fixture.mjs:55-96`
- Modify: `test/e2e/linkedin-manual-send.live.spec.mjs:7-29`

**Interfaces:**
- Consumes: `launchLinkedInExtensionContext(env, viewport)` and `getChromiumWindowSizeArgs(viewport)` from Task 1.
- Produces: four sequential Playwright projects named `desktop-wide`, `desktop-laptop`, `desktop-compact`, and `desktop-narrow`.
- Produces: a live test attachment named `viewport.json` containing `{ name, width, height }` when the run fails.

- [ ] **Step 1: Add the named project matrix to the live config**

  Replace the single `projects` entry in `playwright.live.config.mjs` with the following list, keeping `workers: 1`, `headless: false`, and failure artifacts unchanged:

  ```js
  projects: [
    { name: "desktop-wide", use: { viewport: { width: 1440, height: 900 }, screen: { width: 1440, height: 900 } } },
    { name: "desktop-laptop", use: { viewport: { width: 1280, height: 720 }, screen: { width: 1280, height: 720 } } },
    { name: "desktop-compact", use: { viewport: { width: 1024, height: 768 }, screen: { width: 1024, height: 768 } } },
    { name: "desktop-narrow", use: { viewport: { width: 768, height: 1024 }, screen: { width: 768, height: 1024 } } },
  ],
  ```

- [ ] **Step 2: Forward the project viewport in the fixture and attach dimensions on failure**

  In the `extension` fixture, read `testInfo.project.use.viewport`, then launch with it:

  ```js
  const viewport = testInfo.project.use.viewport;
  const { context, extensionId, worker, sidepanel, cleanup } =
    await launchLinkedInExtensionContext(process.env, viewport);
  ```

  Inside the existing `if (testInfo.status !== testInfo.expectedStatus)` block, before the HTML attachment, attach the project identity and viewport:

  ```js
  await testInfo.attach("viewport.json", {
    body: JSON.stringify({ name: testInfo.project.name, ...viewport }, null, 2),
    contentType: "application/json",
  });
  ```

  Preserve all existing failure artifacts and final context cleanup. Do not create a browser context before `assertLiveLinkedInOptIn()`.

- [ ] **Step 3: Make the live assertion attributable to the matrix project**

  Change the live test callback to accept `testInfo`, and add a clear project annotation before interacting with the sidepanel:

  ```js
  liveTest("sends one manual LinkedIn test message to Brice", async ({ extension }, testInfo) => {
    testInfo.annotations.push({
      type: "viewport",
      description: `${testInfo.project.name}: ${testInfo.project.use.viewport.width}x${testInfo.project.use.viewport.height}`,
    });
    // retain timestamped message and all existing UI/history/conversation assertions
  });
  ```

  Playwright's report identity already prefixes this test with the project name (for example, `[desktop-wide]`), so do not multiply the test with an in-spec loop.

- [ ] **Step 4: Verify the ordinary suite remains offline**

  Run: `npm test`

  Expected: PASS; no Playwright Chromium instance is launched because the normal Node test glob does not include `*.live.spec.mjs`.

- [ ] **Step 5: Verify the live opt-in guard across the matrix**

  Run: `npm run test:e2e:linkedin`

  Expected: four failures, one for each named project, each reporting `Refusing live LinkedIn send. Set LIVE_LINKEDIN_E2E=1.` before a browser starts. This intentionally demonstrates the guard still covers every matrix entry.

- [ ] **Step 6: Execute the real matrix using the authenticated persistent profile**

  Run:

  ```bash
  LIVE_LINKEDIN_E2E=1 PLAYWRIGHT_LINKEDIN_PROFILE_DIR=/Users/albanpro/claude-code-perso/work/cold-dm-extension-manual-platform-send-2026-08-04/.playwright-linkedin-profile npm run test:e2e:linkedin
  ```

  Expected: four sequential passed tests labelled `desktop-wide`, `desktop-laptop`, `desktop-compact`, and `desktop-narrow`. Each sends one unique timestamped test message to Brice, records `✓ Sent` in extension history, and verifies the message in the LinkedIn conversation.

- [ ] **Step 7: Inspect final state and commit the matrix**

  Run: `git diff --check && git status --short`

  Expected: no whitespace errors; only the three matrix implementation files are staged for this task.

  ```bash
  git add playwright.live.config.mjs test/e2e/linkedin-extension-fixture.mjs test/e2e/linkedin-manual-send.live.spec.mjs
  git commit -m "test(extension): cover LinkedIn desktop viewports"
  ```

### Task 3: Final verification and handoff

**Files:**
- Verify: `package.json:6-11`
- Verify: `playwright.live.config.mjs`
- Verify: `test/e2e/linkedin-extension-fixture.mjs`
- Verify: `test/e2e/linkedin-manual-send.live.spec.mjs`

**Interfaces:**
- Consumes: completed Tasks 1 and 2.
- Produces: evidence that offline tests, opt-in rejection, and all four authenticated real LinkedIn desktop runs behave as designed.

- [ ] **Step 1: Run the complete offline regression suite**

  Run: `npm test`

  Expected: PASS. Confirm the test command only executes `test/*.test.mjs` and `test/e2e/*.test.mjs`, not the live spec.

- [ ] **Step 2: Re-run the authenticated live matrix if Task 2 was interrupted**

  Run the same explicit `LIVE_LINKEDIN_E2E=1` and `PLAYWRIGHT_LINKEDIN_PROFILE_DIR=...` command from Task 2, Step 6.

  Expected: all four projects PASS, serially, with no profile cross-worktree login failure.

- [ ] **Step 3: Review the committed change set**

  Run: `git status --short && git log --oneline -3`

  Expected: clean worktree and the two focused commits from Tasks 1 and 2 on top of the viewport design commit.
