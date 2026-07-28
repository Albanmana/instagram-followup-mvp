# LinkedIn Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cold DM Sender platform-aware, with a safely viewable but non-executable LinkedIn queue, while retaining the current Instagram sending capability and removing active n8n sender paths.

**Architecture:** The API client requests one platform-filtered queue at a time. A platform-neutral batch engine delegates sending to platform adapters; Instagram remains executable and LinkedIn reports an unavailable capability until the separate Computer Use project. The side panel persists the selected platform and never claims or starts a LinkedIn batch in this phase.

**Tech Stack:** Chrome Extension Manifest V3, ES modules, Chrome storage/alarms/cookies/scripting APIs, vanilla HTML/CSS/JS, Node built-in test runner.

## Global Constraints

- Implement Phase 1 only: do not automate a LinkedIn browser interaction, connection invitation, InMail, or LinkedIn scraping.
- One running or resumable batch owns one platform; the UI must disable platform changes until it has ended or been discarded.
- The Cold DM App API is the only sender queue and result authority; no n8n endpoint is allowed in active sender code.
- LinkedIn selection fetches and displays due work but must not call the claim endpoint, `START_BATCH`, or the result endpoint.
- Preserve current Instagram queue behavior and its existing browser send sequence.
- Retain `extension/archive/` as history; do not load archived UI or CRM scripts through the active manifest.
- Keep active scraper behavior out of scope and do not alter its product behavior.
- Do not add dependencies; use `node --test`, `node --check`, JSON parsing, and manual Chrome validation.

---

## File structure

```
extension/
├── platforms.js                 pure platform labels, queue normalization, recipient labels
├── platform-adapters.js         adapter registry and phase-1 LinkedIn capability
├── batch-validation.js          pure one-platform batch guard
├── background.js                neutral batch engine + Instagram adapter bridge
├── api-client.js                platform-filtered Cold DM queue/claim client
├── sidepanel.html/css/js        explicit platform selector and platform-aware rendering
└── manifest.json                LinkedIn host permission; no active CRM injection
test/
├── platforms.test.mjs           pure queue and display normalization tests
├── platform-adapters.test.mjs   adapter capability and validation tests
└── api-client.test.mjs          queue and claim platform request tests
```

The Cold DM App changes named in the validated design are a prerequisite external contract. They do not belong in this repository or this implementation plan.

---

### Task 1: Define platform-neutral queue data and display helpers

**Files:**
- Create: `extension/platforms.js`
- Test: `test/platforms.test.mjs`

**Interfaces:**
- Produces `PLATFORMS`, `isPlatform(value)`, `platformLabel(platform)`, `normalizeQueueItem(item, campaign)`, `recipientLabel(item)`, and `legacyInstagramProfileUrl(handle)`.
- `normalizeQueueItem` returns `null` unless `actionId`, `messageId`, `leadId`, `message`, a valid platform, and `recipient.profileUrl` are present.
- A legacy item without `platform` is normalized as Instagram only when it has a non-empty `handle`.

- [ ] **Step 1: Write the failing pure-module tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeQueueItem,
  recipientLabel,
  legacyInstagramProfileUrl,
} from "../extension/platforms.js";

const campaign = { id: "campaign-1", name: "Campaign" };

test("normalizes a LinkedIn item with a canonical profile URL", () => {
  const item = normalizeQueueItem({
    actionId: "action-1", messageId: "message-1", leadId: "lead-1",
    platform: "linkedin", profileUrl: "https://www.linkedin.com/in/alice/",
    displayName: "Alice Martin", handle: "alice", message: "Hello",
    messageType: "first_dm",
  }, campaign);
  assert.deepEqual(item.recipient, {
    displayName: "Alice Martin",
    profileUrl: "https://www.linkedin.com/in/alice/",
    handle: "alice",
  });
  assert.equal(recipientLabel(item), "Alice Martin");
});

test("does not prefix a LinkedIn fallback label with at-sign", () => {
  const item = normalizeQueueItem({
    actionId: "action-1", messageId: "message-1", leadId: "lead-1",
    platform: "linkedin", profileUrl: "https://www.linkedin.com/in/alice/",
    displayName: null, handle: "alice", message: "Hello", messageType: "first_dm",
  }, campaign);
  assert.equal(recipientLabel(item), "alice");
});

