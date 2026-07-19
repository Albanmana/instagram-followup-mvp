# Cold DM — Sender Extension Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Instagram Follow-Up MVP extension into "Cold DM — Sender": a client-facing Chrome side panel that receives a send queue from the Cold DM app (mocked for now), drives the existing send engine, and reports results back.

**Architecture:** New side panel UI (`sidepanel.html/css/js`) + a mocked app API client (`api-client.js`) talk to the untouched send engine (`background.js`) over its existing message protocol (`START_BATCH` / `STOP_BATCH` / `GET_BATCH_STATUS`). Legacy popup/settings UI is archived and removed from the manifest.

**Tech Stack:** Chrome MV3 (side panel API, storage, alarms, cookies), vanilla ES modules, `node --test` for pure-logic tests.

## Global Constraints

- **All UI copy, code, comments, commit messages, and docs in English.** (spec: "Language")
- `background.js` is the proven send engine — the ONLY allowed change is the 2-line `sidePanel.setPanelBehavior` bootstrap in Task 1. Nothing else in that file may be edited.
- Scraper / CSV / CRM-sync code is archived, never deleted.
- Visual identity: Cold DM app tokens — paper `#FAFAF7`, card `#FFFFFF`, ink `#1B1E1B`, line `#E5E8E1`, accent `#17714F`, accent-ink `#0F5A3E`, accent-soft `#E2EFE7`, accent-border `#BAD8C8`, amber `#A8720A`/`#F5EBD6`, red `#B3372E`/`#F5E3E1`, plus the dark variants from `work/cold-dm-app/app/globals.css`. Radius 8-12px, system font stack.
- No technical vocabulary in client-facing copy (no "CSV", "scrape", "CRM", "logs", "batch"). Raw logs live only under Settings → Advanced.
- Extension name everywhere: **"Cold DM — Sender"**.
- Working directory for all commands: `/Users/albanpro/claude-code-perso/work/instagram-followup-mvp`.
- Manual verification steps require Chrome with the extension loaded unpacked from `extension/` (`chrome://extensions` → Reload after each change).

## Existing Send-Engine Protocol (reference — do not change)

Messages handled by `background.js` (`chrome.runtime.sendMessage`):

| Message | Payload | Response |
|---|---|---|
| `START_BATCH` | `{payload: {rows: [{handle, message, has_gif?, gif_query?}], delaySeconds}}` | `{ok: true}` — resets `batchIndex=0`, `batchLogs=[]`, status `"running"`, sends first item immediately, schedules alarm every `delaySeconds` |
| `STOP_BATCH` | — | `{ok: true}` — clears alarm, status `"stopped"` (queue/index/logs stay in storage) |
| `GET_BATCH_STATUS` | — | `{ok, batchQueue, batchIndex, batchStatus, batchLogs, batchDelay}` |
| `GET_RUN_LOGS` | — | `{ok, logs}` (raw engine logs, for Settings → Advanced) |

- `batchStatus`: `null` \| `"running"` \| `"stopped"` \| `"done"`
- `batchLogs` entries: `{handle, status: "sent"|"error", error?, at: ISOString}`
- There is **no pause primitive**: the side panel implements Pause as `STOP_BATCH` + remembering `batchQueue.slice(batchIndex)`, and Resume as a new `START_BATCH` with the remaining rows.

## File Structure

```
extension/
├── manifest.json          Task 1 (rebrand, side_panel, permissions)
├── background.js          Task 1 (2-line side panel bootstrap ONLY)
├── sidepanel.html         Task 1 (placeholder) → Task 3 (real markup)
├── sidepanel.css          Task 3 (Cold DM design tokens, light + dark)
├── sidepanel.js           Task 4 (connect/settings) → 5 (queue/start) → 6 (run) → 7 (history)
├── api-client.js          Task 2 (mocked app API behind one interface)
├── assets/                Task 8 (icons)
└── archive/               Task 1 (popup.*, settings.* moved here)
test/
└── api-client.test.mjs    Task 2
```

---

### Task 1: Archive legacy UI, rebrand manifest, side panel bootstrap

**Files:**
- Create: `extension/archive/` (git mv `popup.html`, `popup.css`, `popup.js`, `settings.html`, `settings.css`, `settings.js` into it)
- Create: `extension/sidepanel.html` (placeholder so the manifest entry resolves)
- Modify: `extension/manifest.json` (full rewrite below)
- Modify: `extension/background.js` (append 2 lines at end of file — sole allowed change)

**Interfaces:**
- Consumes: nothing.
- Produces: an installable extension named "Cold DM — Sender" whose toolbar icon opens the side panel. Later tasks replace `sidepanel.html`.

- [ ] **Step 1: Archive the legacy UI files**

```bash
cd /Users/albanpro/claude-code-perso/work/instagram-followup-mvp
mkdir -p extension/archive
git mv extension/popup.html extension/popup.css extension/popup.js \
       extension/settings.html extension/settings.css extension/settings.js \
       extension/archive/
```

- [ ] **Step 2: Write the placeholder side panel page**

Create `extension/sidepanel.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cold DM — Sender</title>
  </head>
  <body>
    <p>Cold DM — Sender (UI coming in Task 3)</p>
  </body>
</html>
```

- [ ] **Step 3: Rewrite the manifest**

Replace the full content of `extension/manifest.json` with:

```json
{
  "manifest_version": 3,
  "name": "Cold DM — Sender",
  "version": "0.2.0",
  "description": "Sends the Instagram messages your Cold DM app has prepared, right from your own browser.",
  "permissions": [
    "tabs",
    "scripting",
    "storage",
    "alarms",
    "downloads",
    "sidePanel",
    "cookies"
  ],
  "host_permissions": [
    "https://www.instagram.com/*",
    "*://*/*"
  ],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["crm-hook.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["crm-interceptor.js"],
      "run_at": "document_start"
    },
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["scrape-hook.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["scrape-interceptor.js"],
      "run_at": "document_start"
    }
  ],
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "Cold DM — Sender"
  }
}
```

Notes: `default_popup` and `options_ui` are gone (popup/settings archived); `sidePanel` + `cookies` permissions added (cookies is used in Task 5 for the Instagram-login check); content scripts stay — they support the archived-but-alive scraper/CRM code paths in `background.js`.

