# Instagram Follow-Up MVP

This project starts with the smallest useful slice of the Instagram automation app:

1. Load a Chrome Manifest V3 extension.
2. Enter an Instagram handle and a test message.
3. Open the target profile on Instagram.
4. Click `Message`.
5. Insert the text and attempt to send it.

The long-term architecture is documented in [docs/architecture.md](/Users/albanpro/claude-code-perso/work/instagram-followup-mvp/docs/architecture.md).
Reverse-engineered DMTracker notes live in [docs/dmtracker-api-notes.md](/Users/albanpro/claude-code-perso/work/instagram-followup-mvp/docs/dmtracker-api-notes.md).

## Step 1 Scope

The current implementation is intentionally narrow:

- No local database yet
- No follow-up sequencing yet
- No reply detection yet
- No scheduler yet

It assumes:

- Chrome is open
- The extension is loaded unpacked
- Instagram is already logged in
- The target account can receive messages

## Load The Extension

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select `/Users/albanpro/claude-code-perso/work/instagram-followup-mvp/extension`

## Test Flow

1. Click the extension icon.
2. Enter a handle without `@`.
3. Enter a short test message.
4. Click `Send test message`.
5. Watch the status text in the popup.
6. Click `Show latest logs` if the run stalls or fails.

## Debugging

There are now three useful places to inspect behavior:

1. The popup status text
2. The popup `Show latest logs` button
3. Chrome extension service worker logs

To inspect the service worker logs:

1. Open `chrome://extensions`
2. Find `Instagram Follow-Up MVP`
3. Click `Service Worker`
4. Read the console output

You can also open DevTools on the Instagram tab itself to inspect injected page-side logs.

If Instagram's UI changes, the extension will likely fail with a stage-specific error instead of silently doing nothing.
