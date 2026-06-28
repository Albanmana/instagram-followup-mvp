# CSV Batch Send — Design Spec

**Date:** 2026-06-26  
**Status:** Approved

## Overview

Add CSV drag-and-drop to the extension popup. Each row (`handle, message`) is sent as an Instagram DM, with a fixed 400-second delay between sends. The batch runs in the background service worker so the popup can be closed without interrupting the queue.

---

## Architecture

### Data flow

1. User drops a CSV file on the popup
2. `popup.js` parses the CSV into `[{ handle, message }, ...]`
3. Popup sends `START_BATCH` to `background.js` with the rows array
4. Background saves the batch to `chrome.storage.local` and immediately processes row 0
5. Background schedules a `chrome.alarms` alarm (`"IG_BATCH_NEXT"`) 400 seconds out
6. On each alarm: background reads current index, processes next row, logs the result, schedules the next alarm (or marks batch done)
7. Popup reads `chrome.storage.local` on open to display current progress

### Components

| Component | Responsibility |
|-----------|---------------|
| `popup.js` | CSV parsing, drop zone, progress display, START/STOP/GET_STATUS messages |
| `background.js` | Queue management, alarm scheduling, calling `sendTestMessage`, writing logs |
| `chrome.storage.local` | Persistent batch state between alarm firings and popup sessions |
| `chrome.alarms` | 400s inter-send timer, survives popup close |

---

## Storage Schema

All batch state lives under these keys in `chrome.storage.local`:

```
batchQueue:  Array<{ handle: string, message: string }>
batchIndex:  number       // index of the next row to process
batchStatus: "running" | "done" | "stopped" | null
batchLogs:   Array<{
  handle: string,
  status: "sent" | "error",
  error?: string,
  at: string              // ISO timestamp
}>
```

`batchLogs` is capped at 500 entries (same pattern as `runLogs`).

---

## Background Changes

### New message handlers

| Message type | Action |
|---|---|
| `START_BATCH` | Validate rows, clear previous batch state, store queue, set index to 0, status to "running", process row 0 immediately, schedule first alarm |
| `STOP_BATCH` | Remove `"IG_BATCH_NEXT"` alarm, set status to "stopped" |
| `GET_BATCH_STATUS` | Return `{ batchQueue, batchIndex, batchStatus, batchLogs }` from storage |

### Alarm listener

Fires on `"IG_BATCH_NEXT"`:
1. Read `batchIndex`, `batchQueue`, `batchStatus` from storage
2. If `batchStatus !== "running"` → exit (batch was stopped)
3. If `batchIndex >= batchQueue.length` → set status `"done"`, exit
4. Call `sendTestMessage(batchQueue[batchIndex])`
5. Append result to `batchLogs` (status: "sent" or "error" + error message)
6. Increment `batchIndex`
7. If more rows remain → schedule next alarm 400s out
8. Else → set status `"done"`

### Error handling

On `sendTestMessage` failure: log `{ status: "error", error: error.message }`, increment index, continue. The alarm is always scheduled regardless of success or failure.

---

## Popup UI Changes

### CSV drop zone

- Positioned above the existing single-send form
- Accepts file via drag-and-drop **or** click-to-browse (file input, `accept=".csv"`)
- On file load: parse CSV, show row count preview, enable "Start batch" button
- CSV format: first row may be a header (`handle`, `message`) — detected by checking if the first cell looks like a column name rather than an Instagram handle

### Progress section

Visible only when a batch is active or completed:

- Summary line: `"3 / 10 envoyés"`
- Per-row table: **only processed rows** (sent or error), not pending ones — handle | status (✓ envoyé / ✗ erreur + message)
- "Stop batch" button (disabled when status is "done" or "stopped")

### Starting a new batch while one is running

Dropping a new CSV while a batch is `"running"` silently replaces it: the existing alarm is removed, state is reset, and the new batch starts immediately. No confirmation dialog for MVP.

### Popup reconnection

On popup open: call `GET_BATCH_STATUS` and render current state. This lets the user check progress at any time without keeping the popup open.

### Existing form

The single-send form remains intact below the batch section. If a batch is running, the submit button is disabled to avoid conflicts.

---

## CSV Parsing Rules

- Delimiter: comma (`,`)
- Quotes: handle double-quoted fields (RFC 4180)
- Trim whitespace from all cells
- Strip leading `@` from handles
- Skip rows where handle or message is empty
- Skip header row if first column value is `"handle"` or `"username"` (case-insensitive)
- Minimum valid row count after parsing: 1 (show error otherwise)

---

## Alarm Constant

```
Alarm name: "IG_BATCH_NEXT"
Delay: 400 seconds (delayInMinutes: 400 / 60)
```

Only one alarm exists at a time. Starting a new batch removes any existing alarm first.

---

## Files Changed

| File | Change |
|------|--------|
| `extension/background.js` | Add `START_BATCH`, `STOP_BATCH`, `GET_BATCH_STATUS` handlers; add alarm listener; add `processBatchItem`, `scheduleBatchAlarm`, `appendBatchLog` helpers |
| `extension/popup.js` | Add CSV drop zone logic, batch UI rendering, START/STOP/GET_STATUS calls |
| `extension/popup.html` | Add drop zone element, progress section, Stop button |
| `extension/popup.css` | Style drop zone and progress table |
| `extension/manifest.json` | Verify `alarms` permission is declared |