- [ ] **Step 4: Add the side panel bootstrap to background.js (sole allowed change)**

Append at the very end of `extension/background.js`:

```js
// Open the side panel when the toolbar icon is clicked (Cold DM — Sender UI).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
```

- [ ] **Step 5: Manual verification**

1. Open `chrome://extensions`, enable Developer mode, Load unpacked → select `extension/` (or Reload if already loaded).
2. Expected: no manifest errors; extension listed as **Cold DM — Sender 0.2.0**.
3. Click the toolbar icon. Expected: the side panel opens showing "Cold DM — Sender (UI coming in Task 3)".

- [ ] **Step 6: Commit**

```bash
git add -A extension
git commit -m "feat(extension): rebrand to Cold DM — Sender, archive legacy popup UI, add side panel"
```

---

### Task 2: Mocked app API client (`api-client.js`) with node tests

**Files:**
- Create: `extension/api-client.js`
- Test: `test/api-client.test.mjs`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (used by Tasks 4-7):
  - `createApiClient({ storage, now? })` → `{ verifyApiKey, fetchQueue, reportResults, getHistory }`
  - `verifyApiKey(key: string)` → `Promise<{ok: boolean, account?: string, error?: string}>`
  - `fetchQueue()` → `Promise<{campaign: string, items: Array<{handle: string, message: string}>}>` — excludes handles already reported today
  - `reportResults(results: Array<{handle, status: "sent"|"failed"|"skipped", reason?, at: ISOString}>)` → `Promise<{ok: true, added: number}>` — appends to storage, dedupes on `handle + at`
  - `getHistory()` → `Promise<Array<{handle, status, reason?, at}>>` (newest first)
  - `chromeStorageAdapter` — storage backed by `chrome.storage.local`
  - Storage keys used: `reportedResults` (array). API key storage (`coldDmApiKey`) is owned by the side panel, not this module.

- [ ] **Step 1: Write the failing tests**

Create `test/api-client.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../extension/api-client.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    },
    async set(obj) {
      Object.assign(data, obj);
    },
    _data: data
  };
}

const NOW = () => new Date("2026-07-19T10:00:00Z");

test("verifyApiKey accepts cdm_ keys and rejects others", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  assert.equal((await api.verifyApiKey("cdm_abcd1234")).ok, true);
  assert.equal((await api.verifyApiKey("nope")).ok, false);
  assert.equal((await api.verifyApiKey("")).ok, false);
});

test("fetchQueue returns campaign and items", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const queue = await api.fetchQueue();
  assert.equal(typeof queue.campaign, "string");
  assert.ok(queue.items.length > 0);
  assert.ok(queue.items.every((i) => i.handle && i.message));
});

test("fetchQueue excludes handles already reported today", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const before = await api.fetchQueue();
  const first = before.items[0];
  await api.reportResults([{ handle: first.handle, status: "sent", at: "2026-07-19T09:00:00Z" }]);
  const after = await api.fetchQueue();
  assert.equal(after.items.length, before.items.length - 1);
  assert.ok(!after.items.some((i) => i.handle === first.handle));
});

test("fetchQueue does NOT exclude handles reported on previous days", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const before = await api.fetchQueue();
  await api.reportResults([{ handle: before.items[0].handle, status: "sent", at: "2026-07-18T09:00:00Z" }]);
  const after = await api.fetchQueue();
  assert.equal(after.items.length, before.items.length);
});

test("reportResults dedupes on handle + at", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const r = { handle: "someone", status: "sent", at: "2026-07-19T09:00:00Z" };
  const first = await api.reportResults([r]);
  const second = await api.reportResults([r]);
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal((await api.getHistory()).length, 1);
});

test("getHistory returns newest first", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  await api.reportResults([
    { handle: "older", status: "sent", at: "2026-07-18T09:00:00Z" },
    { handle: "newer", status: "failed", reason: "Profile not found", at: "2026-07-19T09:30:00Z" }
  ]);
  const history = await api.getHistory();
  assert.equal(history[0].handle, "newer");
  assert.equal(history[1].handle, "older");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/`
Expected: FAIL — `Cannot find module '.../extension/api-client.js'`

- [ ] **Step 3: Implement `extension/api-client.js`**

```js
// Cold DM app API client.
// MOCK implementation: the real Cold DM app endpoints do not exist yet.
// Everything the UI needs goes through this one interface, so swapping the
// mock for real fetch() calls later will not touch sidepanel.js.

// Test recipients for the mocked queue. Replace handles with real test
// accounts when doing a live end-to-end run.
const MOCK_QUEUE = {
  campaign: "Coaching leads follow-up",
  items: [
    { handle: "your.test.account1", message: "Hey! Saw your comment — quick question for you." },
    { handle: "your.test.account2", message: "Hi! Loved your last post. Are you open to a chat?" },
    { handle: "your.test.account3", message: "Hello! Following up on your interest — still keen?" }
  ]
};

const RESULTS_KEY = "reportedResults";
const MAX_STORED_RESULTS = 1000;

export function createApiClient({ storage, now = () => new Date() }) {
  async function verifyApiKey(key) {
    // Mock: a plausible key shape passes; the real app will validate it.
    if (/^cdm_[A-Za-z0-9]{8,}$/.test(key ?? "")) {
      return { ok: true, account: "@your.account" };
    }
    return { ok: false, error: "Invalid or expired API key" };
  }

  async function getStoredResults() {
    const { [RESULTS_KEY]: results = [] } = await storage.get(RESULTS_KEY);
    return results;
  }

  async function fetchQueue() {
    const today = now().toISOString().slice(0, 10);
    const results = await getStoredResults();
    const doneToday = new Set(
      results.filter((r) => (r.at ?? "").startsWith(today)).map((r) => r.handle)
    );
    return {
      campaign: MOCK_QUEUE.campaign,
      items: MOCK_QUEUE.items.filter((i) => !doneToday.has(i.handle))
    };
  }

  async function reportResults(results) {
    const stored = await getStoredResults();
    const seen = new Set(stored.map((r) => `${r.handle}|${r.at}`));
    const fresh = results.filter((r) => !seen.has(`${r.handle}|${r.at}`));
    if (fresh.length > 0) {
      const next = [...stored, ...fresh].slice(-MAX_STORED_RESULTS);
      await storage.set({ [RESULTS_KEY]: next });
    }
    return { ok: true, added: fresh.length };
  }

  async function getHistory() {
    const results = await getStoredResults();
    return [...results].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  return { verifyApiKey, fetchQueue, reportResults, getHistory };
}

// Storage adapter over chrome.storage.local (side panel context).
export const chromeStorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj)
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/`
Expected: 6 passing tests.

