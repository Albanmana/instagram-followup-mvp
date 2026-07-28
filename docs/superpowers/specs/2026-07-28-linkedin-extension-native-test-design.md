# LinkedIn Extension-Native Send Test Design

## Goal

Prove the LinkedIn direct-message sequence using code executed by the Cold DM
extension itself, not by an external browser-control tool. This is a temporary,
developer-triggered test path only; it does not read a queue, claim an action,
or call the Cold DM App result API.

## Scope

The test receives an already-connected recipient's canonical LinkedIn profile
URL and a message. It executes this sequence through the extension service
worker and `chrome.scripting.executeScript`:

1. Open the profile URL in an active tab and wait for it to load.
2. In the profile page, find the visible `Message` link whose href begins with
   `/messaging/compose/`.
3. Navigate the same tab to that exact href.
4. Verify that the composition page has a recipient chip and that its profile
   link matches the supplied profile identity.
5. Find the visible LinkedIn contenteditable composer, enter the message using
   browser DOM APIs, and confirm that the Send button becomes enabled.
6. Click Send and verify the composer becomes empty and disabled while the sent
   message is visible in the conversation.

## Boundaries

- Only existing LinkedIn connections are supported. Missing `Message` links,
  recipient mismatches, InMail prompts, or unavailable messaging return a
  structured `skipped` or `failed` outcome; the test must never send a
  connection invitation.
- The test uses the same injected functions that the eventual LinkedIn
  platform adapter will call. It must not depend on Codex browser APIs,
  dynamic automation node IDs, DevTools, or a hand-operated page state.
- The test remains unreachable from the normal batch start path. It is exposed
  only by a temporary `SEND_LINKEDIN_TEST_MESSAGE` extension runtime message.
- The test creates no Cold DM App queue claim or result update.

## Components

`background.js` owns tab creation/navigation, waits for the tab to load,
injects the LinkedIn page functions, and returns a structured result to the
runtime-message caller. It also records stage logs through the existing run-log
mechanism.

`linkedin-send.js` contains pure-in-the-page helpers injected by the service
worker: profile Message-link discovery, recipient verification, composer
discovery, DOM-based message entry, Send-button discovery, and post-send
verification. The module does not use Chrome APIs so its behavior can be
unit-tested where practical.

The manifest already contains LinkedIn host permission and `scripting`; no new
permission or content-script registration is required.

## Test contract

```js
chrome.runtime.sendMessage({
  type: "SEND_LINKEDIN_TEST_MESSAGE",
  payload: {
    profileUrl: "https://www.linkedin.com/in/example/",
    message: "Test message",
  },
});
```

It resolves to one of:

```js
{ status: "sent", recipientProfileUrl, sentText, at }
{ status: "skipped", reason, at }
{ status: "failed", reason, at }
```

## Verification

Automated tests cover profile-URL validation, exact compose-link recognition,
recipient identity matching, and every non-sent outcome classification. A
supervised manual run against the already-connected Brice Biaou profile sends a
user-authorized test string and verifies the `sent` result plus its visible
LinkedIn conversation evidence.

## Future reuse

Phase 2 queue execution calls the same `sendLinkedInMessage` service-worker
function through the LinkedIn platform adapter. It replaces only the temporary
runtime-message trigger with the normal claimed queue item and result-reporting
path.
