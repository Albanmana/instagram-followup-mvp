import { test } from "node:test";
import assert from "node:assert/strict";
import { createApiClient } from "../extension/api-client.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
    },
    async set(obj) {
      Object.assign(data, obj);
    },
    _data: data
  };
}

const NOW = () => new Date("2026-07-19T10:00:00Z");

test("verifyApiKey accepts cdm_ keys and rejects others", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  assert.equal((await api.verifyApiKey("cdm_abcd1234")).ok, true);
  assert.equal((await api.verifyApiKey("nope")).ok, false);
  assert.equal((await api.verifyApiKey("")).ok, false);
});

test("fetchQueue returns campaign and items", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const queue = await api.fetchQueue();
  assert.equal(typeof queue.campaign, "string");
  assert.ok(queue.items.length > 0);
  assert.ok(queue.items.every((item) => item.handle && item.message));
});

test("fetchQueue excludes handles already reported today", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const before = await api.fetchQueue();
  const first = before.items[0];
  await api.reportResults([{ handle: first.handle, status: "sent", at: "2026-07-19T09:00:00Z" }]);
  const after = await api.fetchQueue();
  assert.equal(after.items.length, before.items.length - 1);
  assert.ok(!after.items.some((item) => item.handle === first.handle));
});

test("fetchQueue does NOT exclude handles reported on previous days", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const before = await api.fetchQueue();
  await api.reportResults([{ handle: before.items[0].handle, status: "sent", at: "2026-07-18T09:00:00Z" }]);
  const after = await api.fetchQueue();
  assert.equal(after.items.length, before.items.length);
});

test("reportResults dedupes on handle + at", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const result = { handle: "someone", status: "sent", at: "2026-07-19T09:00:00Z" };
  const first = await api.reportResults([result]);
  const second = await api.reportResults([result]);
  assert.equal(first.added, 1);
  assert.equal(second.added, 0);
  assert.equal((await api.getHistory()).length, 1);
});

test("getHistory returns newest first", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  await api.reportResults([
    { handle: "older", status: "sent", at: "2026-07-18T09:00:00Z" },
    { handle: "newer", status: "failed", reason: "Profile not found", at: "2026-07-19T09:30:00Z" }
  ]);
  const history = await api.getHistory();
  assert.equal(history[0].handle, "newer");
  assert.equal(history[1].handle, "older");
});

test("claimQueue normalizes the Cold DM claimed action IDs", async () => {
  const storage = memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" });
  const api = createApiClient({
    storage,
    baseUrl: "https://cold-dm.example",
    fetchFn: async () => new Response(JSON.stringify({ claimed: ["action-1"], skipped: ["action-2"] }), { status: 200 })
  });
  const result = await api.claimQueue([{ actionId: "action-1" }, { actionId: "action-2" }]);
  assert.deepEqual(result, { claimed: ["action-1"], skipped: ["action-2"] });
});

test("fetchQueue preserves first-DM and follow-up message types", async () => {
  const storage = memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" });
  const api = createApiClient({
    storage,
    baseUrl: "https://cold-dm.example",
    fetchFn: async () => new Response(JSON.stringify({ campaigns: [{ campaign: { id: "campaign-1", name: "Campaign" }, items: [
      { actionId: "action-1", messageId: "message-1", leadId: "lead-1", handle: "first", message: "Hello", messageType: "first_dm" },
      { actionId: "action-2", messageId: "message-2", leadId: "lead-2", handle: "follow", message: "Checking in", messageType: "followup" }
    ] }] }), { status: 200 })
  });
  const queue = await api.fetchQueue();
  assert.deepEqual(queue.items.map((item) => item.messageType), ["first_dm", "followup"]);
});
