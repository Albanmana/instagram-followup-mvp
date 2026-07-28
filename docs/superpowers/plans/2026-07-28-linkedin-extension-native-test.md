# LinkedIn Extension-Native Send Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a developer-triggered LinkedIn direct-message test that runs through the extension service worker and the same injected page code intended for Phase 2 queue execution.

**Architecture:** A runtime message calls a service-worker orchestrator with `{ profileUrl, message }`. The orchestrator opens the canonical profile URL, injects a self-contained profile step to obtain the real Message compose href, navigates to it, then injects a self-contained compose step that validates the recipient, enters the text, sends, and verifies the visible sent state. It never calls the Cold DM App queue, claim, or result APIs.

**Tech Stack:** Manifest V3 service worker, `chrome.tabs`, `chrome.scripting.executeScript`, DOM APIs, Node built-in test runner.

## Global Constraints

- Support only already-connected LinkedIn recipients whose profile exposes a `Message` link to `/messaging/compose/`.
- Do not depend on Codex browser APIs, DevTools node IDs, static LinkedIn Ember IDs, or manual inbox state.
- The runtime test message is temporary and must not be reachable from the normal queue/batch start path.
- Do not add UI, dependencies, new permissions, queue claims, or Cold DM App result calls.
- A missing Message link, recipient mismatch, unavailable composer, disabled Send button, or failed post-send verification returns a structured `skipped` or `failed` outcome and never attempts a connection invitation.
- Keep the Phase 1 LinkedIn adapter unavailable for normal batch execution until this test is manually verified.

---

## File structure

```
extension/
├── linkedin-send.js       self-contained injected steps plus pure URL/payload helpers
├── background.js          developer test runtime route and tab orchestration
└── manifest.json          unchanged: existing LinkedIn and scripting permissions suffice
test/
└── linkedin-send.test.mjs pure payload, URL, and outcome-classification tests
```

### Task 1: Define the LinkedIn test protocol and pure input guards

**Files:**
- Create: `extension/linkedin-send.js`
- Create: `test/linkedin-send.test.mjs`

**Interfaces:**
- Produces `validateLinkedInTestPayload(payload)`, returning `{ profileUrl, message }` or throwing a specific `Error`.
- Produces `isLinkedInProfileUrl(value)` and `isLinkedInComposeHref(value)`.
- Produces `profileIdentityFromUrl(value)`, a normalized path identity used only to compare expected and visible profile links.
- Produces `classifyLinkedInUnavailable(reason)`, returning `{ status: "skipped", reason, at }`.

- [ ] **Step 1: Write the failing protocol tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLinkedInTestPayload,
  isLinkedInComposeHref,
  profileIdentityFromUrl,
} from "../extension/linkedin-send.js";

test("accepts a canonical LinkedIn profile and non-empty message", () => {
  assert.deepEqual(validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/in/brice-biaou-32387b156/",
    message: "Test",
  }), {
    profileUrl: "https://www.linkedin.com/in/brice-biaou-32387b156/",
    message: "Test",
  });
});

test("rejects non-profile URLs and blank messages", () => {
  assert.throws(() => validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/messaging/",
    message: "Test",
  }), /LinkedIn profile URL/);
  assert.throws(() => validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/in/alice/",
    message: "   ",
  }), /message is required/);
});

test("recognizes only LinkedIn compose hrefs and normalizes profile identity", () => {
  assert.equal(isLinkedInComposeHref("/messaging/compose/?recipient=abc"), true);
  assert.equal(isLinkedInComposeHref("/messaging/?recipient=abc"), false);
  assert.equal(
    profileIdentityFromUrl("https://www.linkedin.com/in/alice/?trk=foo"),
    "/in/alice"
  );
});
```

- [ ] **Step 2: Run the targeted test to prove it fails**

Run: `node --test test/linkedin-send.test.mjs`

Expected: module-resolution failure for `extension/linkedin-send.js`.

- [ ] **Step 3: Implement the pure helpers**

```js
export function isLinkedInProfileUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") === "linkedin.com"
      && /^\/in\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isLinkedInComposeHref(value) {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    return url.pathname === "/messaging/compose/" && Boolean(url.searchParams.get("recipient"));
  } catch {
    return false;
  }
}

