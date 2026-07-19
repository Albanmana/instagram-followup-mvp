// Cold DM app API client.
// MOCK implementation: the real Cold DM app endpoints do not exist yet.
// Everything the UI needs goes through this one interface, so swapping the
// mock for real fetch() calls later will not touch sidepanel.js.

const MOCK_QUEUE = {
  campaign: "Coaching leads follow-up",
  items: [
    { handle: "your.test.account1", message: "Hey! Saw your comment — quick question for you." },
    { handle: "your.test.account2", message: "Hi! Loved your last post. Are you open to a chat?" },
    { handle: "your.test.account3", message: "Hello! Following up on your interest — still keen?" }
  ]
};

const RESULTS_KEY = "reportedResults";
const MAX_STORED_RESULTS = 1000;

export function createApiClient({ storage, now = () => new Date() }) {
  async function verifyApiKey(key) {
    if (/^cdm_[A-Za-z0-9]{8,}$/.test(key ?? "")) {
      return { ok: true, account: "@your.account" };
    }
    return { ok: false, error: "Invalid or expired API key" };
  }

  async function getStoredResults() {
    const { [RESULTS_KEY]: results = [] } = await storage.get(RESULTS_KEY);
    return results;
  }

  async function fetchQueue() {
    const today = now().toISOString().slice(0, 10);
    const results = await getStoredResults();
    const doneToday = new Set(
      results.filter((result) => (result.at ?? "").startsWith(today)).map((result) => result.handle)
    );

    return {
      campaign: MOCK_QUEUE.campaign,
      items: MOCK_QUEUE.items.filter((item) => !doneToday.has(item.handle))
    };
  }

  async function reportResults(results) {
    const stored = await getStoredResults();
    const seen = new Set(stored.map((result) => `${result.handle}|${result.at}`));
    const fresh = results.filter((result) => !seen.has(`${result.handle}|${result.at}`));

    if (fresh.length > 0) {
      const next = [...stored, ...fresh].slice(-MAX_STORED_RESULTS);
      await storage.set({ [RESULTS_KEY]: next });
    }

    return { ok: true, added: fresh.length };
  }

  async function getHistory() {
    const results = await getStoredResults();
    return [...results].sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  return { verifyApiKey, fetchQueue, reportResults, getHistory };
}

export const chromeStorageAdapter = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (obj) => chrome.storage.local.set(obj)
};
