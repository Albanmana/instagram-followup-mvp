# LinkedIn Invitation Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a LinkedIn queue/manual item through a normal message when LinkedIn visibly offers one, otherwise send it as a connection invitation note when eligible.

**Architecture:** Replace the first-degree-only discovery result with a delivery-path result: `direct` for one safe compose route, or `invitation` for a visible target-profile Connect affordance. The background routes a direct result through the existing compose sender and executes invitation UI interactions in the still-open profile tab. Both paths return the existing structured sender outcome, preserving non-sent reasons for the result outbox and Cold DM.

**Tech Stack:** Chrome MV3 extension, DOM APIs executed by `chrome.scripting.executeScript`, Node.js ESM `node:test`, Playwright Chromium live tests.

## Global Constraints

- A normal, profile-scoped LinkedIn Message route has priority over an invitation even when the profile is not visibly a `1st` connection.
- The 200-character invitation-note limit applies only to the invitation fallback; direct-message length is not limited by this feature.
- For a 201+ character fallback note, do not click Connect and return exactly `LinkedIn invitation notes are limited to 200 characters; the queued message has <length>.` with `status: "skipped"`.
- Do not select InMail, Open Profile, global navigation, recommendation, hidden, or ambiguous actions.
- Do not attempt another delivery mechanism after an invitation interaction has begun; report the observed non-sent reason.
- Preserve canonical profile URL validation, temporary extension copies, Brice direct-message regression coverage, and the existing `sent` / `failed` / `skipped` result contract.
- A real connection invitation requires a separately authorized test profile. Do not send an invitation to `alexhormozi` during automated validation without explicit authorization.

---

## File Structure

- Modify: `extension/linkedin-send.js` — discover the delivery path and operate the profile-scoped invitation dialog.
- Modify: `extension/background.js` — choose the existing compose branch or the invitation branch and preserve exact outcomes.
- Modify: `test/linkedin-send.test.mjs` — model direct/non-first-degree, invitation discovery, over-limit and dialog behavior with DOM fixtures.
- Modify: `test/result-reporting.test.mjs` — prove exact invitation skip reasons survive strict result projection.
- Modify: `test/e2e/linkedin-manual-send.live.spec.mjs` — retain direct coverage and, only after authorization, add separate live invitation coverage.

### Task 1: Discover a delivery path without relying on connection degree

**Files:**
- Modify: `extension/linkedin-send.js:41-154`
- Modify: `test/linkedin-send.test.mjs:10-535`

**Interfaces:**
- Produces: `discoverLinkedInDeliveryPath(expectedProfileUrl, message)` returning one of:
  - `{ status: "ready", delivery: "direct", composeHref, recipientId }`
  - `{ status: "ready", delivery: "invitation" }`
  - `{ status: "skipped", reason }`
- Keeps: `discoverLinkedInComposeHref(expectedProfileUrl)` as a compatibility wrapper that calls delivery-path discovery with an empty message and returns only a direct ready route or its non-direct skipped result until all callers migrate.
- Consumes: existing canonical profile identity, visible-element, and blocked-route checks.

- [ ] **Step 1: Write failing tests for direct-message priority and the invitation limit**

  Import `discoverLinkedInDeliveryPath` and add a visible target-profile fixture with a compose href but only `2nd` text. Assert it is selected as a direct route:

  ```js
  assert.deepEqual(
    await discoverLinkedInDeliveryPath("https://www.linkedin.com/in/alice/", "x".repeat(201)),
    {
      status: "ready",
      delivery: "direct",
      composeHref: "/messaging/compose/?recipient=alice-id",
      recipientId: "alice-id",
    }
  );
  ```

  Add a second fixture with a visible profile-scoped `Connect` control, no safe compose route, and assert:

  ```js
  const tooLong = "x".repeat(201);
  assert.deepEqual(
    await discoverLinkedInDeliveryPath("https://www.linkedin.com/in/alice/", tooLong),
    {
      status: "skipped",
      reason: "LinkedIn invitation notes are limited to 200 characters; the queued message has 201.",
    }
  );
  ```

  Add the matching 200-character assertion returning `{ status: "ready", delivery: "invitation" }`.

- [ ] **Step 2: Run the focused unit test to verify it fails**

  Run: `node --test test/linkedin-send.test.mjs`

  Expected: FAIL because `discoverLinkedInDeliveryPath` is not exported.

- [ ] **Step 3: Implement safe delivery-path discovery**

  Extract the profile inspection currently inside `discoverLinkedInComposeHref` into `discoverLinkedInDeliveryPath(expectedProfileUrl, message)`.

  - Treat exactly one visible compose href in a profile-scoped section as `delivery: "direct"`; remove `1st` evidence as a prerequisite.
  - Retain rejection of sections with `InMail` or `Open Profile` evidence.
  - Detect one visible profile-scoped Connect control by normalized visible text `Connect`, accepting either a `button` or an anchor; duplicate nested representations of the same action must be deduplicated before counting.
  - When no direct route exists, measure `String(message ?? "").trim().length` before returning invitation ready; return the exact specified 201+ skip reason before any UI click.
  - Return exact unavailable/ambiguous reasons such as `A single profile-scoped Connect action is unavailable.` rather than falling back to global elements.

  Keep the existing eight-second hydration retry, retrying only while target actions have not rendered.