export function profileIdentityFromUrl(value) {
  const url = new URL(value);
  return url.pathname.replace(/\/$/, "").toLowerCase();
}

export function validateLinkedInTestPayload(payload) {
  const profileUrl = String(payload?.profileUrl ?? "").trim();
  const message = String(payload?.message ?? "").trim();
  if (!isLinkedInProfileUrl(profileUrl)) throw new Error("A canonical LinkedIn profile URL is required.");
  if (!message) throw new Error("A LinkedIn test message is required.");
  return { profileUrl, message };
}
```

- [ ] **Step 4: Re-run the targeted tests**

Run: `node --test test/linkedin-send.test.mjs`

Expected: all tests pass.

- [ ] **Step 5: Commit the protocol boundary**

```bash
git add extension/linkedin-send.js test/linkedin-send.test.mjs
git commit -m "feat(extension): add LinkedIn send test protocol"
```

### Task 2: Implement self-contained injected profile and compose steps

**Files:**
- Modify: `extension/linkedin-send.js`
- Modify: `test/linkedin-send.test.mjs`

**Interfaces:**
- Produces `discoverLinkedInComposeHref(expectedProfileUrl)`, safe for direct use as `chrome.scripting.executeScript({ func })`; it returns `{ status: "ready", composeHref }` or `{ status: "skipped", reason }`.
- Produces `sendLinkedInComposeMessage(expectedProfileUrl, message)`, safe for direct injection; it returns `{ status: "sent", sentText }`, `{ status: "skipped", reason }`, or `{ status: "failed", reason }`.
- Each injected function is self-contained: it references only its arguments and browser DOM globals.

- [ ] **Step 1: Add failure-classification tests for deterministic helper behavior**

```js
import { classifyLinkedInUnavailable } from "../extension/linkedin-send.js";

test("classifies missing direct messaging as skipped", () => {
  const outcome = classifyLinkedInUnavailable("LinkedIn Message action is unavailable for this profile.");
  assert.equal(outcome.status, "skipped");
  assert.match(outcome.reason, /Message action/);
  assert.ok(outcome.at);
});
```

- [ ] **Step 2: Run the test to prove the missing export fails**

Run: `node --test test/linkedin-send.test.mjs`

Expected: failure that `classifyLinkedInUnavailable` is not exported.

- [ ] **Step 3: Implement injected page functions with observed selectors**

Use only these observed contracts:

```js
// Profile page
[...document.querySelectorAll("a")].find((anchor) =>
  anchor.textContent?.trim() === "Message" &&
  anchor.getAttribute("href")?.startsWith("/messaging/compose/")
);

// Compose page
document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Write a message…"]');
document.querySelector('button[type="submit"]:not([disabled])');
document.querySelector('a[href*="/in/"]');
```

The compose function must set selection to the composer end, call
`document.execCommand("insertText", false, message)`, dispatch a bubbling
`InputEvent("input", { inputType: "insertText", data: message })` if needed,
then wait up to 8 seconds for the enabled Send button. After `click()`, it
waits up to 8 seconds for both an empty composer and visible text equal to the
message before returning `sent`.

- [ ] **Step 4: Run the targeted tests**

Run: `node --test test/linkedin-send.test.mjs`

Expected: all helper and outcome tests pass.

- [ ] **Step 5: Commit page-step implementation**

```bash
git add extension/linkedin-send.js test/linkedin-send.test.mjs
git commit -m "feat(extension): add injected LinkedIn send steps"
```

### Task 3: Orchestrate the test with the extension service worker

**Files:**
- Modify: `extension/background.js`
- Modify: `test/linkedin-send.test.mjs`

**Interfaces:**
- Adds `sendLinkedInTestMessage(payload)`, returning the structured outcome from the injected steps.
- Handles `chrome.runtime` message type `SEND_LINKEDIN_TEST_MESSAGE` and returns `{ ok: true, result }` or `{ ok: false, error }`.
- Reuses the existing `waitForTabLoad`, `appendRunLog`, and `clearRunLogs` patterns.

- [ ] **Step 1: Add an exported orchestration seam or dependency-injected helper test**

```js
test("does not classify an invalid LinkedIn test payload as sent", async () => {
  await assert.rejects(
    () => validateLinkedInTestPayload({ profileUrl: "https://linkedin.com/feed/", message: "Test" }),
    /profile URL/
  );
});
```

- [ ] **Step 2: Run the complete LinkedIn test file before editing the worker**

Run: `node --test test/linkedin-send.test.mjs`

Expected: current Task 1 and Task 2 tests pass; the worker behavior is not yet present.

- [ ] **Step 3: Implement the worker sequence**

```js
const payload = validateLinkedInTestPayload(rawPayload);
const tab = await chrome.tabs.create({ url: payload.profileUrl, active: true });
await waitForTabLoad(tab.id);

