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

test("Instagram delegates only valid Instagram destinations", async () => {
  let called = false;
  const adapters = createPlatformAdapters({
    sendInstagramMessage: async () => {
      called = true;
      return { status: "sent", at: "2026-07-28T10:00:00.000Z" };
    },
    getInstagramSession: async () => true,
  });
  const adapter = getPlatformAdapter(adapters, "instagram");
  const item = { platform: "instagram", recipient: { profileUrl: "https://www.instagram.com/alice/" } };
  assert.equal(adapter.validateItem(item), null);
  await adapter.send(item);
  assert.equal(called, true);
});

test("rejects a mixed-platform batch", () => {
  assert.equal(validateBatchRows([{ platform: "instagram" }, { platform: "linkedin" }]), "A sender run must use one platform.");
});

test("accepts a single-platform batch", () => {
  assert.equal(validateBatchRows([{ platform: "instagram" }, { platform: "instagram" }]), null);
});
