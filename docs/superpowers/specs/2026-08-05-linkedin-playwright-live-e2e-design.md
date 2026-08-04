# LinkedIn Playwright live E2E design

## Goal

Run an opt-in end-to-end test against the real LinkedIn test profile through the unpacked Cold DM extension, without operating the user's everyday Chrome profile.

## Architecture

Playwright launches its bundled Chromium with a dedicated persistent user-data directory and loads `extension/` as a Manifest V3 extension. The first local run opens that browser for a one-time LinkedIn login; later runs reuse only this dedicated profile.

The test obtains the extension ID from its service worker, opens `sidepanel.html`, selects LinkedIn, enters the canonical Brice test-profile URL and a unique test message, and presses `Send test`. It waits for the extension history to record a `Sent` result, then checks that the same unique text is visible in the real LinkedIn conversation.

## Constraints

- Use Playwright's bundled Chromium, not the user's normal Google Chrome profile.
- The test is opt-in and must refuse to run unless `LIVE_LINKEDIN_E2E=1` is supplied.
- It may send only to the explicit test URL `https://www.linkedin.com/in/brice-biaou-32387b156/`.
- Every sent text includes a timestamped `Cold DM Playwright e2e` prefix so it is identifiable.
- The normal Node test suite remains offline and fast; the live test is a separate command.
- A failed LinkedIn assertion must preserve Playwright trace, screenshot, and extension-side diagnostics as test artifacts.

## Test flow

1. Launch the persistent Playwright profile with the unpacked extension.
2. Discover the MV3 service worker and derive the runtime extension ID.
3. Navigate the sidepanel page, fill the manual LinkedIn form, and start the batch.
4. Wait for the real LinkedIn profile/compose/send path to finish.
5. Assert `Sent` in the extension history and the unique text in the real LinkedIn conversation.
6. On failure, retain the trace, screenshot, console logs, and sidepanel status; close the browser only after capture.

## Non-goals

- No mock LinkedIn page for this live test.
- No queue API, Cold DM account setup, or production recipient test.
- No execution in CI by default.