test("migrates a legacy Instagram row only when it has a handle", () => {
  const item = normalizeQueueItem({
    actionId: "action-1", messageId: "message-1", leadId: "lead-1",
    handle: "cold.dm", message: "Hello", messageType: "first_dm",
  }, campaign);
  assert.equal(item.platform, "instagram");
  assert.equal(item.recipient.profileUrl, legacyInstagramProfileUrl("cold.dm"));
  assert.equal(normalizeQueueItem({ message: "Hello" }, campaign), null);
});
```

- [ ] **Step 2: Run the tests to confirm the missing module fails**

Run: `node --test test/platforms.test.mjs`

Expected: failure resolving `extension/platforms.js`.

- [ ] **Step 3: Implement the helpers**

```js
export const PLATFORMS = ["instagram", "linkedin"];

export function isPlatform(value) {
  return PLATFORMS.includes(value);
}

export function legacyInstagramProfileUrl(handle) {
  return `https://www.instagram.com/${encodeURIComponent(handle.replace(/^@+/, ""))}/`;
}

export function normalizeQueueItem(raw, campaign = null) {
  const platform = isPlatform(raw?.platform)
    ? raw.platform
    : raw?.handle ? "instagram" : null;
  const profileUrl = raw?.recipient?.profileUrl ?? raw?.profileUrl
    ?? (platform === "instagram" && raw?.handle ? legacyInstagramProfileUrl(raw.handle) : null);
  if (!platform || !profileUrl || !raw?.actionId || !raw?.messageId || !raw?.leadId || !raw?.message) return null;
  return {
    actionId: raw.actionId, messageId: raw.messageId, leadId: raw.leadId,
    campaign: raw.campaign ?? campaign,
    platform, message: raw.message,
    messageType: raw.messageType === "followup" ? "followup" : "first_dm",
    recipient: {
      displayName: raw?.recipient?.displayName ?? raw?.displayName ?? null,
      profileUrl,
      handle: raw?.recipient?.handle ?? raw?.handle ?? null,
    },
  };
}

export function recipientLabel(item) {
  if (item.platform === "linkedin") return item.recipient.displayName || item.recipient.handle || item.recipient.profileUrl;
  return item.recipient.handle ? `@${item.recipient.handle.replace(/^@+/, "")}` : item.recipient.displayName || item.recipient.profileUrl;
}
```

- [ ] **Step 4: Run the new test file**

Run: `node --test test/platforms.test.mjs`

Expected: all three tests pass.

- [ ] **Step 5: Commit the focused data-contract change**

```bash
git add extension/platforms.js test/platforms.test.mjs
git commit -m "feat(extension): normalize platform queue items"
```

### Task 2: Add the platform adapter registry and phase-1 LinkedIn guard

**Files:**
- Create: `extension/platform-adapters.js`
- Test: `test/platform-adapters.test.mjs`

**Interfaces:**
- Consumes `isPlatform` from `platforms.js`.
- Produces `createPlatformAdapters({ sendInstagramMessage, getInstagramSession })` and `getPlatformAdapter(adapters, platform)`.
- The Instagram adapter validates an Instagram URL and delegates to `sendInstagramMessage(item)`.
- The LinkedIn adapter validates a LinkedIn profile URL but returns `{ ok: false, reason: "LinkedIn sending is being prepared." }` from `canExecute`.

- [ ] **Step 1: Write adapter behavior tests**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformAdapters, getPlatformAdapter } from "../extension/platform-adapters.js";

const linkedInItem = {
  platform: "linkedin",
  recipient: { profileUrl: "https://www.linkedin.com/in/alice/", displayName: "Alice", handle: "alice" },
};

test("LinkedIn is recognized but cannot execute in phase 1", async () => {
  const adapters = createPlatformAdapters({
    sendInstagramMessage: async () => ({ status: "sent", at: "2026-07-28T10:00:00.000Z" }),
    getInstagramSession: async () => true,
  });
  const adapter = getPlatformAdapter(adapters, "linkedin");
  assert.equal(adapter.validateItem(linkedInItem), null);
  assert.deepEqual(adapter.canExecute(), { ok: false, reason: "LinkedIn sending is being prepared." });
});

test("Instagram delegates only valid Instagram destinations", async () => {
  let called = false;
  const adapters = createPlatformAdapters({
    sendInstagramMessage: async () => { called = true; return { status: "sent", at: "2026-07-28T10:00:00.000Z" }; },
    getInstagramSession: async () => true,
  });
  const adapter = getPlatformAdapter(adapters, "instagram");
  assert.equal(adapter.validateItem({ platform: "instagram", recipient: { profileUrl: "https://www.instagram.com/alice/" } }), null);
  await adapter.send({ platform: "instagram", recipient: { profileUrl: "https://www.instagram.com/alice/" } });
  assert.equal(called, true);
});
```