const [{ result: discovery }] = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: discoverLinkedInComposeHref,
  args: [payload.profileUrl],
});
if (discovery.status !== "ready") return discovery;

await chrome.tabs.update(tab.id, { url: new URL(discovery.composeHref, "https://www.linkedin.com").href });
await waitForTabLoad(tab.id);

const [{ result }] = await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: sendLinkedInComposeMessage,
  args: [payload.profileUrl, payload.message],
});
return { ...result, at: new Date().toISOString() };
```

Record stage logs without including the full message body. Convert scripting
API failures into `{ status: "failed", reason, at }` rather than letting a
message listener time out.

- [ ] **Step 4: Run syntax and full automated tests**

Run:

```bash
node --check extension/background.js
node --check extension/linkedin-send.js
node --test test/*.test.mjs
```

Expected: syntax checks exit 0 and all test files pass.

- [ ] **Step 5: Commit worker orchestration**

```bash
git add extension/background.js extension/linkedin-send.js test/linkedin-send.test.mjs
git commit -m "feat(extension): run native LinkedIn send test"
```

### Task 4: Perform the supervised extension acceptance test

**Files:**
- Modify: none unless a discovered LinkedIn DOM mismatch requires a focused regression test and fix.

**Interfaces:**
- Trigger the test from the extension service-worker console:

```js
chrome.runtime.sendMessage({
  type: "SEND_LINKEDIN_TEST_MESSAGE",
  payload: {
    profileUrl: "https://www.linkedin.com/in/brice-biaou-32387b156/",
    message: "Test extension-native LinkedIn",
  },
}, console.log);
```

- [ ] **Step 1: Reload the unpacked extension from the worktree’s `extension/` directory**

Expected: manifest loads without errors and the service worker is active.

- [ ] **Step 2: Send the exact runtime message above from the extension service-worker console**

Expected: a single new LinkedIn tab opens at Brice’s profile, then transitions to its compose route.

- [ ] **Step 3: Verify the structured response and UI outcome**

Expected: `{ ok: true, result: { status: "sent", sentText: "Test extension-native LinkedIn", ... } }`, the message appears once in Brice’s conversation, and no queue claim or Cold DM App result request occurs.

- [ ] **Step 4: Run final local verification**

Run:

```bash
git status --short
node --check extension/background.js
node --check extension/linkedin-send.js
node --test test/*.test.mjs
```

Expected: no unintended changes, syntax checks exit 0, and all tests pass.

- [ ] **Step 5: Commit any focused acceptance-test regression fix**

```bash
git add extension/linkedin-send.js extension/background.js test/linkedin-send.test.mjs
git commit -m "fix(extension): stabilize LinkedIn native send test"
```

## Plan self-review

- Spec coverage: Tasks 1–3 cover the extension-only protocol, injected profile and compose flow, structured outcomes, worker logging, and zero queue/App mutations. Task 4 covers the supervised authenticated LinkedIn run.
- Scope: The plan adds no side-panel UI, no new permissions, no normal LinkedIn batch execution, and no invitation/InMail behavior.
- Type consistency: The same `{ profileUrl, message }` input and `{ status, reason?, at }` result are used by the runtime message, worker, and injected steps.
- No placeholders: every file, function, selector, test command, and manual trigger is specified.