- [ ] **Step 5: Commit**

```bash
git add extension/api-client.js test/api-client.test.mjs
git commit -m "feat(extension): mocked Cold DM app API client with node tests"
```

---

### Task 3: Side panel markup and Cold DM stylesheet

**Files:**
- Modify: `extension/sidepanel.html` (replace placeholder with real markup)
- Create: `extension/sidepanel.css`

**Interfaces:**
- Consumes: nothing at runtime (static page; `sidepanel.js` arrives in Task 4 — the `<script>` tag already points to it, a 404 in DevTools until then is expected).
- Produces: every element id referenced by Tasks 4-7 (listed in the markup below). Later tasks may not rename ids.

- [ ] **Step 1: Write the markup**

Replace `extension/sidepanel.html` with:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cold DM — Sender</title>
    <link rel="stylesheet" href="sidepanel.css" />
  </head>
  <body>
    <header class="app-header">
      <div class="logo">C</div>
      <div class="header-text">
        <h1>Cold DM — Sender</h1>
        <p id="header-status" class="header-status">Not connected</p>
      </div>
      <button id="settings-button" class="icon-button" type="button" title="Settings">⚙</button>
    </header>

    <main>
      <!-- View: connect (first run) -->
      <section id="view-connect" hidden>
        <div class="card">
          <h2>Connect your account</h2>
          <p class="muted">Paste the API key from your Cold DM app settings.</p>
          <label class="field">
            <span class="label">API key</span>
            <input id="api-key-input" type="password" placeholder="cdm_..." autocomplete="off" />
          </label>
          <p id="connect-error" class="error-text" hidden></p>
          <button id="connect-button" class="primary" type="button">Connect</button>
        </div>
      </section>

      <!-- View: main (tabs) -->
      <section id="view-main" hidden>
        <div class="tabs" role="tablist">
          <button id="tab-today-button" class="tab is-active" type="button" role="tab">Today</button>
          <button id="tab-history-button" class="tab" type="button" role="tab">History</button>
        </div>

        <div id="tab-today">
          <div id="login-banner" class="banner amber" hidden>
            Log in to Instagram in this browser, then resume.
          </div>

          <!-- Idle queue card -->
          <div id="queue-card" class="card" hidden>
            <span class="label">Today's queue</span>
            <p id="queue-count" class="big">0 messages</p>
            <p id="queue-campaign" class="muted"></p>
            <button id="start-button" class="primary" type="button">▶&nbsp; Start sending</button>
          </div>

          <!-- Empty state -->
          <div id="empty-card" class="card center" hidden>
            <p class="big">✓</p>
            <p><b>You're all caught up</b></p>
            <p class="muted">No messages scheduled today.</p>
          </div>

          <!-- Active run card -->
          <div id="run-card" class="card" hidden>
            <div class="row space-between">
              <span class="label">Progress</span>
              <span id="run-pill" class="pill amber">0 / 0</span>
            </div>
            <div class="progress"><i id="run-progress-bar"></i></div>
            <p id="run-next" class="muted"></p>
            <div class="row">
              <button id="pause-button" class="ghost" type="button">⏸ Pause</button>
              <button id="resume-button" class="primary" type="button" hidden>▶ Resume</button>
              <button id="stop-button" class="danger" type="button">⏹ Stop</button>
            </div>
          </div>

          <!-- Recipients / run list -->
          <div id="list-card" class="card" hidden>
            <span id="list-title" class="label">Recipients</span>
            <ul id="recipient-list" class="lead-list"></ul>
          </div>
        </div>

        <div id="tab-history" hidden>
          <div class="card">
            <span class="label">Past sends</span>
            <ul id="history-list" class="lead-list"></ul>
            <p id="history-empty" class="muted center" hidden>Nothing sent yet.</p>
          </div>
        </div>
      </section>

      <!-- View: settings -->
      <section id="view-settings" hidden>
        <div class="card">
          <h2>Settings</h2>
          <label class="field">
            <span class="label">Delay between messages (seconds)</span>
            <input id="delay-input" type="number" min="60" max="3600" value="400" />
          </label>
          <label class="field">
            <span class="label">API key</span>
            <input id="settings-api-key" type="password" autocomplete="off" />
          </label>
          <div class="row">
            <button id="settings-save-button" class="primary" type="button">Save</button>
            <button id="settings-back-button" class="ghost" type="button">Back</button>
          </div>
          <p id="settings-status" class="muted" hidden></p>
        </div>
        <div class="card">
          <span class="label">Advanced</span>
          <p class="muted">Technical details for support.</p>
          <button id="show-logs-button" class="ghost" type="button">Show raw logs</button>
          <pre id="raw-logs" class="logs" hidden></pre>
        </div>
      </section>
    </main>

    <script type="module" src="sidepanel.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Write the stylesheet**

Create `extension/sidepanel.css`:

```css
/* Cold DM design tokens — mirrored from the Cold DM app globals.css. */
:root {
  --paper: #fafaf7; --card: #ffffff; --ink: #1b1e1b; --muted-2: #6b7269;
  --faint: #99a093; --line: #e5e8e1; --line-strong: #d2d7cc; --side: #f3f4ef;
  --accent: #17714f; --accent-ink: #0f5a3e; --accent-soft: #e2efe7; --accent-border: #bad8c8;
  --amber: #a8720a; --amber-soft: #f5ebd6;
  --stone-2: #7c8377; --stone-soft: #eceee8;
  --red-2: #b3372e; --red-soft: #f5e3e1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #141714; --card: #1b1f1b; --ink: #e7eae4; --muted-2: #9aa294;
    --faint: #6e7568; --line: #2a2f29; --line-strong: #394038; --side: #101310;
    --accent: #4fbe8d; --accent-ink: #6fd1a4; --accent-soft: #1c3529; --accent-border: #2c5040;
    --amber: #d9a34a; --amber-soft: #352b14;
    --stone-2: #868d81; --stone-soft: #242923;
    --red-2: #de7168; --red-soft: #38201d;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0; background: var(--paper); color: var(--ink);
  font: 13px/1.45 -apple-system, "Segoe UI", system-ui, sans-serif;
}
main { padding: 16px; }
h1 { font-size: 14px; margin: 0; letter-spacing: -0.01em; }
h2 { font-size: 15px; margin: 0 0 4px; }
p { margin: 0 0 8px; }

.app-header {
  display: flex; align-items: center; gap: 8px; padding: 12px 16px;
  background: var(--card); border-bottom: 1px solid var(--line);
  position: sticky; top: 0;
}
.logo {
  width: 26px; height: 26px; border-radius: 7px; background: var(--accent);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-weight: 700; flex-shrink: 0;
}
.header-text { flex: 1; min-width: 0; }
.header-status { font-size: 11px; color: var(--faint); margin: 1px 0 0; }
.header-status.ok { color: var(--accent-ink); }
.header-status.run { color: var(--amber); }
.icon-button {
  background: none; border: none; color: var(--faint); font-size: 15px;
  cursor: pointer; padding: 4px;
}

.card {
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 14px; margin-bottom: 12px;
}
.card.center { text-align: center; }

.label {
  display: block; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--muted-2); font-weight: 600;
  margin-bottom: 6px;
}
.big { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 2px; }
.muted { color: var(--muted-2); font-size: 11.5px; }
.error-text { color: var(--red-2); font-size: 12px; }
.center { text-align: center; }

.field { display: block; margin-bottom: 10px; }
.field input {
  width: 100%; border: 1px solid var(--line-strong); border-radius: 8px;
  padding: 9px 10px; font-size: 12px; background: var(--card); color: var(--ink);
}
.field input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

button.primary, button.ghost, button.danger {
  display: block; width: 100%; border-radius: 8px; padding: 11px;
  font-weight: 600; font-size: 13px; border: none; cursor: pointer; margin-top: 8px;
}
button.primary { background: var(--accent); color: #fff; }
button.primary:disabled { opacity: 0.5; cursor: default; }
button.ghost { background: var(--side); color: var(--ink); border: 1px solid var(--line-strong); }
button.danger { background: var(--red-soft); color: var(--red-2); border: 1px solid var(--red-2); }

.row { display: flex; gap: 8px; }
.row > button { flex: 1; }
.space-between { justify-content: space-between; align-items: center; }

.tabs {
  display: flex; gap: 4px; background: var(--side); border-radius: 8px;
  padding: 3px; margin-bottom: 12px;
}
.tab {
  flex: 1; text-align: center; padding: 6px; border-radius: 6px; font-size: 12px;
  color: var(--muted-2); font-weight: 600; background: none; border: none; cursor: pointer;
}
.tab.is-active { background: var(--card); color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08); }

.pill {
  display: inline-flex; align-items: center; gap: 6px; border-radius: 999px;
  padding: 3px 10px; font-size: 11px; font-weight: 600;
}
.pill.amber { background: var(--amber-soft); color: var(--amber); }
.pill.green { background: var(--accent-soft); color: var(--accent-ink); }

.progress {
  height: 6px; background: var(--stone-soft); border-radius: 999px;
  overflow: hidden; margin: 10px 0 6px;
}
.progress i {
  display: block; height: 100%; width: 0; background: var(--accent);
  border-radius: 999px; transition: width 0.4s;
}

.banner {
  border-radius: 10px; padding: 10px 12px; font-size: 12px; margin-bottom: 12px;
}
.banner.amber { background: var(--amber-soft); color: var(--amber); border: 1px solid var(--amber); }

.lead-list { list-style: none; margin: 0; padding: 0; }
.lead-list li {
  display: flex; align-items: center; gap: 10px; padding: 9px 0;
  border-bottom: 1px solid var(--line);
}
.lead-list li:last-child { border-bottom: none; }
.lead-list li.current {
  background: var(--accent-soft); margin: 0 -8px; padding: 9px 8px;
  border-radius: 8px; border-bottom: none;
}
.avatar {
  width: 28px; height: 28px; border-radius: 50%; background: var(--stone-soft);
  color: var(--stone-2); display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
}
li.current .avatar { background: var(--accent-border); color: var(--accent-ink); }
.who { flex: 1; min-width: 0; }
.who b { display: block; font-size: 12.5px; }
.who span {
  display: block; color: var(--faint); font-size: 11px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.status { font-size: 11px; font-weight: 600; flex-shrink: 0; }
.status.ok { color: var(--accent-ink); }
.status.run { color: var(--amber); }
.status.wait { color: var(--faint); }
.status.fail { color: var(--red-2); }

.logs {
  background: var(--side); border: 1px solid var(--line); border-radius: 8px;
  padding: 8px; font-size: 10px; max-height: 240px; overflow: auto;
  white-space: pre-wrap; word-break: break-all;
}
```

- [ ] **Step 3: Manual verification**

1. Reload the extension, open the side panel.
2. Expected: header "Cold DM — Sender / Not connected" with green logo square. Body is blank below the header (all sections `hidden` — correct until Task 4 wires visibility). DevTools console shows a 404 for `sidepanel.js` — expected until Task 4.
3. Temporarily remove `hidden` from `view-connect` in DevTools to eyeball the connect card in both light and dark (`chrome://settings/appearance` or OS toggle), then close DevTools.

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.html extension/sidepanel.css
git commit -m "feat(extension): side panel markup and Cold DM stylesheet"
```

---

### Task 4: Connect flow, view switching, settings

**Files:**
- Create: `extension/sidepanel.js`

**Interfaces:**
- Consumes: `createApiClient`, `chromeStorageAdapter` from `extension/api-client.js` (Task 2); element ids from Task 3.
- Produces (extended, not renamed, by Tasks 5-7):
  - `const api = createApiClient({ storage: chromeStorageAdapter })`
  - `showView(name: "connect"|"main"|"settings")`
  - `setHeaderStatus(text: string, tone: ""|"ok"|"run")`
  - Storage keys: `coldDmApiKey` (string), `coldDmAccount` (string), `sendDelaySeconds` (number, default 400)
  - `refreshToday()` — stub in this task, implemented in Task 5

- [ ] **Step 1: Write `extension/sidepanel.js`**

```js
import { createApiClient, chromeStorageAdapter } from "./api-client.js";