- [ ] **Step 2: Run the tests to confirm the missing module fails**

Run: `node --test test/platform-adapters.test.mjs`

Expected: failure resolving `extension/platform-adapters.js`.

- [ ] **Step 3: Implement the registry**

```js
function isAllowedProfileUrl(value, hostname) {
  try { return new URL(value).hostname.replace(/^www\./, "") === hostname; }
  catch { return false; }
}

export function createPlatformAdapters({ sendInstagramMessage, getInstagramSession }) {
  return {
    instagram: {
      platform: "instagram",
      isLoggedIn: getInstagramSession,
      getLoginMessage: () => "Log in to Instagram in this browser, then resume.",
      canExecute: () => ({ ok: true }),
      validateItem: (item) => isAllowedProfileUrl(item?.recipient?.profileUrl, "instagram.com") ? null : "Instagram profile URL is required.",
      send: sendInstagramMessage,
    },
    linkedin: {
      platform: "linkedin",
      isLoggedIn: async () => false,
      getLoginMessage: () => "Log in to LinkedIn in this browser, then resume.",
      canExecute: () => ({ ok: false, reason: "LinkedIn sending is being prepared." }),
      validateItem: (item) => isAllowedProfileUrl(item?.recipient?.profileUrl, "linkedin.com") ? null : "LinkedIn profile URL is required.",
      send: async () => ({ status: "skipped", reason: "LinkedIn sending is being prepared.", at: new Date().toISOString() }),
    },
  };
}

export function getPlatformAdapter(adapters, platform) {
  return adapters[platform] ?? null;
}
```

- [ ] **Step 4: Run the adapter test file**

Run: `node --test test/platform-adapters.test.mjs`

Expected: both tests pass.

- [ ] **Step 5: Commit the adapter boundary**

```bash
git add extension/platform-adapters.js test/platform-adapters.test.mjs
git commit -m "feat(extension): add platform adapter registry"
```

### Task 3: Make the Cold DM API bridge platform-filtered

**Files:**
- Modify: `extension/api-client.js`
- Modify: `test/api-client.test.mjs`

**Interfaces:**
- `fetchQueue(platform)` sends `GET /api/ext/v1/queue?platform=<platform>` in live mode and returns normalized items for that platform only.
- `claimQueue(items, platform)` sends `{ actionIds, platform }`.
- Mock mode exposes one valid item for the requested platform, including the required recipient fields.

- [ ] **Step 1: Add failing queue and claim request tests**

```js
test("fetchQueue requests and preserves the selected platform", async () => {
  const requests = [];
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async (url, options = {}) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ campaigns: [{ campaign: { id: "campaign-1", name: "Campaign" }, items: [{
        actionId: "action-1", messageId: "message-1", leadId: "lead-1", platform: "linkedin",
        profileUrl: "https://www.linkedin.com/in/alice/", displayName: "Alice", handle: "alice",
        message: "Hello", messageType: "first_dm",
      }] }] }), { status: 200 });
    },
  });
  const queue = await api.fetchQueue("linkedin");
  assert.match(requests[0].url, /\/api\/ext\/v1\/queue\?platform=linkedin$/);
  assert.equal(queue.items[0].platform, "linkedin");
  assert.equal(queue.items[0].recipient.profileUrl, "https://www.linkedin.com/in/alice/");
});

test("claimQueue sends the selected platform", async () => {
  let body;
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ claimed: ["action-1"], skipped: [] }), { status: 200 }); },
  });
  await api.claimQueue([{ actionId: "action-1" }], "instagram");
  assert.deepEqual(body, { actionIds: ["action-1"], platform: "instagram" });
});
```

- [ ] **Step 2: Run the API tests to confirm they fail**

