# Cold DM Sender Architecture

## Product Direction

The extension is a browser-side operator for actions prepared by the Cold DM
App. It does not own a local CRM, sequence scheduler, or another queue/result
integration. The Cold DM App API is the sole source of executable actions and
the sole destination for claims and results.

Release boundary:

- Instagram is executable: an authenticated browser can claim and process its
  Cold DM queue.
- LinkedIn is foundation-only: the side panel can display a LinkedIn queue but
  must keep sending disabled. It creates no remote claim, send, or result
  action until Phase 2 enables that adapter.

## Stack

### Browser Layer

- Chrome Extension, Manifest V3
- Side panel for platform selection, queue display, settings, and run state
- Background service worker for queue execution and result reporting
- Platform adapter registry that gates execution by capability
- Instagram automation adapter for the executable Phase-1 path

### Cold DM App API

- `GET /api/ext/v1/queue?platform=instagram|linkedin` supplies only the chosen
  platform's queue.
- `POST /api/ext/v1/queue/claim` claims action IDs for the same platform.
- `POST /api/ext/v1/results` records execution results.
- The extension authenticates these calls with the configured Cold DM API key.

The app is responsible for server-side validation, platform filtering,
cross-platform claim protection, and message/action state transitions.

## Queue Item Boundary

Each normalized queue item includes:

- `platform` (`instagram` or `linkedin`)
- `actionId`, `messageId`, and `leadId`
- recipient `profileUrl`, optional `displayName`, and optional `handle`
- message body and message type
- campaign metadata

The extension fetches, claims, and reports against the selected platform only.
It preserves `platform` in its local run and result records so output cannot be
mistaken for another platform.

## Runtime Model

1. The user selects a platform in the side panel.
2. The extension fetches that platform's queue from the Cold DM App API.
3. It checks the selected platform adapter's capability before any side effect.
4. For Instagram, it claims the selected actions, sends through the browser,
   and reports results to the Cold DM App API.
5. For LinkedIn, it renders the prepared queue and the locked status, then
   stops. No claim, send, or result request is made.

## API Handoff Before Live Use

The Cold DM App owner must implement and independently verify:

1. `GET /api/ext/v1/queue?platform=instagram|linkedin` with server-side
   validation and filtering.
2. Queue items with the platform, recipient identity/profile data, message
   body/type, existing IDs, and campaign metadata.
3. `POST /api/ext/v1/queue/claim` accepting `platform` and rejecting
   cross-platform action IDs.
4. Result validation and persistence that accepts `platform` while retaining
   the existing message/action transitions.

The extension's mock queue is platform-aware for local development. It is not
a replacement for the deployed API contract, and it must not be used to claim
that live LinkedIn queue display is available.

## Historical Code

`extension/archive/` is retained for historical reference only. It is not part
of the active runtime, setup, queue, or reporting flow.
