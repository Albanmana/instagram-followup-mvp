# LinkedIn Direct Message or Invitation Design

## Goal

Deliver one queued or manual LinkedIn message by using the least restrictive action LinkedIn visibly offers for the intended profile: a normal message when available, otherwise a connection invitation with a note.

## Decision Flow

1. Open and verify the intended canonical LinkedIn profile URL.
2. Inspect only the visible action area belonging to that profile, retrying briefly while LinkedIn hydrates it.
3. If it exposes one unambiguous normal `Message` compose route bound to the profile, use the existing compose workflow. This route is valid regardless of whether the profile visibly says `1st`, `2nd`, or another connection degree; message length is not constrained by the invitation-note limit.
4. Otherwise, if it exposes one unambiguous `Connect` action, use the invitation workflow:
   - Open the visible profile action menu when `Connect` is in the three-dot menu.
   - Click the profile-scoped `Connect` action.
   - Click `Add a note` in the invitation dialog.
   - Enter the queued message into the invitation-note field.
   - Click the enabled `Send` button in that invitation dialog.
5. Otherwise return `skipped` with a reason identifying which required LinkedIn action was unavailable or ambiguous.

The existing direct-message path remains preferred. A visible Message action that is clearly an InMail or Open Profile route is not a normal message route and must not be selected.

## Invitation Note Limit

The 200-character limit applies only when the invitation fallback is selected. Before opening the connection UI, calculate the trimmed message length:

- At most 200 characters: continue with the invitation note workflow.
- More than 200 characters: do not click Connect and return:

  ```text
  LinkedIn invitation notes are limited to 200 characters; the queued message has <length>.
  ```

Normal direct messages are never skipped solely because they exceed 200 characters.

## Outcome and Reporting

The sender returns the existing structured outcome contract:

- Direct message confirmed: `{ status: "sent" }`.
- Invitation send confirmed: `{ status: "sent" }`.
- No usable normal-message route, unavailable/ambiguous connect route, unavailable note dialog, missing note field, unavailable send control, or over-limit note: `{ status: "skipped", reason }`.
- A selected action that cannot establish the exact queued text, or whose completion cannot be confirmed: `{ status: "failed", reason }`.

Existing result reporting already keeps non-sent `reason` values and sends them to Cold DM. No API contract change is needed. The precise over-limit reason above is deliberately user-facing so the app can explain why the queue item did not run.

## Implementation Boundaries

- Keep all action discovery scoped to the visible target profile. Never choose navigation, recommendation, or global header actions.
- Keep recipient/profile identity validation before direct-message sending. For invitations, validate the target profile before clicking any action and keep the action chain within the active invitation dialog.
- Do not create an invitation when a normal direct message is visibly available.
- Do not try a different delivery mechanism after an invitation attempt fails; report the observed state instead of risking a duplicate request.
- Do not automate mobile LinkedIn, touch UI, InMail, or Open Profile messaging in this change.

## Tests

Unit tests cover:

- A direct Message route is selected even without `1st` connection evidence and does not apply the 200-character limit.
- Message routes marked InMail or Open Profile are rejected as normal direct messages.
- Connect discovery is limited to the visible target profile and rejects ambiguous or hidden actions.
- Invitation messages of 200 characters are eligible; 201-character messages return the exact `skipped` reason before a Connect click.
- The invitation interaction writes the exact text only into the active note dialog, clicks only its enabled Send button, and requires a visible terminal confirmation before reporting `sent`.
- Missing Connect, Add a note, note field, or Send controls produce exact non-sent reasons.
- The existing result reporting serializes an invitation `skipped` reason unchanged.

Live Playwright coverage uses a separately approved test profile and a connection invitation only when the user explicitly authorizes a real external invitation. The existing Brice direct-message test remains the regression test for the preferred route.
