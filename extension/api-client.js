// Authenticated bridge between the sender extension and Cold DM App.
// The extension receives executable actions only: no prompts or profile data.

import { isPlatform, normalizeQueueItem } from "./platforms.js";

const RESULTS_KEY = "reportedResults";
const MAX_STORED_RESULTS = 1000;

export function createApiClient({ storage, baseUrl, fetchFn = globalThis.fetch, now = () => new Date() }) {
  const mockMode = baseUrl === undefined;
  const defaultBaseUrl = "https://cold-dm-app-phi.vercel.app";

  function getMockQueue(platform) {
    const rawItem = {
      actionId: "00000000-0000-4000-8000-000000000001",
      messageId: "00000000-0000-4000-8000-000000000002",
      leadId: "00000000-0000-4000-8000-000000000003",
      platform,
      handle: "local.test",
      displayName: "Local Test",
      profileUrl: platform === "linkedin"
        ? "https://www.linkedin.com/in/local.test/"
        : "https://www.instagram.com/local.test/",
      message: "Test message",
      messageType: "first_dm",
    };
    return {
      campaign: "Local test queue",
      items: [normalizeQueueItem(rawItem, { name: "Local test queue" })],
    };
  }

  async function getStoredResults() {
    const { [RESULTS_KEY]: results = [] } = await storage.get(RESULTS_KEY);
    return results;
  }

  async function getCredentials() {
    const values = await storage.get(["coldDmApiKey", "coldDmBaseUrl"]);
    return { key: values.coldDmApiKey ?? "", url: baseUrl || values.coldDmBaseUrl || defaultBaseUrl };
  }

  async function request(path, options = {}) {
    const credentials = await getCredentials();
    if (!credentials.key) throw new Error("API key is required");
    if (!credentials.url) throw new Error("Cold DM app URL is not configured");
    const response = await fetchFn(`${credentials.url.replace(/\/$/, "")}${path}`, { ...options, headers: { Authorization: `Bearer ${credentials.key}`, "Content-Type": "application/json", ...(options.headers ?? {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? `Cold DM API error (${response.status})`);
    return body;
  }

  async function verifyApiKey(key) {
    const value = (key ?? "").trim();
    if (!value) return { ok: false, error: "API key is required" };
    if (mockMode) {
      return /^cdm_[A-Za-z0-9_]+$/.test(value)
        ? { ok: true, account: "Cold DM app (local mock)" }
        : { ok: false, error: "Invalid API key" };
    }
    try {
      const credentials = await storage.get("coldDmBaseUrl");
      const url = baseUrl || credentials.coldDmBaseUrl || defaultBaseUrl;
      const response = await fetchFn(`${url.replace(/\/$/, "")}/api/ext/v1/me`, { headers: { Authorization: `Bearer ${value}` } });
      const body = await response.json().catch(() => ({}));
      return response.ok ? { ok: true, account: body.workspace_name ?? body.workspace?.name ?? body.account ?? "Cold DM app" } : { ok: false, error: body.error ?? "Invalid API key" };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Connection failed" };
    }
  }

  async function fetchQueue(platform) {
    if (!isPlatform(platform)) throw new Error("A supported platform is required");
    if (mockMode) {
      const today = now().toISOString().slice(0, 10);
      const done = new Set((await getStoredResults()).filter((item) => (item.at ?? "").startsWith(today)).map((item) => item.handle));
      const queue = getMockQueue(platform);
      return { ...queue, items: queue.items.filter((item) => !done.has(item.recipient.handle)) };
    }
    const query = new URLSearchParams({ platform });
    const response = await request(`/api/ext/v1/queue?${query}`);
    const campaigns = Array.isArray(response.campaigns) ? response.campaigns : [];
    return {
      campaigns,
      campaign: campaigns[0]?.campaign?.name ?? null,
      items: campaigns.flatMap(({ campaign, items = [] }) =>
        (Array.isArray(items) ? items : [])
          .map((item) => normalizeQueueItem(item, campaign))
          .filter((item) => item?.platform === platform)
      ).filter(Boolean),
    };
  }

  async function claimQueue(items, platform) {
    if (!isPlatform(platform)) throw new Error("A supported platform is required");
    if (mockMode) return { claimed: items.map((item) => item.actionId), skipped: [] };
    const response = await request("/api/ext/v1/queue/claim", { method: "POST", body: JSON.stringify({ actionIds: items.map((item) => item.actionId), platform }) });
    return {
      claimed: Array.isArray(response.claimed) ? response.claimed : [],
      skipped: Array.isArray(response.skipped) ? response.skipped : []
    };
  }

  async function reportResults(results) {
    const stored = await getStoredResults();
    const fresh = results.filter((result) => !stored.some((item) => item.actionId === result.actionId && item.at === result.at));
    if (fresh.length > 0) await storage.set({ [RESULTS_KEY]: [...stored, ...fresh].slice(-MAX_STORED_RESULTS) });
    if (mockMode) return { ok: true, added: fresh.length };
    if (fresh.length === 0) return { ok: true, added: 0 };
    try {
      const response = await request("/api/ext/v1/results", { method: "POST", body: JSON.stringify({ results: fresh }) });
      await storage.set({ [RESULTS_KEY]: stored.filter((item) => !fresh.some((result) => result.actionId === item.actionId && result.at === item.at)) });
      return { ...response, added: fresh.length };
    } catch (error) {
      return { ok: false, added: fresh.length, error: error instanceof Error ? error.message : "Could not report results" };
    }
  }

  async function getHistory() {
    const results = await getStoredResults();
    return [...results].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  return { verifyApiKey, fetchQueue, claimQueue, reportResults, getHistory, now };
}

export const chromeStorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj)
};
