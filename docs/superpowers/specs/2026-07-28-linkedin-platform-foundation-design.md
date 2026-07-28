# LinkedIn Platform Foundation Design

## Purpose

Make the Cold DM Sender extension platform-aware without implementing LinkedIn browser automation yet. The Cold DM App becomes the only source of executable work and execution results. The extension can display a filtered LinkedIn queue safely, while sending remains unavailable until a separate Computer Use discovery and implementation project.

This document defines Phase 1 only. It does not define LinkedIn selectors, clicks, direct-message automation, connection invitations, InMail, lead scraping, or CRM synchronization.

## Product decisions

- A sender run processes exactly one platform: `instagram` or `linkedin`.
- The user chooses that platform explicitly in the side panel before refreshing the queue.
- Queue filtering is enforced by the Cold DM App API, not by client-side filtering.
- LinkedIn Phase 1 shows due actions but does not claim, send, skip, or otherwise mutate them.
- Phase 2 will send only direct messages to people with whom the user is already connected. It will never send connection invitations as part of this feature.
- If a later LinkedIn send cannot be made because messaging is unavailable, it reports `skipped` with a clear reason for review in the Cold DM App.
- The extension has one active run at a time; its platform selector is disabled while a run is active.
- n8n has no active sender role after this work. The legacy CSV auto-fetch, Instagram CRM sync, and mark-done webhook paths are disabled and archived. n8n may continue to serve its separate Cold DM App AI-reply workflow.

## Architecture

```
Cold DM App queue API
  └─ platform-filtered executable actions
       └─ Sender API client
            └─ platform-neutral batch engine
                 ├─ Instagram sender adapter
                 └─ LinkedIn foundation adapter (not executable in Phase 1)
```

The batch engine owns the lifecycle shared by platforms: persisted run state, delays, pause/stop, logs, result reporting, and toolbar badge state. It selects an adapter from `item.platform`; it does not construct provider URLs or query provider-specific DOM elements.

Each adapter owns only platform behavior. The Instagram adapter preserves the proven Instagram sender flow. The LinkedIn adapter owns destination validation and availability state in Phase 1, then receives browser interaction logic in Phase 2.

## Extension behavior

### Platform selection and queue display

The main side-panel screen contains one explicit platform selector with `Instagram` and `LinkedIn`. Changing it refreshes the visible queue for that platform only. The queue card, recipient list, empty state, history labels, and login/error copy use the selected platform rather than hard-coded Instagram copy.

Instagram items continue to display a handle where present. LinkedIn items display `displayName` when available and otherwise a stable profile-derived label; the UI must not add an Instagram-style `@` prefix to LinkedIn identities.

The selector is disabled while a batch is `running` or `stopped` with resumable items. Resuming always uses the original batch platform.

### Queue item contract consumed by the extension

Every executable queue item must contain:

```ts
type SenderPlatform = "instagram" | "linkedin";

type SenderRecipient = {
  displayName: string | null;
  profileUrl: string;
  handle: string | null;
};

type SenderQueueItem = {
  actionId: string;
  messageId: string;
  leadId: string;
  campaign: { id: string; name: string };
  platform: SenderPlatform;
  recipient: SenderRecipient;
  message: string;
  messageType: "first_dm" | "followup";
};
```

`profileUrl` is mandatory for both platforms. It is the destination used by platform adapters. `handle` remains available for Instagram compatibility but is not used as the LinkedIn routing key.

### Adapter interface

The sender uses a small, testable adapter registry. The implementation may use JavaScript with JSDoc rather than introducing TypeScript compilation.

```ts
type SendOutcome =
  | { status: "sent"; at: string }
  | { status: "failed"; reason: string; at: string }
  | { status: "skipped"; reason: string; at: string };

type PlatformAdapter = {
  platform: SenderPlatform;
  isLoggedIn(): Promise<boolean>;
  getLoginMessage(): string;
  canExecute(): { ok: boolean; reason?: string };
  validateItem(item: SenderQueueItem): string | null;
  send(item: SenderQueueItem): Promise<SendOutcome>;
};
```

