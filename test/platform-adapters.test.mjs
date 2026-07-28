import { test } from "node:test";
import assert from "node:assert/strict";
import { createPlatformAdapters, getPlatformAdapter } from "../extension/platform-adapters.js";
import { validateBatchRows } from "../extension/batch-validation.js";

const linkedInItem = {
  platform: "linkedin",
  recipient: {
    profileUrl: "https://www.linkedin.com/in/alice/",
    displayName: "Alice",
    handle: "alice",
  },
};

test("LinkedIn is recognized but cannot execute in phase 1", async () => {
  const adapters = createPlatformAdapters({
    sendInstagramMessage: async () => ({ status: "sent", at: "2026-07-28T10:00:00.000Z" }),
    getInstagramSession: async () => true,
  });
  const adapter = getPlatformAdapter(adapters, "linkedin");
  assert.equal(adapter.validateItem(linkedInItem), null);
  assert.deepEqual(adapter.canExecute(), { ok: false, reason: "LinkedIn sending is being prepared." });
});

test("Instagram sends only when the canonical profile URL and handle identify the same recipient", async () => {
  const sentItems = [];
  const adapters = createPlatformAdapters({
    sendInstagramMessage: async (item) => {
      sentItems.push(item);
      return { status: "sent", at: "2026-07-28T10:00:00.000Z" };
    },
    getInstagramSession: async () => true,
  });
  const adapter = getPlatformAdapter(adapters, "instagram");
  const item = {
    platform: "instagram",
    handle: "stale-top-level-handle",
    recipient: {
      profileUrl: "https://www.instagram.com/alice/",
      handle: "alice",
    },
  };
  assert.equal(adapter.validateItem(item), null);
  await adapter.send(item);
  assert.equal(sentItems.length, 1);
  assert.equal(sentItems[0].handle, "alice");
  assert.equal(sentItems[0].recipient.handle, "alice");

  assert.equal(
    adapter.validateItem({
      platform: "instagram",
      recipient: {
        profileUrl: "https://www.instagram.com/alice/",
        handle: "bob",
      },
    }),
    "Instagram profile URL and handle must match.",
  );
  assert.equal(
    adapter.validateItem({
      platform: "instagram",
      recipient: { profileUrl: "https://www.instagram.com/alice/" },
    }),
    "Instagram profile URL and handle must match.",
  );
});

test("rejects a mixed-platform batch", () => {
  assert.equal(validateBatchRows([{ platform: "instagram" }, { platform: "linkedin" }]), "A sender run must use one platform.");
});

test("accepts a single-platform batch", () => {
  assert.equal(validateBatchRows([{ platform: "instagram" }, { platform: "instagram" }]), null);
});