const api = createApiClient({ storage: chromeStorageAdapter });
const $ = (id) => document.getElementById(id);

const DEFAULT_DELAY_SECONDS = 400;

// ---------- view switching ----------

function showView(name) {
  $("view-connect").hidden = name !== "connect";
  $("view-main").hidden = name !== "main";
  $("view-settings").hidden = name !== "settings";
}

function setHeaderStatus(text, tone = "") {
  const el = $("header-status");
  el.textContent = text;
  el.className = `header-status ${tone}`.trim();
}

function showTab(name) {
  $("tab-today").hidden = name !== "today";
  $("tab-history").hidden = name !== "history";
  $("tab-today-button").classList.toggle("is-active", name === "today");
  $("tab-history-button").classList.toggle("is-active", name === "history");
}

// ---------- connect flow ----------

async function getSettings() {
  const {
    coldDmApiKey = "",
    coldDmAccount = "",
    sendDelaySeconds = DEFAULT_DELAY_SECONDS
  } = await chrome.storage.local.get(["coldDmApiKey", "coldDmAccount", "sendDelaySeconds"]);
  return { coldDmApiKey, coldDmAccount, sendDelaySeconds };
}

async function connect(key) {
  const result = await api.verifyApiKey(key);
  if (!result.ok) return result;
  await chrome.storage.local.set({ coldDmApiKey: key, coldDmAccount: result.account });
  return result;
}

$("connect-button").addEventListener("click", async () => {
  const key = $("api-key-input").value.trim();
  $("connect-error").hidden = true;
  $("connect-button").disabled = true;
  const result = await connect(key);
  $("connect-button").disabled = false;
  if (!result.ok) {
    $("connect-error").textContent = result.error;
    $("connect-error").hidden = false;
    return;
  }
  await enterMain();
});

// ---------- settings ----------

$("settings-button").addEventListener("click", async () => {
  const settings = await getSettings();
  $("settings-api-key").value = settings.coldDmApiKey;
  $("delay-input").value = settings.sendDelaySeconds;
  $("settings-status").hidden = true;
  $("raw-logs").hidden = true;
  showView("settings");
});

$("settings-back-button").addEventListener("click", () => enterMain());

$("settings-save-button").addEventListener("click", async () => {
  const key = $("settings-api-key").value.trim();
  const delay = Math.min(3600, Math.max(60, parseInt($("delay-input").value, 10) || DEFAULT_DELAY_SECONDS));
  const result = await connect(key);
  if (!result.ok) {
    $("settings-status").textContent = result.error;
    $("settings-status").hidden = false;
    return;
  }
  await chrome.storage.local.set({ sendDelaySeconds: delay });
  $("settings-status").textContent = "Saved.";
  $("settings-status").hidden = false;
});

$("show-logs-button").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_RUN_LOGS" });
  $("raw-logs").textContent = JSON.stringify(response?.logs ?? [], null, 2);
  $("raw-logs").hidden = false;
});

// ---------- tabs ----------

$("tab-today-button").addEventListener("click", () => showTab("today"));
$("tab-history-button").addEventListener("click", () => showTab("history"));

// ---------- main view ----------

async function refreshToday() {
  // Implemented in Task 5 (queue) and Task 6 (live run).
}

async function enterMain() {
  const settings = await getSettings();
  setHeaderStatus(`● Connected · ${settings.coldDmAccount}`, "ok");
  showView("main");
  showTab("today");
  await refreshToday();
}

// ---------- boot ----------

async function boot() {
  const settings = await getSettings();
  if (!settings.coldDmApiKey) {
    setHeaderStatus("Not connected");
    showView("connect");
    return;
  }
  await enterMain();
}

boot();
```

- [ ] **Step 2: Manual verification**

1. Reload the extension, open the side panel.
2. Expected: Connect view shows. Enter `bad` → "Invalid or expired API key" in red. Enter `cdm_test12345` → header flips to "● Connected · @your.account" in green, main view with Today/History tabs shows (both empty for now).
3. Gear icon → settings view shows key and delay 400; Back returns to main. Close and reopen the panel → goes straight to main (key persisted).
4. "Show raw logs" prints a JSON array.

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): side panel connect flow, settings, and view switching"
```

---

### Task 5: Today's queue — fetch, render, start sending

**Files:**
- Modify: `extension/sidepanel.js` (replace the `refreshToday` stub; add queue/start logic before the `boot()` call)