Run: `node --test test/api-client.test.mjs`

Expected: the new assertions fail because the client neither accepts nor sends a platform.

- [ ] **Step 3: Implement query construction and normalization**

Import `isPlatform` and `normalizeQueueItem` from `platforms.js`. Reject invalid platform arguments before any request. Build the URL with `new URLSearchParams({ platform })`; normalize every returned item using its campaign and discard invalid or mismatched-platform rows. Include `platform` in the claim JSON body. Preserve result reporting unchanged, except store `platform` when the engine supplies it.

- [ ] **Step 4: Run the full API test suite**

Run: `node --test test/api-client.test.mjs`

Expected: all existing tests and both new platform request tests pass.

- [ ] **Step 5: Commit the API bridge**

```bash
git add extension/api-client.js test/api-client.test.mjs
git commit -m "feat(extension): request queues by platform"
```

### Task 4: Refactor the active sender engine around adapters

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`
- Test: `test/platform-adapters.test.mjs`

**Interfaces:**
- The manifest service worker is an ES module so `background.js` can import the adapter registry.
- `START_BATCH` receives rows with one common `platform`; it rejects empty, mixed-platform, invalid-destination, or unavailable-adapter batches.
- `GET_PLATFORM_CAPABILITY` receives `{ platform }` and returns `{ ok, platform, executable, reason?, loggedIn, loginMessage }` without changing remote state.
- `COLD_DM_BATCH_NEXT` replaces `IG_BATCH_NEXT` for the active sender batch.

- [ ] **Step 1: Add the failing mixed-batch and unavailable capability tests**

Extend `test/platform-adapters.test.mjs` with pure helpers exported from `background.js` through a new `extension/batch-validation.js` module:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateBatchRows } from "../extension/batch-validation.js";

test("rejects a mixed-platform batch", () => {
  assert.equal(validateBatchRows([{ platform: "instagram" }, { platform: "linkedin" }]), "A sender run must use one platform.");
});

test("accepts a single-platform batch", () => {
  assert.equal(validateBatchRows([{ platform: "instagram" }, { platform: "instagram" }]), null);
});
```

- [ ] **Step 2: Run the tests to confirm the helper is missing**

Run: `node --test test/platform-adapters.test.mjs`

Expected: failure resolving `extension/batch-validation.js`.

- [ ] **Step 3: Create the pure batch validator and module-enable the worker**

```js
export function validateBatchRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "No sender actions were provided.";
  const platforms = new Set(rows.map((row) => row.platform));
  return platforms.size === 1 ? null : "A sender run must use one platform.";
}
```

Set `"type": "module"` in the manifest `background` object. Import `createPlatformAdapters`, `getPlatformAdapter`, and `validateBatchRows` from the new modules.

- [ ] **Step 4: Preserve Instagram while moving engine ownership**

Rename `sendTestMessage` to `sendInstagramMessage` and keep its browser-injection sequence intact. Build adapters once with:

```js
const adapters = createPlatformAdapters({
  sendInstagramMessage,
  getInstagramSession: async () => Boolean(await chrome.cookies.get({
    url: "https://www.instagram.com", name: "sessionid",
  })),
});
```

In `processBatchItem`, resolve `getPlatformAdapter(adapters, row.platform)`, validate the row, then call `adapter.send(row)`. Store `{ platform, recipient, ...existingLogFields }` in every batch log. Map an adapter `skipped` outcome to batch-log status `skipped`; do not convert it to an error.

- [ ] **Step 5: Replace active Instagram batch names and expose capability**

Replace every active sender use of `IG_BATCH_NEXT` with `COLD_DM_BATCH_NEXT`, including start, stop, scheduling, and alarm handling. Do not rename scraper-specific behavior. Add the following message handler before `START_BATCH`:

```js
if (message?.type === "GET_PLATFORM_CAPABILITY") {
  const adapter = getPlatformAdapter(adapters, message.platform);
  if (!adapter) { sendResponse({ ok: false, error: "Unsupported platform." }); return false; }
  const capability = adapter.canExecute();
  adapter.isLoggedIn().then((loggedIn) => sendResponse({
    ok: true, platform: adapter.platform, executable: capability.ok,
    reason: capability.reason, loggedIn, loginMessage: adapter.getLoginMessage(),
  }));
  return true;
}
```

