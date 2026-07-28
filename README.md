# Cold DM — Sender

Chrome extension that processes platform-specific queues prepared by the Cold
DM app. The Cold DM App API is the sole channel for receiving queue actions,
claiming them, and reporting their results.

Architecture: see [docs/architecture.md](docs/architecture.md) and the
redesign spec in
[docs/superpowers/specs/2026-07-19-cold-dm-sender-redesign-design.md](docs/superpowers/specs/2026-07-19-cold-dm-sender-redesign-design.md).

## How it works

1. Select **Instagram** or **LinkedIn** in the side panel. The extension asks
   the Cold DM App API only for that platform's queue.
2. Instagram is executable in this release: **Start sending** claims the
   selected Instagram actions, opens their profiles, and sends with a safety
   delay.
3. LinkedIn is a display foundation only in this release. Its queue can be
   shown, but sending is locked and creates no claim, send, or result action.
4. Instagram results are sent back through the Cold DM App API so the app can
   update the action and message state.

The extension can use its platform-aware mock queue until the live Cold DM App
contract is deployed. Live LinkedIn queue display must not be treated as
available until that contract supports it.

## Install unpacked

1. Open `chrome://extensions`, enable Developer mode.
2. Load unpacked and select the `extension/` folder.
3. Click the toolbar icon: the side panel opens.
4. Enter the Cold DM App URL and API key. In local mock mode, any key matching
   `cdm_` plus one or more letters, numbers, or underscores is accepted.

## Development

- Run the automated checks with `npm test`.
- `extension/archive/` contains historical code only; it is not an operating
  path or integration setup.
- Raw engine details: side panel → Settings → Advanced → Show raw logs.