**Interfaces:**
- Consumes: `api.fetchQueue()` (Task 2); `START_BATCH` / `GET_BATCH_STATUS` engine messages; element ids from Task 3.
- Produces (used by Task 6):
  - `state` module object: `{ queue: {campaign, items}|null, nextSendAt: number|null, pausedItems: array|null }`
  - `renderList(entries)` where entries are `{handle, sub, status, statusClass, current}`
  - `checkInstagramLogin()` → `Promise<boolean>`
  - `startRun(items)` — kicks off `START_BATCH`
  - Storage key: `pausedItems` (array of queue items, set by Task 6's pause)

- [ ] **Step 1: Replace the `refreshToday` stub and add queue logic**

In `extension/sidepanel.js`, replace the whole `// ---------- main view ----------` section (the `refreshToday` stub) with:

```js
// ---------- main view: today's queue ----------

const state = { queue: null, nextSendAt: null, pausedItems: null };

function initials(handle) {
  return handle.slice(0, 2).toUpperCase();
}

function renderList(entries) {
  const list = $("recipient-list");
  list.innerHTML = "";
  for (const entry of entries) {
    const li = document.createElement("li");
    if (entry.current) li.className = "current";
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(entry.handle);
    const who = document.createElement("div");
    who.className = "who";
    const name = document.createElement("b");
    name.textContent = `@${entry.handle}`;
    const sub = document.createElement("span");
    sub.textContent = entry.sub ?? "";
    who.append(name, sub);
    const status = document.createElement("span");
    status.className = `status ${entry.statusClass}`;
    status.textContent = entry.status;
    li.append(avatar, who, status);
    list.appendChild(li);
  }
  $("list-card").hidden = entries.length === 0;
}

async function checkInstagramLogin() {
  const cookie = await chrome.cookies.get({
    url: "https://www.instagram.com",
    name: "sessionid"
  });
  return Boolean(cookie?.value);
}

async function startRun(items) {
  const loggedIn = await checkInstagramLogin();
  if (!loggedIn) {
    $("login-banner").hidden = false;
    return;
  }
  $("login-banner").hidden = true;
  const { sendDelaySeconds } = await getSettings();
  const rows = items.map((i) => ({ handle: i.handle, message: i.message }));
  const response = await chrome.runtime.sendMessage({
    type: "START_BATCH",
    payload: { rows, delaySeconds: sendDelaySeconds }
  });
  if (!response?.ok) {
    setHeaderStatus(`Could not start: ${response?.error ?? "unknown error"}`, "");
    return;
  }
  chrome.action.setBadgeBackgroundColor({ color: "#17714F" });
  chrome.action.setBadgeText({ text: "▶" });
  state.nextSendAt = Date.now() + sendDelaySeconds * 1000;
  await refreshToday();
}

$("start-button").addEventListener("click", async () => {
  if (!state.queue || state.queue.items.length === 0) return;
  $("start-button").disabled = true;
  await startRun(state.queue.items);
  $("start-button").disabled = false;
});

function showIdleQueue(queue) {
  $("run-card").hidden = true;
  if (queue.items.length === 0) {
    $("queue-card").hidden = true;
    $("empty-card").hidden = false;
    renderList([]);
    return;
  }
  $("empty-card").hidden = true;
  $("queue-card").hidden = false;
  const n = queue.items.length;
  $("queue-count").textContent = `${n} message${n === 1 ? "" : "s"}`;
  $("queue-campaign").textContent = `Campaign "${queue.campaign}" · prepared by Cold DM`;
  $("list-title").textContent = "Recipients";
  renderList(
    queue.items.map((i) => ({
      handle: i.handle,
      sub: i.message.length > 45 ? `${i.message.slice(0, 45)}…` : i.message,
      status: "Pending",
      statusClass: "wait"
    }))
  );
}

async function refreshToday() {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  if (engine?.ok && engine.batchStatus === "running") {
    renderRun(engine); // Task 6
    return;
  }
  chrome.action.setBadgeText({ text: "" });
  state.queue = await api.fetchQueue();
  showIdleQueue(state.queue);
}
```

Until Task 6 exists, add this temporary stub directly below (it is replaced in Task 6):

```js
function renderRun(engine) {
  // Implemented in Task 6.
}
```

- [ ] **Step 2: Manual verification**

1. Reload the extension, open the side panel (already connected from Task 4).
2. Expected: "Today's queue / 3 messages / Campaign "Coaching leads follow-up" · prepared by Cold DM", recipients list with 3 handles and message previews, "▶ Start sending" button.
3. Log out of Instagram (or use a profile that isn't logged in) → click Start → amber banner "Log in to Instagram in this browser, then resume." appears, nothing starts.
4. Log back in → click Start → toolbar icon shows a green "▶" badge (the run itself renders in Task 6). Immediately open Settings → Show raw logs to confirm the engine started, then stop it for now from DevTools console of the panel: `chrome.runtime.sendMessage({type: "STOP_BATCH"})`.

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): today's queue view with Instagram login check and start"
```

---

### Task 6: Live run — progress, countdown, pause/resume/stop, result reporting

**Files:**
- Modify: `extension/sidepanel.js` (replace the `renderRun` stub; add polling, run controls, and completion reporting)

**Interfaces:**
- Consumes: `state`, `renderList`, `startRun`, `refreshToday` (Task 5); `api.reportResults` (Task 2); `STOP_BATCH` / `GET_BATCH_STATUS` engine messages; `batchLogs` entry shape `{handle, status: "sent"|"error", error?, at}`.
- Produces (used by Task 7): `reportEngineLogs(batchLogs)` — maps engine logs to app results and reports them (dedupe handled by `api.reportResults`).

- [ ] **Step 1: Replace the `renderRun` stub with the live-run logic**

```js
// ---------- live run ----------

let pollTimer = null;
let countdownTimer = null;
let lastSeenIndex = -1;

function stopTimers() {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  pollTimer = null;
  countdownTimer = null;
}

function statusEntry(row, log, isCurrent) {
  if (log?.status === "sent") {
    return { handle: row.handle, sub: `Sent at ${new Date(log.at).toLocaleTimeString()}`, status: "✓ Sent", statusClass: "ok" };
  }
  if (log?.status === "error") {
    return { handle: row.handle, sub: readableReason(log.error), status: "✗ Failed", statusClass: "fail" };
  }
  if (isCurrent) {
    return { handle: row.handle, sub: "Sending…", status: "● Sending", statusClass: "run", current: true };
  }
  return { handle: row.handle, sub: "—", status: "Pending", statusClass: "wait" };
}

function readableReason(error) {
  const text = String(error ?? "");
  if (/not.?found|no such user|unavailable/i.test(text)) return "Profile not found";
  if (/message button|button/i.test(text)) return "Could not open the conversation";
  if (/login|logged/i.test(text)) return "Instagram session expired";
  return "Could not send";
}

function renderRun(engine) {
  const { batchQueue, batchIndex, batchLogs, batchDelay } = engine;
  const total = batchQueue.length;
  const doneCount = Math.min(batchIndex, total);

  $("queue-card").hidden = true;
  $("empty-card").hidden = true;
  $("run-card").hidden = false;
  $("pause-button").hidden = false;
  $("resume-button").hidden = true;
  setHeaderStatus("● Sending", "run");

  $("run-pill").textContent = `${doneCount} / ${total}`;
  $("run-progress-bar").style.width = `${total === 0 ? 0 : Math.round((doneCount / total) * 100)}%`;

  if (batchIndex !== lastSeenIndex) {
    lastSeenIndex = batchIndex;
    state.nextSendAt = Date.now() + (batchDelay ?? DEFAULT_DELAY_SECONDS) * 1000;
  }

  const logByHandle = new Map(batchLogs.map((l) => [l.handle, l]));
  $("list-title").textContent = "Run";
  renderList(batchQueue.map((row, i) => statusEntry(row, logByHandle.get(row.handle), i === batchIndex)));

  if (!pollTimer) {
    pollTimer = setInterval(pollEngine, 2000);
    countdownTimer = setInterval(renderCountdown, 1000);
  }
}

function renderCountdown() {
  if (!state.nextSendAt) return;
  const ms = state.nextSendAt - Date.now();
  if (ms <= 0) {
    $("run-next").textContent = "Sending next message…";
    return;
  }
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  $("run-next").textContent = `Next send in ${m} min ${String(s).padStart(2, "0")} s — safety delay between messages.`;
}

async function pollEngine() {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  if (!engine?.ok) return;
  if (engine.batchStatus === "running") {
    // Spec: an expired Instagram session auto-pauses the run instead of
    // letting every remaining send fail.
    const lastLog = engine.batchLogs?.[engine.batchLogs.length - 1];
    if (lastLog?.status === "error" && readableReason(lastLog.error) === "Instagram session expired") {
      $("login-banner").hidden = false;
      await pauseRun();
      return;
    }
    renderRun(engine);
    return;
  }
  // Run ended (done or stopped): report, clean up, back to idle.
  stopTimers();
  await reportEngineLogs(engine.batchLogs ?? []);
  chrome.action.setBadgeText({ text: "" });
  const { coldDmAccount } = await getSettings();
  setHeaderStatus(`● Connected · ${coldDmAccount}`, "ok");
  await refreshToday();
}

async function reportEngineLogs(batchLogs) {
  const results = batchLogs.map((log) => ({
    handle: log.handle,
    status: log.status === "sent" ? "sent" : "failed",
    reason: log.status === "sent" ? undefined : readableReason(log.error),
    at: log.at
  }));
  if (results.length > 0) await api.reportResults(results);
}

// ---------- pause / resume / stop ----------

async function pauseRun() {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  await chrome.runtime.sendMessage({ type: "STOP_BATCH" });
  stopTimers();
  await reportEngineLogs(engine?.batchLogs ?? []);
  state.pausedItems = (engine?.batchQueue ?? []).slice(engine?.batchIndex ?? 0);
  await chrome.storage.local.set({ pausedItems: state.pausedItems });
  $("pause-button").hidden = true;
  $("resume-button").hidden = false;
  $("run-next").textContent = `Paused — ${state.pausedItems.length} message(s) remaining.`;
  setHeaderStatus("● Paused", "run");
}

$("pause-button").addEventListener("click", pauseRun);

$("resume-button").addEventListener("click", async () => {
  const items = state.pausedItems ?? [];
  state.pausedItems = null;
  await chrome.storage.local.set({ pausedItems: null });
  lastSeenIndex = -1;
  await startRun(items);
});

$("stop-button").addEventListener("click", async () => {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  await chrome.runtime.sendMessage({ type: "STOP_BATCH" });
  stopTimers();
  await reportEngineLogs(engine?.batchLogs ?? []);
  state.pausedItems = null;
  await chrome.storage.local.set({ pausedItems: null });
  chrome.action.setBadgeText({ text: "" });
  const { coldDmAccount } = await getSettings();
  setHeaderStatus(`● Connected · ${coldDmAccount}`, "ok");
  await refreshToday();
});
```

- [ ] **Step 2: Wire paused state into boot/refresh**

In `refreshToday()` (Task 5 code), extend the non-running branch to restore a paused run. Replace:

```js
  chrome.action.setBadgeText({ text: "" });
  state.queue = await api.fetchQueue();
  showIdleQueue(state.queue);
```

with:

```js
  const { pausedItems } = await chrome.storage.local.get("pausedItems");
  if (Array.isArray(pausedItems) && pausedItems.length > 0) {
    state.pausedItems = pausedItems;
    $("queue-card").hidden = true;
    $("empty-card").hidden = true;
    $("run-card").hidden = false;
    $("pause-button").hidden = true;
    $("resume-button").hidden = false;
    $("run-next").textContent = `Paused — ${pausedItems.length} message(s) remaining.`;
    setHeaderStatus("● Paused", "run");
    $("list-title").textContent = "Run";
    renderList(pausedItems.map((i) => ({ handle: i.handle, sub: "—", status: "Pending", statusClass: "wait" })));
    return;
  }
  chrome.action.setBadgeText({ text: "" });
  state.queue = await api.fetchQueue();
  showIdleQueue(state.queue);
```

- [ ] **Step 3: Manual verification (real send, use test accounts)**

Before this step, edit `MOCK_QUEUE` in `extension/api-client.js` to use 2 real test-account handles you control, and set the delay to 60 s in Settings.

1. Reload extension, open panel, click **Start sending**.
2. Expected: run card shows "0 / 2", first recipient highlighted "● Sending", countdown text appears, toolbar badge "▶".
3. After the first send: pill "1 / 2", first row "✓ Sent" with a timestamp.
4. Click **Pause** → engine stops, "Paused — 1 message(s) remaining.", Resume button visible. Close and reopen the panel → paused state is restored.
5. Click **Resume** → run restarts with the remaining recipient.
6. When the run finishes: badge clears, header back to "● Connected", queue view shows "You're all caught up" (both handles reported today, so the mock queue is empty).
7. Check Instagram DMs on the test accounts: both messages received.

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): live run view with progress, pause/resume/stop, and result reporting"
```

---

### Task 7: History tab and reconciliation on open

**Files:**
- Modify: `extension/sidepanel.js` (render history; reconcile unreported engine logs on boot)

**Interfaces:**
- Consumes: `api.getHistory()` (Task 2), `reportEngineLogs` (Task 6), `renderList`-style DOM building (Task 5), element ids `history-list` / `history-empty` (Task 3).
- Produces: nothing consumed later.

- [ ] **Step 1: Add history rendering and hook it to the History tab**

Add after the live-run section:

```js
// ---------- history ----------

async function renderHistory() {
  const history = await api.getHistory();
  const list = $("history-list");
  list.innerHTML = "";
  $("history-empty").hidden = history.length > 0;
  for (const entry of history.slice(0, 100)) {
    const li = document.createElement("li");
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = initials(entry.handle);
    const who = document.createElement("div");
    who.className = "who";
    const name = document.createElement("b");
    name.textContent = `@${entry.handle}`;
    const sub = document.createElement("span");
    const day = new Date(entry.at);
    sub.textContent = `${day.toLocaleDateString()} ${day.toLocaleTimeString()}${entry.reason ? ` · ${entry.reason}` : ""}`;
    who.append(name, sub);
    const status = document.createElement("span");
    status.className = `status ${entry.status === "sent" ? "ok" : "fail"}`;
    status.textContent = entry.status === "sent" ? "✓ Sent" : "✗ Failed";
    li.append(avatar, who, status);
    list.appendChild(li);
  }
}
```

Then update the History tab button handler (Task 4 code) from:

```js
$("tab-history-button").addEventListener("click", () => showTab("history"));
```

to:

```js
$("tab-history-button").addEventListener("click", async () => {
  showTab("history");
  await renderHistory();
});
```

- [ ] **Step 2: Reconcile engine logs on boot**

A run can finish while the panel is closed; its results were never reported. In `boot()` (Task 4 code), just before `await enterMain();`, add:

```js
  // A run may have finished while the panel was closed — report those results.
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  if (engine?.ok && engine.batchStatus !== "running" && (engine.batchLogs ?? []).length > 0) {
    await reportEngineLogs(engine.batchLogs);
  }
```

(`api.reportResults` dedupes on `handle + at`, so reconciling twice is harmless.)

- [ ] **Step 3: Manual verification**

1. Reload extension, open panel, switch to **History**.
2. Expected: the sends from Task 6 Step 3 are listed newest first, "✓ Sent" in green, with date/time. If a send had failed, it shows "✗ Failed · reason" in red.
3. Start a 1-item run, close the panel mid-run, wait for it to finish (check the test account's DMs), reopen the panel → History includes it (reconciliation worked).

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel.js
git commit -m "feat(extension): history tab and result reconciliation on panel open"
```

---

### Task 8: Icons, README, end-to-end acceptance pass

**Files:**
- Create: `extension/assets/icon16.png`, `icon48.png`, `icon128.png`
- Modify: `extension/manifest.json` (add `icons` + `action.default_icon`)
- Modify: `README.md` (rewrite for Cold DM — Sender, in English)

**Interfaces:**
- Consumes: everything previous.
- Produces: shippable extension.

- [ ] **Step 1: Generate the icons**

Create `scripts/make-icons.py` at the project root:

```python
"""Generate Cold DM - Sender toolbar icons (green rounded square, white C)."""
from PIL import Image, ImageDraw, ImageFont

ACCENT = (23, 113, 79, 255)  # #17714F

for size in (16, 48, 128):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = max(2, size // 5)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=ACCENT)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", int(size * 0.62))
    except OSError:
        font = ImageFont.load_default()
    d.text((size / 2, size / 2 - size * 0.04), "C", font=font, fill="white", anchor="mm")
    img.save(f"extension/assets/icon{size}.png")
print("icons written")
```

Run:

```bash
mkdir -p extension/assets
python3 -c "import PIL" 2>/dev/null || python3 -m pip install pillow
python3 scripts/make-icons.py
```

Expected: `icons written`; three PNGs in `extension/assets/`.

- [ ] **Step 2: Add icons to the manifest**

In `extension/manifest.json`, add as top-level key and inside `action`:

```json
  "icons": {
    "16": "assets/icon16.png",
    "48": "assets/icon48.png",
    "128": "assets/icon128.png"
  },
```

```json
  "action": {
    "default_title": "Cold DM — Sender",
    "default_icon": {
      "16": "assets/icon16.png",
      "48": "assets/icon48.png",
      "128": "assets/icon128.png"
    }
  }
```

- [ ] **Step 3: Rewrite `README.md`**

Replace the full content of `README.md` with:

```markdown
# Cold DM — Sender

Chrome extension that sends the Instagram messages your Cold DM app has
prepared, from your own browser (avoids Instagram blocks), and reports
results back to the app.

Architecture: see [docs/architecture.md](docs/architecture.md) and the
redesign spec in
[docs/superpowers/specs/2026-07-19-cold-dm-sender-redesign-design.md](docs/superpowers/specs/2026-07-19-cold-dm-sender-redesign-design.md).

## How it works

1. The side panel fetches today's send queue from the Cold DM app
   (`api-client.js` — currently a mock; swap it for real endpoints without
   touching the UI or the engine).
2. **Start sending** hands the queue to the send engine (`background.js`),
   which opens each profile and sends with a safety delay between messages.
3. Results (sent / failed) are reported back to the app, which updates
   DM Tracker.

## Install (unpacked)

1. Open `chrome://extensions`, enable Developer mode.
2. Load unpacked → select the `extension/` folder.
3. Click the toolbar icon: the side panel opens.
4. Paste an API key (mock accepts anything matching `cdm_` + 8 chars).

## Development

- Tests (mocked API client): `node --test test/`
- The legacy popup UI (scraper, CSV batch, CRM sync) is archived in
  `extension/archive/` — the engine code paths for it still live in
  `background.js` but have no UI.
- Raw engine logs: side panel → Settings → Advanced → Show raw logs.
```

- [ ] **Step 4: Full acceptance pass (spec checklist)**

Reload the extension and walk through, checking each spec requirement:

1. Fresh profile (clear extension storage via panel DevTools: `chrome.storage.local.clear()`): Connect screen → invalid key rejected with readable error → valid key connects. ✓ spec "Connect"
2. Today tab: queue count, campaign line, recipients with previews, single primary action. ✓ spec "Today's queue"
3. Logged out of Instagram → Start shows the amber login banner and does not run. ✓ spec "Instagram logged out"
4. Run: progress pill, bar, countdown with "safety delay" wording, Pause/Stop visible; a failing handle shows "✗ Failed" with readable reason while the queue continues. ✓ spec "Sending" + "Single send failure"
5. Panel closed mid-run: sending continues; toolbar badge visible; reopen resyncs. ✓ spec "Panel closed mid-run"
6. Empty queue after all sends: "You're all caught up — no messages scheduled today." ✓ spec "Empty queue"
7. History tab lists past results. ✓ spec "History"
8. No client-facing copy mentions CSV/scrape/CRM/batch/logs (raw logs only under Settings → Advanced). ✓ spec "no technical vocabulary"
9. Dark mode: toggle OS appearance → panel follows with dark tokens. ✓ spec "visual identity"
10. `node --test test/` passes.

- [ ] **Step 5: Commit**

```bash
git add extension/assets extension/manifest.json README.md scripts/make-icons.py
git commit -m "feat(extension): Cold DM icons, README rewrite, acceptance pass"
```