`START_BATCH` must call `validateBatchRows`, require an executable adapter, and reject a LinkedIn run before storage is written. `GET_BATCH_STATUS` continues returning persisted state for an interrupted Instagram run.

- [ ] **Step 6: Remove active n8n sender paths without touching scraper behavior**

Remove from `background.js`:

- `DEFAULT_CRM_UPDATE_URL`, `DEFAULT_AUTO_FETCH_URL`, `DEFAULT_MARK_DONE_URL`, and the n8n API-key fallback;
- `runAutoFetch`, `runCrmSync`, CRM processing/logging/decryption helpers, `callMarkDone`, and their message handlers;
- `IG_AUTO_FETCH` and `IG_CRM_SYNC` alarm handling and startup registration;
- the call to `callMarkDone` after a successful sender action.

Remove `crm-hook.js` and `crm-interceptor.js` from active `content_scripts` in `manifest.json`; retain the scraper content scripts. Add `https://www.linkedin.com/*` to `host_permissions`. Keep the existing broad API permission only until the Cold DM App’s production host can be explicitly declared in a separate permissions hardening task.

- [ ] **Step 7: Run focused automated and syntax checks**

Run:

```bash
node --test test/platforms.test.mjs test/platform-adapters.test.mjs
node --check extension/background.js
node -e 'JSON.parse(require("node:fs").readFileSync("extension/manifest.json", "utf8")); console.log("manifest ok")'
rg -n -i 'DEFAULT_N8N|n8n\.srv|IG_AUTO_FETCH|IG_CRM_SYNC|callMarkDone|TRIGGER_AUTO_FETCH|CRM_INBOX_DATA' extension/background.js extension/manifest.json
```

Expected: tests and syntax/manifest checks pass; the final search has no matches.

- [ ] **Step 8: Commit the engine migration**

```bash
git add extension/background.js extension/manifest.json extension/batch-validation.js test/platform-adapters.test.mjs
git commit -m "refactor(extension): make sender batch platform-aware"
```

### Task 5: Add platform selection and safe LinkedIn queue rendering

**Files:**
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.css`
- Modify: `extension/sidepanel.js`

**Interfaces:**
- Storage key `selectedPlatform` stores `instagram` by default and only accepts `instagram` or `linkedin`.
- `api.fetchQueue(selectedPlatform)` is the only queue refresh call.
- The panel queries `GET_PLATFORM_CAPABILITY` before enabling Start.
- LinkedIn can render an empty or non-empty queue but must never invoke `claimQueue`, `START_BATCH`, or `reportResults` in Phase 1.

- [ ] **Step 1: Add selector markup and the unavailable state**

Place the selector above the queue toolbar:

```html
<label class="field platform-picker" for="platform-select">
  <span class="label">Platform</span>
  <select id="platform-select">
    <option value="instagram">Instagram</option>
    <option value="linkedin">LinkedIn</option>
  </select>
