# Cold DM — Sender

Chrome extension that sends the Instagram messages your Cold DM app has
prepared, from your own browser, and reports results back to the app.

Architecture: see [docs/architecture.md](docs/architecture.md) and the
redesign spec in
[docs/superpowers/specs/2026-07-19-cold-dm-sender-redesign-design.md](docs/superpowers/specs/2026-07-19-cold-dm-sender-redesign-design.md).

## How it works

1. The side panel fetches today's send queue from the Cold DM app
   (`api-client.js` is currently a mock; swap it for real endpoints without
   touching the UI or the engine).
2. **Start sending** hands the queue to the send engine (`background.js`),
   which opens each profile and sends with a safety delay between messages.
3. Results are reported back to the app, which updates the message tracker.

## Install unpacked

1. Open `chrome://extensions`, enable Developer mode.
2. Load unpacked and select the `extension/` folder.
3. Click the toolbar icon: the side panel opens.
4. Paste an API key. The mock accepts anything matching `cdm_` plus 8 chars.

## Development

- Tests for the mocked API client: `node --test`
- The legacy popup UI is archived in `extension/archive/`.
- Raw engine details: side panel → Settings → Advanced → Show raw logs.
