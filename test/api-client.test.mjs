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

test("verifyApiKey uses the production Cold DM App URL by default", async () => {
  let requestedUrl;
  const api = createApiClient({
    storage: memoryStorage(),
    baseUrl: "",
    fetchFn: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ workspace_name: "Cold DM" }), { status: 200 });
    },
  });

  await api.verifyApiKey("cdm_live_test");
  assert.equal(requestedUrl, "https://cold-dm-app-phi.vercel.app/api/ext/v1/me");
});

test("fetchQueue returns campaign and items", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const queue = await api.fetchQueue("instagram");
  assert.equal(typeof queue.campaign, "string");
  assert.ok(queue.items.length > 0);
  assert.ok(queue.items.every((item) => item.platform === "instagram" && item.recipient.handle && item.recipient.profileUrl && item.message));
});

test("fetchQueue excludes handles already reported today", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const before = await api.fetchQueue("instagram");
  const first = before.items[0];
  await api.reportResults([{ handle: first.recipient.handle, status: "sent", at: "2026-07-19T09:00:00Z" }]);
  const after = await api.fetchQueue("instagram");
  assert.equal(after.items.length, before.items.length - 1);
  assert.ok(!after.items.some((item) => item.recipient.handle === first.recipient.handle));
});

test("fetchQueue does NOT exclude handles reported on previous days", async () => {
  const api = createApiClient({ storage: memoryStorage(), now: NOW });
  const before = await api.fetchQueue("instagram");
  await api.reportResults([{ handle: before.items[0].recipient.handle, status: "sent", at: "2026-07-18T09:00:00Z" }]);
  const after = await api.fetchQueue("instagram");
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

test("getManualTestHistory reads locally stored manual outcomes without credentials", async () => {
  const storage = memoryStorage({
    manualTestHistory: [
      { actionId: "manual-older", at: "2026-07-18T09:00:00Z", localOnly: true },
      { actionId: "manual-newer", at: "2026-07-19T09:00:00Z", localOnly: true },
    ],
  });
  const api = createApiClient({ storage, baseUrl: "" });
  assert.deepEqual((await api.getManualTestHistory()).map((entry) => entry.actionId), ["manual-newer", "manual-older"]);
});

test("claimQueue normalizes the Cold DM claimed action IDs", async () => {
  const storage = memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" });
  const api = createApiClient({
    storage,
    baseUrl: "https://cold-dm.example",
    fetchFn: async () => new Response(JSON.stringify({ claimed: ["action-1"], skipped: ["action-2"] }), { status: 200 })
  });
  const result = await api.claimQueue([{ actionId: "action-1" }, { actionId: "action-2" }], "instagram");
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
  const queue = await api.fetchQueue("instagram");
  assert.deepEqual(queue.items.map((item) => item.messageType), ["first_dm", "followup"]);
});

test("fetchQueue requests and preserves the selected platform", async () => {
  const requests = [];
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async (url, options = {}) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ campaigns: [{ campaign: { id: "campaign-1", name: "Campaign" }, items: [{
        actionId: "action-1", messageId: "message-1", leadId: "lead-1", platform: "linkedin",
        profileUrl: "https://www.linkedin.com/in/alice/", displayName: "Alice", handle: "alice",
        message: "Hello", messageType: "first_dm",
      }] }] }), { status: 200 });
    },
  });
  const queue = await api.fetchQueue("linkedin");
  assert.match(requests[0].url, /\/api\/ext\/v1\/queue\?platform=linkedin$/);
  assert.equal(queue.items[0].platform, "linkedin");
  assert.equal(queue.items[0].recipient.profileUrl, "https://www.linkedin.com/in/alice/");
});

test("claimQueue sends the selected platform", async () => {
  let body;
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ claimed: ["action-1"], skipped: [] }), { status: 200 }); },
  });
  await api.claimQueue([{ actionId: "action-1" }], "instagram");
  assert.deepEqual(body, { actionIds: ["action-1"], platform: "instagram" });
});

test("reportResults posts only the strict result fields", async () => {
  let body;
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async (_url, options) => {
      body = JSON.parse(options.body);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await api.reportResults([{
    actionId: "00000000-0000-4000-8000-000000000001",
    handle: "alice",
    status: "sent",
    at: "2026-07-28T10:00:00.000Z",
    platform: "linkedin",
    messageId: "message-1",
    recipient: { profileUrl: "https://www.linkedin.com/in/alice/" },
  }]);

  assert.deepEqual(body, {
    results: [{
      actionId: "00000000-0000-4000-8000-000000000001",
      handle: "alice",
      status: "sent",
      at: "2026-07-28T10:00:00.000Z",
    }],
  });
});

test("reportResults retries a result after a failed remote response", async () => {
  const storage = memoryStorage({
    coldDmApiKey: "cdm_live_test",
    coldDmBaseUrl: "https://cold-dm.example",
  });
  let attempts = 0;
  const api = createApiClient({
    storage,
    baseUrl: "https://cold-dm.example",
    fetchFn: async () => {
      attempts += 1;
      return new Response(
        JSON.stringify(attempts === 1 ? { error: "Temporary failure" } : { ok: true }),
        { status: attempts === 1 ? 503 : 200 },
      );
    },
  });
  const result = {
    actionId: "00000000-0000-4000-8000-000000000001",
    handle: "alice",
    status: "sent",
    at: "2026-07-28T10:00:00.000Z",
  };

  assert.equal((await api.reportResults([result])).ok, false);
  assert.deepEqual(await api.getHistory(), []);
  assert.equal((await api.reportResults([result])).ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(await api.getHistory(), [result]);
});

test("fetchQueue discards invalid and mismatched-platform server rows", async () => {
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async () => new Response(JSON.stringify({ campaigns: [{ campaign: { id: "campaign-1", name: "Campaign" }, items: [
      { actionId: "linkedin-1", messageId: "message-1", leadId: "lead-1", platform: "linkedin", profileUrl: "https://www.linkedin.com/in/alice/", message: "Hello" },
      { actionId: "instagram-1", messageId: "message-2", leadId: "lead-2", platform: "instagram", profileUrl: "https://www.instagram.com/alice/", message: "Hello" },
      { actionId: "linkedin-invalid", messageId: "message-3", leadId: "lead-3", platform: "linkedin", message: "Hello" },
    ] }] }), { status: 200 }),
  });

  const queue = await api.fetchQueue("linkedin");

  assert.deepEqual(queue.items.map((item) => item.actionId), ["linkedin-1"]);
});

test("platform queue calls reject unsupported platforms before requesting", async () => {
  let requests = 0;
  const api = createApiClient({
    storage: memoryStorage({ coldDmApiKey: "cdm_live_test", coldDmBaseUrl: "https://cold-dm.example" }),
    baseUrl: "https://cold-dm.example",
    fetchFn: async () => { requests += 1; return new Response("{}", { status: 200 }); },
  });

  await assert.rejects(api.fetchQueue("facebook"), /platform/i);
  await assert.rejects(api.claimQueue([], "facebook"), /platform/i);
  assert.equal(requests, 0);
});
