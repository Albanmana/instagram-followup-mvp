# Cold DM — Sender: Extension Redesign

**Date:** 2026-07-19
**Status:** Approved design, pending implementation plan

## Overview

The Instagram Follow-Up MVP extension becomes **Cold DM — Sender**: a clean,
client-facing execution agent for the Cold DM app. The extension's only visible
job is to send the messages the app has prepared, from the user's own browser
(to avoid Instagram blocks), and report results back.

All intelligence (which leads to follow up, what to say, when) lives in the
Cold DM app, which orchestrates DM Tracker:

```
Extension → Cold DM app → DM Tracker → Cold DM app → Extension (send queue)
Extension → sends DMs on Instagram → Cold DM app → updates DM Tracker (results)
```

**Language:** All UI copy, code, comments, and docs are in English.

## Goals

- Client-intuitive UI: one possible action per screen, no technical vocabulary.
- Focus entirely on sending; scraping/CSV/CRM-sync UI removed (code archived).
- Visual identity matches the Cold DM app (paper/ink palette, green accent
  `#17714F`, Bricolage Grotesque-style type, dark mode support).
- Persistent Chrome side panel so the user can watch progress while the
  extension drives Instagram.

## Non-goals (this iteration)

- No changes to the send engine (`background.js` stays as-is).
- No real Cold DM app API — the contract is mocked, ready to wire later.
- No follow-up sequencing logic in the extension.
- No removal of scraper/batch code — it is archived, not deleted.

## Decisions made

| Topic | Decision |
|---|---|
| Scraper & CSV batch | Keep code, remove all UI (archive) |
| Queue control model | Autopilot with visibility: one Start button, live progress, Pause/Stop |
| App API | Not built yet — mock behind a single interface in `api-client.js` |
| UI surface | Chrome side panel (persistent while extension works on Instagram) |
| Account linking | API key pasted once into extension settings |
| Branding | "Cold DM — Sender" (manifest name, header) |

## Architecture

```
extension/
├── manifest.json          (updated: side panel entry, name "Cold DM — Sender")
├── background.js          (untouched — proven send engine)
├── api-client.js          (new — Cold DM app API contract, mocked)
├── sidepanel.html/css/js  (new — the client UI)
├── assets/                (new — icons in Cold DM colors)
└── archive/               (popup.*, settings.* — removed from manifest)
```

- The side panel opens on toolbar icon click (`chrome.sidePanel` API).
- The side panel talks to `background.js` over the existing message channel
  (the one used today by the CSV batch flow — the app-provided queue simply
  replaces the CSV as queue source).
- `api-client.js` exposes two operations behind one interface:
  - `fetchQueue()` → today's send queue `[{handle, message, campaign}]`
  - `reportResults(results)` → send outcomes (sent / failed / skipped)
  Mock implementation now; swap for real `fetch` calls later without touching
  UI or background.

## Screens (validated via mockups)

Design tokens copied from the Cold DM app `globals.css` (paper `#FAFAF7`,
ink `#1B1E1B`, accent `#17714F`, accent-soft `#E2EFE7`, amber, red, dark
variants).

1. **Connect** (first run only): paste API key, one Connect button, help link.
2. **Today's queue** (main screen): connected status + IG handle in header;
   tabs "Today" / "History"; card with queue size and campaign name; recipient
   list with message previews; one primary button **Start sending**.
3. **Sending**: progress bar (e.g. 5/12), countdown to next send ("safety
   delay between messages"), Pause and Stop buttons, live run list with
   per-recipient status (Sent ✓ / Sending ● / Pending / Failed ✗).
4. **History tab**: past days with their results.

## Error handling and edge states

Every abnormal situation gets a clear, client-readable state — never raw logs:

- **Not connected / invalid key** → Connect screen with "Invalid or expired
  API key" message.
- **Empty queue** → positive empty state: "You're all caught up — no messages
  scheduled today."
- **Instagram logged out** (detected at send start) → amber banner "Log in to
  Instagram in this browser, then resume"; the run auto-pauses instead of
  accumulating failures.
- **Single send failure** (profile not found, Message button missing, IG UI
  change) → row marked "✗ Failed" with a short readable reason; the queue
  continues — one failure never blocks the batch. Failures are reported to the
  app like successes.
- **Panel closed mid-run** → sending continues in the background (current
  behavior); on reopen the panel resyncs to actual state. A toolbar badge
  shows a run is active.
- **Advanced details** → raw logs remain accessible under Settings → Advanced
  (for support), invisible in the client path.

## Verification

- UI testable without Instagram: mock `api-client.js` provides a fake queue;
  background progress events can be simulated.
- Manual end-to-end test with the existing flow: mocked queue of 2-3 test
  handles, real send from a test account, verify reported statuses (same as
  today's CSV flow — only the queue source changes).
- Acceptance criterion: a first-time client understands what to do in under
  30 seconds (one possible action per screen).
