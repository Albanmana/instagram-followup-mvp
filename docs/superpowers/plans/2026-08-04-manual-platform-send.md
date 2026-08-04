# Manual Platform Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator test a single Instagram or LinkedIn DM from the extension with a URL or handle and a custom message, without connecting to Cold DM.

**Architecture:** Convert the manual form into one normalized, `localOnly` batch row and submit it to the existing `START_BATCH` engine. The background records its terminal entry in a local manual-test history and never queues a claim or result report for that row; queue behavior remains unchanged.

**Tech Stack:** Manifest V3 Chrome extension, vanilla ES modules, Node built-in test runner.

## Global Constraints

- The manual panel is collapsed by default and reachable on the unauthenticated welcome screen and the normal Today screen.
- Supported platforms are Instagram and LinkedIn; the selected platform controls target normalization and the existing adapter validation.
- The only required form values are a recipient URL/handle and a message.
- A manual test never calls the Cold DM queue, claim, or results APIs, even when credentials are stored.
- Manual outcomes remain in local extension history and are visibly labeled `Manual test`.

---

### Task 1: Normalize and identify a manual row

**Files:**
- Modify: `extension/platforms.js`
- Test: `test/platforms.test.mjs`

**Interfaces:**
- Produces `createManualTestItem({ platform, target, message, now, id })`, returning a queue-compatible row with `localOnly: true` or a user-facing validation error.
- Produces `manualTestHistoryEntry(batchLog)` for a local history row with recipient, platform, message type, status, reason, and timestamp.

- [ ] **Step 1: Write failing tests** for Instagram handles, Instagram profile URLs, LinkedIn slugs, LinkedIn profile URLs, platform mismatches, blank messages, and the `localOnly` marker.
- [ ] **Step 2: Run** `node --test test/platforms.test.mjs` and confirm the new tests fail because the helpers are unavailable.
- [ ] **Step 3: Implement** strict platform-aware parsing: derive a canonical Instagram profile URL and handle from either input; derive a canonical `/in/<slug>/` LinkedIn URL from either input; trim message text; generate local IDs; and reject incompatible or malformed inputs before a batch can start.
- [ ] **Step 4: Run** `node --test test/platforms.test.mjs` and confirm the new tests pass.

### Task 2: Keep manual execution and history local

**Files:**
- Modify: `extension/background.js`, `extension/api-client.js`
- Test: `test/result-reporting.test.mjs`, `test/sidepanel.test.mjs`

**Interfaces:**
- Consumes rows marked `localOnly: true` by Task 1.
- Produces `manualTestHistory` storage entries and a `getManualTestHistory()` API-client method.

- [ ] **Step 1: Write failing tests** showing a local-only terminal batch log is retained in local manual history and is not enqueued for result reporting, while a normal queue row still is.
- [ ] **Step 2: Run** the focused result-reporting and side-panel tests and confirm the assertions fail before implementation.
- [ ] **Step 3: Implement** a guarded reporting path that skips `reportBatchLog` for `localOnly` rows, appends their outcome to a capped local history, and exposes that history without Cold DM credentials.
- [ ] **Step 4: Run** the focused tests and confirm they pass.

### Task 3: Add the collapsed manual-test panel and submit path

**Files:**
- Modify: `extension/sidepanel.html`, `extension/sidepanel.css`, `extension/sidepanel.js`
- Test: `test/sidepanel.test.mjs`

**Interfaces:**
- Consumes `createManualTestItem()` and `START_BATCH`.
- Consumes local history through `getManualTestHistory()`.
- Produces an accessible collapsed `Manual test` form available before and after Cold DM connection.

- [ ] **Step 1: Write failing UI tests** for panel availability with no API key, a successful form submission that sends one `localOnly` row directly to `START_BATCH`, invalid-input feedback, session/capability errors, and a history label for manual outcomes.
- [ ] **Step 2: Run** `node --test test/sidepanel.test.mjs` and confirm the new cases fail.
- [ ] **Step 3: Implement** the collapsed form with selected platform, target, message, Send button, inline validation, and disabled/busy behavior; reuse the capability/login gate but bypass queue refresh and claim; merge manually stored rows into History under `Manual test`.
- [ ] **Step 4: Run** `node --test test/sidepanel.test.mjs` and confirm the new cases pass.

### Task 4: Regression validation

**Files:**
- Verify: `test/*.test.mjs`, `extension/manifest.json`

- [ ] **Step 1: Run** `npm test` to cover all extension modules.
- [ ] **Step 2: Run** `node --check extension/sidepanel.js && node --check extension/background.js && node --check extension/platforms.js` and parse `extension/manifest.json`.
- [ ] **Step 3: Review** `git diff --check` and the targeted diff to ensure no queue/API contract or unrelated LinkedIn behavior changed.