</label>
<p id="platform-capability" class="muted" hidden></p>
```

Add focused CSS so the selector spans the panel width and has the existing form-field appearance. Do not introduce a platform brand colour, logo, or a second navigation model.

- [ ] **Step 2: Persist and apply the selected platform**

Add `selectedPlatform: "instagram"` to initial panel state. Read/write it through `chrome.storage.local`; invalid stored values fall back to `instagram`. On selector change, clear the displayed queue, reset the capability text, and call `refreshToday()`.

Create helpers:

```js
function selectedPlatform() { return state.selectedPlatform; }
function setPlatformControlsDisabled(disabled) {
  $("platform-select").disabled = disabled;
}
async function getPlatformCapability(platform) {
  return chrome.runtime.sendMessage({ type: "GET_PLATFORM_CAPABILITY", platform });
}
```

- [ ] **Step 3: Make recipient and copy rendering platform-aware**

Import `recipientLabel` and `platformLabel` from `platforms.js`. Replace every direct `@${handle}` display in the queue, run, paused, and history lists with `recipientLabel(item)` or a persisted result label. Replace Instagram-specific login/error copy with the selected adapter’s `loginMessage`. Show the selected platform in the queue campaign summary, for example `LinkedIn · Campaign "Consultants" · prepared by Cold DM`.

- [ ] **Step 4: Gate the Start control before side effects**

After `fetchQueue`, request its capability. For LinkedIn with queued rows:

```js
$("platform-capability").textContent = capability.reason;
$("platform-capability").hidden = false;
$("start-button").disabled = true;
$("start-button").textContent = "Sending not available yet";
```

For executable Instagram, restore `Start sending`. In `startRun`, call the capability endpoint first; return before `api.claimQueue()` when `executable` is false. Pass `selectedPlatform()` to `api.claimQueue(items, platform)`. Disable the selector when a batch is running or paused and re-enable it only after Stop or completion.

- [ ] **Step 5: Preserve result reporting and paused runs**

Persist `platform` and `recipient` in local batch rows/logs. Send the existing result fields plus `platform` and the compatibility `handle` field to the Cold DM App; do not send the nested recipient object to its strict results endpoint. When restoring paused rows, derive the selector platform from the rows and keep it disabled. Do not allow a paused Instagram run to appear under LinkedIn. Keep existing batch log reconciliation idempotent.

- [ ] **Step 6: Run the extension tests and manual panel verification**

Run:

```bash
npm test
node --check extension/sidepanel.js
```

Then reload the unpacked `extension/` folder in Chrome and verify:

1. Instagram is selected by default; its mock/live queue behaves as before.
2. Switching to LinkedIn fetches the LinkedIn queue and shows recipient names without `@`.
3. LinkedIn Start is disabled with `LinkedIn sending is being prepared.`
4. Opening a paused/running Instagram run locks the selector; stopping it re-enables selection.
5. DevTools Network/service-worker logs show no claim, batch-start, or result request when selecting LinkedIn.

- [ ] **Step 7: Commit the panel behavior**

```bash
git add extension/sidepanel.html extension/sidepanel.css extension/sidepanel.js
git commit -m "feat(extension): add platform-specific sender queues"
```

### Task 6: Update the active documentation and run the release-quality verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Interfaces:**
- Documentation describes the Cold DM App API as the sole sender queue/result channel.
- Documentation says Instagram is executable and LinkedIn queue display is foundation-only until Phase 2.

- [ ] **Step 1: Update user-facing repository documentation**

Replace statements that say the extension “sends the Instagram messages” with language that it processes Cold DM platform queues. State clearly that LinkedIn sending is not enabled in this release. Remove n8n, CSV auto-fetch, CRM sync, and mark-done setup instructions from active documentation; reference `extension/archive/` only as historical code, not an operating path.

- [ ] **Step 2: Run the complete automated verification**

Run:

```bash
npm test
node --check extension/api-client.js
node --check extension/platforms.js
node --check extension/platform-adapters.js
node --check extension/batch-validation.js
node --check extension/background.js
node --check extension/sidepanel.js
node -e 'JSON.parse(require("node:fs").readFileSync("extension/manifest.json", "utf8")); console.log("manifest ok")'
rg -n -i 'n8n\.srv|DEFAULT_N8N|IG_AUTO_FETCH|IG_CRM_SYNC|callMarkDone|TRIGGER_AUTO_FETCH|CRM_INBOX_DATA' extension --glob '!archive/**'
```

Expected: tests/checks pass and the final search has no active-code matches.

- [ ] **Step 3: Perform the manual smoke check**

Reload the unpacked extension. Confirm the manifest has no load errors, the side panel opens, Instagram queue execution remains available, and LinkedIn queue display is visibly locked without creating a remote action. Do not perform a real LinkedIn send in this phase.

- [ ] **Step 4: Commit documentation and verification-ready state**

```bash
git add README.md docs/architecture.md
git commit -m "docs(extension): describe platform queue foundation"
```

## Cold DM App handoff checklist

Before live integration, the Cold DM App owner must implement and independently verify:

1. `GET /api/ext/v1/queue?platform=instagram|linkedin` with server-side validation and filtering.
2. Queue items containing `platform`, `profileUrl`, `displayName`, `handle`, existing IDs, message body/type, and campaign metadata.
3. `POST /api/ext/v1/queue/claim` accepting `platform` and refusing cross-platform action IDs.
4. Result validation and persistence accepting `platform` while retaining existing message/action transitions.

The extension can use a platform-aware mock queue until those API changes are available. Live LinkedIn queue display must not be claimed before the app contract is deployed.
