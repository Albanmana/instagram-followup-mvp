import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeQueueItem,
  recipientLabel,
  legacyInstagramProfileUrl,
} from "../extension/platforms.js";

const campaign = { id: "campaign-1", name: "Campaign" };

test("normalizes a LinkedIn item with a canonical profile URL", () => {
  const item = normalizeQueueItem({
    actionId: "action-1", messageId: "message-1", leadId: "lead-1",
    platform: "linkedin", profileUrl: "https://www.linkedin.com/in/alice/",
    displayName: "Alice Martin", handle: "alice", message: "Hello",
    messageType: "first_dm",
  }, campaign);
  assert.deepEqual(item.recipient, {
    displayName: "Alice Martin",
    profileUrl: "https://www.linkedin.com/in/alice/",
    handle: "alice",
  });
  assert.equal(recipientLabel(item), "Alice Martin");
});

test("does not prefix a LinkedIn fallback label with at-sign", () => {
  const item = normalizeQueueItem({
    actionId: "action-1", messageId: "message-1", leadId: "lead-1",
    platform: "linkedin", profileUrl: "https://www.linkedin.com/in/alice/",
    displayName: null, handle: "alice", message: "Hello", messageType: "first_dm",
  }, campaign);
  assert.equal(recipientLabel(item), "alice");
});

test("migrates a legacy Instagram row only when it has a handle", () => {
  const item = normalizeQueueItem({
    actionId: "action-1", messageId: "message-1", leadId: "lead-1",
    handle: "cold.dm", message: "Hello", messageType: "first_dm",
  }, campaign);
  assert.equal(item.platform, "instagram");
  assert.equal(item.recipient.profileUrl, legacyInstagramProfileUrl("cold.dm"));
  assert.equal(normalizeQueueItem({ message: "Hello" }, campaign), null);
});