- [ ] **Step 4: Add failing safety tests for blocked and ambiguous actions**

  Add fixtures that prove:

  ```js
  // A profile section containing "InMail" plus a Message compose href must not return delivery: "direct".
  // Two different visible Connect elements in separate target-profile sections must return skipped with /Connect action is ambiguous/.
  // A Connect control only in an unrelated recommendation section must return skipped with /profile-scoped Connect action is unavailable/.
  ```

- [ ] **Step 5: Implement the minimal blocked/ambiguous filtering and verify all discovery tests**

  Extend the extracted inspector so blocked normal-message sections cannot become direct delivery, and use a map keyed by the action's element identity/text/href to eliminate nested duplicates while preserving genuinely distinct candidates.

  Run: `node --test test/linkedin-send.test.mjs`

  Expected: PASS, including existing direct-message tests after updating their expected reason from first-degree proof to safe profile-scoped route availability where necessary.

- [ ] **Step 6: Commit delivery-path discovery**

  ```bash
  git add extension/linkedin-send.js test/linkedin-send.test.mjs
  git commit -m "feat(extension): discover LinkedIn invitation fallback"
  ```

### Task 2: Send a profile-scoped invitation note safely

**Files:**
- Modify: `extension/linkedin-send.js:156-274`
- Modify: `test/linkedin-send.test.mjs`

**Interfaces:**
- Produces: `sendLinkedInInvitationNote(expectedProfileUrl, message)` returning `{ status: "sent", sentText }`, `{ status: "skipped", reason }`, or `{ status: "failed", reason }`.
- Consumes: `expectedProfileUrl` and a pre-validated, at-most-200-character message; operates only within the currently displayed profile and invitation dialog.

- [ ] **Step 1: Write failing invitation-interaction tests**

  Add small DOM fixtures representing the profile action area, optional More-actions menu, invitation choice dialog, note dialog, textarea, and Send button. Cover the two supported Connect placements:

  ```js
  test("opens More actions, adds the exact invitation note, and sends only in the active dialog", async () => {
    const outcome = await sendLinkedInInvitationNote(
      "https://www.linkedin.com/in/alice/",
      "Hello Alice"
    );
    assert.deepEqual(outcome, { status: "sent", sentText: "Hello Alice" });
    assert.equal(moreActions.clicked, true);
    assert.equal(connect.clicked, true);
    assert.equal(addNote.clicked, true);
    assert.equal(noteField.value, "Hello Alice");
    assert.equal(dialogSend.clicked, true);
    assert.equal(globalSend.clicked, false);
  });
  ```

  Add direct-Connect placement, no `Add a note`, missing note field, disabled Send, and a 201-character message. Assert that the last case returns the exact skip reason and `connect.clicked === false`.

- [ ] **Step 2: Run the focused sender test to verify it fails**

  Run: `node --test test/linkedin-send.test.mjs`

  Expected: FAIL because `sendLinkedInInvitationNote` is not exported.

- [ ] **Step 3: Implement dialog-scoped invitation sending**

  In `sendLinkedInInvitationNote`:

  1. Revalidate canonical expected/current profile identity and the trimmed note length before clicking.
  2. Find a single visible target-profile Connect action. If absent, find one visible profile-scoped More-actions control, click it, wait up to eight seconds for one visible `Connect` menu action, then click it.
  3. Wait for one visible invitation dialog. Click its visible `Add a note` control.
  4. Wait for a single visible `textarea` or `input` inside the active dialog, set the exact text through native value setter plus `input`/`change` events, and verify the field value exactly matches.
  5. Find one enabled `Send` button only inside that dialog, click it, and wait for a terminal indication that the dialog has closed or the field is detached/empty.

  Use exact skipped reasons for unavailable UI controls and failed reasons when text establishment or post-send confirmation fails. Never select a global Send action.

- [ ] **Step 4: Run focused tests and the complete Node suite**

  Run:

  ```bash
  node --test test/linkedin-send.test.mjs
  npm test
  ```

  Expected: all tests pass; normal `npm test` remains offline.

- [ ] **Step 5: Commit the invitation sender**

  ```bash
  git add extension/linkedin-send.js test/linkedin-send.test.mjs
  git commit -m "feat(extension): send LinkedIn invitation notes"
  ```

### Task 3: Route the queue and preserve exact Cold DM reasons

**Files:**
- Modify: `extension/background.js:1-165`
- Modify: `test/result-reporting.test.mjs:58-77`
- Modify: `test/linkedin-send.test.mjs`

