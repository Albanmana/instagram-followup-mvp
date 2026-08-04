# LinkedIn Playwright Viewport Matrix Design

## Goal

Run the existing opt-in, real LinkedIn manual-send test at representative desktop window sizes so layout-dependent LinkedIn action discovery remains validated.

## Scope

The live test runs sequentially for four desktop profiles:

- `desktop-wide` — 1440x900
- `desktop-laptop` — 1280x720
- `desktop-compact` — 1024x768
- `desktop-narrow` — 768x1024

Every profile uses the same persistent LinkedIn login profile, temporary unpacked extension copy, Brice-only recipient guard, and timestamped message assertion. Each profile sends one test message when `LIVE_LINKEDIN_E2E=1` is explicitly supplied.

## Implementation

Define the four profiles in the Playwright live config. Pass the selected project viewport through the extension fixture to `launchPersistentContext`, configuring both Playwright's CSS `viewport` / `screen` and Chromium's native `--window-size` argument. The fixture continues to use one worker so real sends are serial.

The live spec is parameterized per profile. Its test title includes the profile name, producing separately attributable trace, screenshot, sidepanel HTML, and console artifacts on failure.

## Boundaries

This is desktop responsive coverage only. Mobile user-agent, touch input, and LinkedIn's mobile website are intentionally excluded because they are a different product workflow.

## Acceptance

- Normal `npm test` remains offline.
- Without `LIVE_LINKEDIN_E2E=1`, all viewport projects refuse before any browser or LinkedIn access.
- With explicit opt-in and the authenticated profile, each of the four profiles records `Sent` in extension history and renders its unique message in Brice's conversation.
- The persistent profile may be supplied explicitly with `PLAYWRIGHT_LINKEDIN_PROFILE_DIR`, allowing the same logged-in session to be reused from any worktree.
