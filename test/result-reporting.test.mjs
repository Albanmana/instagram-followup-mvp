import { test } from "node:test";
import assert from "node:assert/strict";
import { createExtensionResult } from "../extension/result-reporting.js";

test("emits only the strict Cold DM result contract", () => {
  assert.deepEqual(createExtensionResult({
    actionId: "00000000-0000-4000-8000-000000000001",
    messageId: "message-1",
    leadId: "lead-1",
    messageType: "first_dm",
    platform: "instagram",
    recipient: {
      handle: "alice",
      profileUrl: "https://www.instagram.com/alice/",
    },
    status: "sent",
    at: "2026-07-28T10:00:00.000Z",
  }), {
    actionId: "00000000-0000-4000-8000-000000000001",
    handle: "alice",
    status: "sent",
    at: "2026-07-28T10:00:00.000Z",
  });
});

test("derives a non-empty LinkedIn handle from the canonical profile slug", () => {
  assert.deepEqual(createExtensionResult({
    actionId: "00000000-0000-4000-8000-000000000001",
    platform: "linkedin",
    recipient: {
      handle: "   ",
      profileUrl: "https://www.linkedin.com/in/alice-martin-123/?trk=feed",
    },
    status: "failed",
    reason: "Direct messaging unavailable",
    at: "2026-07-28T10:00:00.000Z",
  }), {
    actionId: "00000000-0000-4000-8000-000000000001",
    handle: "alice-martin-123",
    status: "failed",
    reason: "Direct messaging unavailable",
    at: "2026-07-28T10:00:00.000Z",
  });
});

test("does not create a LinkedIn result without a trustworthy non-empty handle", () => {
  assert.equal(createExtensionResult({
    actionId: "00000000-0000-4000-8000-000000000001",
    platform: "linkedin",
    recipient: {
      profileUrl: "https://www.linkedin.com/company/acme/",
    },
    status: "skipped",
    at: "2026-07-28T10:00:00.000Z",
  }), null);
});

test("converts a skipped LinkedIn batch log into a strict result", () => {
  assert.deepEqual(createExtensionResult({
    actionId: "00000000-0000-4000-8000-000000000001",
    platform: "linkedin",
    recipient: { profileUrl: "https://www.linkedin.com/in/alice/" },
    status: "skipped",
    reason: "LinkedIn Send action is unavailable.",
    at: "2026-07-31T10:00:00.000Z",
  }), {
    actionId: "00000000-0000-4000-8000-000000000001",
    handle: "alice",
    status: "skipped",
    reason: "LinkedIn Send action is unavailable.",
    at: "2026-07-31T10:00:00.000Z",
  });
});