**Interfaces:**
- Consumes: `discoverLinkedInDeliveryPath`, `sendLinkedInComposeMessage`, and `sendLinkedInInvitationNote`.
- Produces: `sendLinkedInTestMessage` outcomes from either sender with the existing `at` timestamp, and batch logs whose `reason` reaches `createExtensionResult` unchanged.

- [ ] **Step 1: Write the failing orchestration/reporting tests**

  Add a result-projection assertion:

  ```js
  assert.deepEqual(createExtensionResult({
    actionId: "00000000-0000-4000-8000-000000000001",
    platform: "linkedin",
    recipient: { profileUrl: "https://www.linkedin.com/in/alice/" },
    status: "skipped",
    reason: "LinkedIn invitation notes are limited to 200 characters; the queued message has 201.",
    at: "2026-08-05T10:00:00.000Z",
  }).reason, "LinkedIn invitation notes are limited to 200 characters; the queued message has 201.");
  ```

  Add a mocked `chrome.scripting.executeScript` test around `sendLinkedInTestMessage` that supplies an invitation discovery result and expects a second execution in the original profile tab for `sendLinkedInInvitationNote`, not a navigation to `/messaging/compose/`.

- [ ] **Step 2: Run the relevant tests to verify they fail**

  Run: `node --test test/result-reporting.test.mjs test/linkedin-send.test.mjs`

  Expected: orchestration test fails because `sendLinkedInTestMessage` only recognizes its current compose-ready result.

- [ ] **Step 3: Route direct and invitation delivery explicitly**

  Replace the existing `discoverLinkedInComposeHref` execution in `sendLinkedInTestMessage` with `discoverLinkedInDeliveryPath(payload.profileUrl, payload.message)`.

  ```js
  if (discovery.delivery === "direct") {
    await chrome.tabs.update(tab.id, {
      url: new URL(discovery.composeHref, "https://www.linkedin.com").href,
    });
    await waitForTabLoad(tab.id);
    // execute sendLinkedInComposeMessage with profile URL, recipient id, and message
  } else if (discovery.delivery === "invitation") {
    // execute sendLinkedInInvitationNote in the already loaded profile tab
  } else {
    return { ...discovery, at: new Date().toISOString() };
  }
  ```

  Preserve the existing structured script-execution errors, run logs, timestamp injection, and batch result reporting. Add run-log text that distinguishes `direct message` from `connection invitation` without logging the message content.

- [ ] **Step 4: Verify exact reason preservation and regressions**

  Run:

  ```bash
  node --test test/result-reporting.test.mjs test/linkedin-send.test.mjs
  npm test
  git diff --check
  ```

  Expected: the invitation over-limit reason appears exactly in the projected result; full Node suite passes with no whitespace errors.

- [ ] **Step 5: Commit queue routing and reporting coverage**

  ```bash
  git add extension/background.js test/linkedin-send.test.mjs test/result-reporting.test.mjs
  git commit -m "feat(extension): route LinkedIn invitations safely"
  ```

### Task 4: Live validation and release evidence

**Files:**
- Modify: `test/e2e/linkedin-manual-send.live.spec.mjs` only if a separately authorized connection-invitation test profile is available.
- Verify: `playwright.live.config.mjs`, `test/e2e/linkedin-extension-fixture.mjs`, `extension/linkedin-send.js`, `extension/background.js`

**Interfaces:**
- Consumes: completed direct/invitation sender paths and the existing explicit `LIVE_LINKEDIN_E2E=1` guard.
- Produces: evidence for the existing real direct-message flow and, if authorized, one real invitation-note flow that does not target Alex Hormozi.

- [ ] **Step 1: Run offline final verification**

  Run: `npm test`

  Expected: PASS without starting Chromium or accessing LinkedIn.

- [ ] **Step 2: Re-run the existing authorized Brice direct-message matrix**

  Run:

  ```bash
  LIVE_LINKEDIN_E2E=1 PLAYWRIGHT_LINKEDIN_PROFILE_DIR=/Users/albanpro/claude-code-perso/work/cold-dm-extension-manual-platform-send-2026-08-04/.playwright-linkedin-profile npm run test:e2e:linkedin
  ```

  Expected: all configured desktop viewport projects pass, proving direct delivery did not regress.

- [ ] **Step 3: Add and run an invitation live test only after explicit recipient authorization**

  Use a dedicated non-connected test profile, a unique note of at most 200 characters, and the same exact-profile guard. Assert a visible LinkedIn confirmation/state that the invitation was sent. Do not use `alexhormozi` or any non-authorized real profile.

- [ ] **Step 4: Review final state and commit any authorized live-test addition**

  Run: `git status --short && git log --oneline -6`

  Expected: clean worktree after the focused commits; retain any unauthorised live invitation test as a documented validation gap rather than faking a send.