For Instagram, `canExecute()` is true and `send()` delegates to the extracted existing browser flow. For LinkedIn Phase 1, `canExecute()` is false with a client-readable message that LinkedIn sending is being prepared. The Start button is disabled before `claimQueue()` or `START_BATCH` is called. The adapter must never produce a remote result for this unavailable state.

### Batch state and result reporting

Persisted batch rows contain the full `SenderQueueItem`, including `platform` and `recipient`. Alarm, storage, log, and function names are provider-neutral. Existing Instagram batch state is migrated conservatively on read: legacy rows with a `handle` and no `platform` are interpreted as Instagram, and use their known profile URL shape only when necessary for an interrupted historical batch.

Only an executable adapter can claim actions. Once a run completes, its `SendOutcome` is mapped to the existing Cold DM result endpoint. A future LinkedIn adapter reports unavailable direct messaging as `skipped`; it does not retry an invitation or silently continue without an audit trail.

## Cold DM App requirements

These changes belong to the Cold DM App and are intentionally not implemented in this repository. They are the required external contract for the extension work.

1. `GET /api/ext/v1/queue` accepts a required `platform` query parameter limited to `instagram` or `linkedin`.
2. The API returns only pending, due actions whose lead belongs to that platform, while preserving campaign grouping and daily send limits.
3. Queue construction joins the lead to emit `platform`, `profileUrl`, `displayName`, and the existing action/message identifiers. LinkedIn queue construction uses the canonical LinkedIn `profile_url`; it does not infer a destination from a bare slug.
4. `POST /api/ext/v1/queue/claim` verifies each requested action still belongs to the requested platform in addition to its existing pending-state checks. A cross-platform claim is skipped.
5. Result application remains authoritative in the app. It records `sent`, `failed`, or `skipped` against the claimed action and message, including the platform in its stored result payload for diagnosis.

The app’s existing platform-aware lead and campaign model is retained. No database reset, destructive migration, or change to existing Instagram queue behavior is part of this work.

## n8n and legacy sender cleanup

The active extension must remove all runtime paths for:

- CSV auto-fetch and its `IG_AUTO_FETCH` alarm;
- Instagram CRM sync and its `IG_CRM_SYNC` alarm and content scripts;
- post-send `mark done` calls;
- default n8n webhook URLs and n8n API-key fallbacks;
- settings or UI controls that configure those flows.

The files in `extension/archive/` remain as historical reference but are not loaded by the manifest, registered by the service worker, or reachable from the side panel. Instagram scraper behavior is outside Phase 1 and must not be expanded or made cross-platform by this change.

## Verification and acceptance criteria

Automated tests cover the adapter registry, item validation, platform-specific queue requests, platform-specific display labels, legacy batch-row normalization, and the rule that unavailable LinkedIn execution does not call claim, start a batch, or report a result.

Manual extension checks cover:

1. Reloading the unpacked extension yields a valid manifest with Instagram and LinkedIn permissions.
2. Selecting Instagram fetches and starts only Instagram actions, preserving the current sender behavior.
3. Selecting LinkedIn fetches and displays only LinkedIn actions, with its Start control disabled and an explanatory message.
4. No n8n URL, n8n API key, auto-fetch, CRM-sync, or mark-done runtime path is present in the active extension.
5. A currently running or paused Instagram batch cannot be switched to LinkedIn.

## Phase 2 boundary

Phase 2 begins with a supervised Computer Use discovery session on a LinkedIn account and a controlled already-connected test recipient. It will document real page states and the semantic sequence needed to open an existing direct-message composer, enter text, confirm send, and recognize unavailable messaging. Only after that observation will a separate design and implementation plan define LinkedIn browser automation.
