import { createApiClient, chromeStorageAdapter, DEFAULT_COLD_DM_APP_URL } from "./api-client.js";
import {
  isPlatform,
  createManualTestItem,
  normalizePersistedQueueItems,
  platformLabel,
  recipientLabel,
} from "./platforms.js";

const api = createApiClient({ storage: chromeStorageAdapter, baseUrl: "" });
const $ = (id) => document.getElementById(id);

const DEFAULT_DELAY_SECONDS = 400;
const DEFAULT_QUEUE_POLLING_HOURS = 3;
const state = {
  queue: null,
  nextSendAt: null,
  pausedItems: null,
  selectedPlatform: "instagram",
  capability: null
};

let pollTimer = null;
let countdownTimer = null;
let queuePollTimer = null;
let lastSeenIndex = -1;
let queueGeneration = 0;

function showView(name) {
  $("view-main").hidden = name !== "main";
  $("view-settings").hidden = name !== "settings";
}

function setHeaderStatus(text, tone = "") {
  const el = $("header-status");
  el.textContent = text;
  el.className = `header-status ${tone}`.trim();
}

function showTab(name) {
  $("tab-today").hidden = name !== "today";
  $("tab-history").hidden = name !== "history";
  $("tab-today-button").classList.toggle("is-active", name === "today");
  $("tab-history-button").classList.toggle("is-active", name === "history");
  $("tab-today-button").setAttribute("aria-selected", String(name === "today"));
  $("tab-history-button").setAttribute("aria-selected", String(name === "history"));
}

async function getSettings() {
  const {
    coldDmApiKey = "",
    coldDmAccount = "",
    coldDmBaseUrl = DEFAULT_COLD_DM_APP_URL,
    sendDelaySeconds = DEFAULT_DELAY_SECONDS,
    queuePollingHours = DEFAULT_QUEUE_POLLING_HOURS,
    selectedPlatform: storedPlatform
  } = await chrome.storage.local.get([
    "coldDmApiKey",
    "coldDmAccount",
    "coldDmBaseUrl",
    "sendDelaySeconds",
    "queuePollingHours",
    "selectedPlatform"
  ]);
  const platform = isPlatform(storedPlatform) ? storedPlatform : "instagram";
  if (storedPlatform !== platform) await chrome.storage.local.set({ selectedPlatform: platform });
  return {
    coldDmApiKey,
    coldDmAccount,
    coldDmBaseUrl,
    sendDelaySeconds,
    queuePollingHours,
    selectedPlatform: platform
  };
}

function selectedPlatform() {
  return state.selectedPlatform;
}

function setPlatformControlsDisabled(disabled) {
  $("platform-select").disabled = disabled;
}

async function getPlatformCapability(platform) {
  return chrome.runtime.sendMessage({ type: "GET_PLATFORM_CAPABILITY", platform });
}

async function applySelectedPlatform(platform, { persist = true } = {}) {
  const normalized = isPlatform(platform) ? platform : "instagram";
  state.selectedPlatform = normalized;
  $("platform-select").value = normalized;
  if (persist) await chrome.storage.local.set({ selectedPlatform: normalized });
}

function recipientItem(entry) {
  if (entry?.recipient) return entry;
  return {
    platform: isPlatform(entry?.platform) ? entry.platform : "instagram",
    recipient: {
      displayName: entry?.displayName ?? null,
      handle: entry?.handle ?? null,
      profileUrl: entry?.profileUrl ?? ""
    }
  };
}

function displayRecipient(entry) {
  return recipientLabel(recipientItem(entry)) || "Unknown recipient";
}

function initials(label) {
  return String(label ?? "").replace(/^@+/, "").slice(0, 2).toUpperCase();
}

function messagePreview(message) {
  return message.length > 45 ? `${message.slice(0, 45)}...` : message;
}

function messageTypeLabel(messageType) {
  return messageType === "followup" ? "Follow-up" : "First DM";
}

function clearQueuePolling() {
  clearInterval(queuePollTimer);
  queuePollTimer = null;
}

async function scheduleQueuePolling() {
  clearQueuePolling();
  if (!state.queue || state.pausedItems?.length) return;
  const { queuePollingHours } = await getSettings();
  const hours = [1, 3, 6, 12, 24].includes(Number(queuePollingHours)) ? Number(queuePollingHours) : DEFAULT_QUEUE_POLLING_HOURS;
  queuePollTimer = setInterval(() => refreshToday({ automatic: true }), hours * 60 * 60 * 1000);
}

function setQueueSyncStatus(text, isError = false) {
  const element = $("queue-sync-status");
  element.textContent = text;
  element.classList.toggle("error-text", isError);
}

function renderList(entries) {
  const list = $("recipient-list");
  list.innerHTML = "";

  for (const entry of entries) {
    const li = document.createElement("li");
    if (entry.current) li.className = "current";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const recipient = displayRecipient(entry.item);
    avatar.textContent = initials(recipient);

    const who = document.createElement("div");
    who.className = "who";

    const name = document.createElement("b");
    name.textContent = recipient;

    const sub = document.createElement("span");
    sub.textContent = entry.sub ?? "";

    const status = document.createElement("span");
    status.className = `status ${entry.statusClass}`;
    status.textContent = entry.status;

    who.append(name, sub);
    li.append(avatar, who, status);
    list.appendChild(li);
  }

  $("list-card").hidden = entries.length === 0;
}

function clearDisplayedQueue() {
  queueGeneration += 1;
  state.queue = null;
  $("queue-card").hidden = true;
  $("empty-card").hidden = true;
  $("run-card").hidden = true;
  renderList([]);
  resetCapabilityDisplay();
}

function resetCapabilityDisplay() {
  state.capability = null;
  $("platform-capability").textContent = "";
  $("platform-capability").hidden = true;
  $("login-banner").hidden = true;
  $("start-button").disabled = false;
  $("start-button").textContent = "Start sending";
}

function applyCapability(capability, hasQueuedRows) {
  state.capability = capability;
  $("login-banner").textContent = capability.loginMessage ?? "";
  const unavailable = hasQueuedRows && !capability.executable;
  $("platform-capability").textContent = unavailable ? capability.reason ?? "Sending is not available yet." : "";
  $("platform-capability").hidden = !unavailable;
  $("start-button").disabled = unavailable;
  $("start-button").textContent = unavailable ? "Sending not available yet" : "Start sending";
}

async function startRun(items) {
  const platform = selectedPlatform();
  const startQueueGeneration = queueGeneration;
  const keepSelectorLocked = Array.isArray(state.pausedItems) && state.pausedItems.length > 0;
  setPlatformControlsDisabled(true);
  const capability = await getPlatformCapability(platform);
  if (platform !== selectedPlatform()) {
    if (!keepSelectorLocked) setPlatformControlsDisabled(false);
    return false;
  }
  if (!capability?.ok || capability.platform !== platform) {
    setHeaderStatus(capability?.error ?? "Could not check platform availability", "");
    if (!keepSelectorLocked) setPlatformControlsDisabled(false);
    return false;
  }
  applyCapability(capability, items.length > 0);
  if (!capability.executable) {
    if (!keepSelectorLocked) setPlatformControlsDisabled(false);
    return false;
  }
  if (!capability.loggedIn) {
    $("login-banner").textContent = capability.loginMessage ?? `Log in to ${platformLabel(platform)} in this browser, then resume.`;
    $("login-banner").hidden = false;
    if (!keepSelectorLocked) setPlatformControlsDisabled(false);
    return false;
  }

  $("login-banner").hidden = true;
  clearQueuePolling();
  const { sendDelaySeconds } = await getSettings();
  if (platform !== selectedPlatform() || startQueueGeneration !== queueGeneration) {
    if (!keepSelectorLocked) setPlatformControlsDisabled(false);
    return false;
  }
  const claimed = await api.claimQueue(items, platform);
  if (!claimed?.claimed?.length) {
    setHeaderStatus("Queue claim failed — refresh and try again", "");
    if (!keepSelectorLocked) setPlatformControlsDisabled(false);
    return false;
  }
  const claimedIds = new Set(claimed.claimed);
  const rows = items
    .filter((item) => claimedIds.has(item.actionId))
    .map((item) => ({
      ...item,
      platform,
      recipient: item.recipient,
      handle: item.recipient?.handle ?? item.handle ?? null,
      message: item.message
    }));
  const response = await chrome.runtime.sendMessage({
    type: "START_BATCH",
    payload: { rows, delaySeconds: sendDelaySeconds }
  });

  if (!response?.ok) {
    setHeaderStatus(`Could not start: ${response?.error ?? "unknown error"}`, "");
    setPlatformControlsDisabled(false);
    return false;
  }

  await chrome.action.setBadgeBackgroundColor({ color: "#17714F" });
  await chrome.action.setBadgeText({ text: "▶" });
  state.nextSendAt = Date.now() + sendDelaySeconds * 1000;
  lastSeenIndex = -1;
  await refreshToday();
  return true;
}

function showIdleQueue(queue, capability) {
  stopTimers();
  setPlatformControlsDisabled(false);
  $("run-card").hidden = true;
  applyCapability(capability, queue.items.length > 0);

  if (queue.items.length === 0) {
    $("queue-card").hidden = true;
    $("empty-card").hidden = false;
    renderList([]);
    return;
  }

  $("empty-card").hidden = true;
  $("queue-card").hidden = false;
  $("queue-count").textContent = `${queue.items.length} message${queue.items.length === 1 ? "" : "s"}`;
  $("queue-campaign").textContent = `${platformLabel(selectedPlatform())} · Campaign "${queue.campaign}" · prepared by Cold DM`;
  $("list-title").textContent = "Recipients";
  renderList(
    queue.items.map((item) => ({
      item,
      sub: `${messageTypeLabel(item.messageType)} · ${messagePreview(item.message)}`,
      status: "Pending",
      statusClass: "wait"
    }))
  );
}

async function showRunningEngine(engine) {
  if (!engine?.ok || engine.batchStatus !== "running") return false;
  clearQueuePolling();
  const batchQueue = normalizePersistedQueueItems(engine.batchQueue);
  const runningPlatform = batchQueue[0]?.platform;
  await applySelectedPlatform(runningPlatform);
  state.capability = await getPlatformCapability(selectedPlatform());
  setPlatformControlsDisabled(true);
  renderRun({ ...engine, batchQueue });
  return true;
}

async function showPausedItems(pausedItems) {
  const normalizedItems = normalizePersistedQueueItems(pausedItems);
  if (normalizedItems.length === 0) return false;
  clearQueuePolling();
  state.pausedItems = normalizedItems;
  await applySelectedPlatform(normalizedItems[0]?.platform);
  state.capability = await getPlatformCapability(selectedPlatform());
  setPlatformControlsDisabled(true);
  $("queue-card").hidden = true;
  $("empty-card").hidden = true;
  $("run-card").hidden = false;
  $("pause-button").hidden = true;
  $("resume-button").hidden = false;
  $("run-next").textContent = `Paused — ${normalizedItems.length} message(s) remaining.`;
  setHeaderStatus("● Paused", "run");
  $("list-title").textContent = "Run";
  renderList(normalizedItems.map((item) => ({ item, sub: "-", status: "Pending", statusClass: "wait" })));
  return true;
}

async function reconcileActiveOrPausedRun() {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  if (await showRunningEngine(engine)) return true;
  const { pausedItems } = await chrome.storage.local.get("pausedItems");
  return showPausedItems(pausedItems);
}

async function refreshToday({ automatic = false } = {}) {
  if (await reconcileActiveOrPausedRun()) return;

  const { coldDmApiKey } = await getSettings();
  if (!coldDmApiKey) {
    showQueueUnavailable();
    return;
  }

  const refreshGeneration = ++queueGeneration;
  const button = $("refresh-queue-button");
  const platform = selectedPlatform();
  try {
    button.disabled = true;
    button.textContent = "Refreshing…";
    if (!automatic) setQueueSyncStatus("Refreshing queue…");
    await chrome.action.setBadgeText({ text: "" });
    const queue = await api.fetchQueue(platform);
    const capability = await getPlatformCapability(platform);
    if (!capability?.ok) throw new Error(capability?.error ?? "Could not check platform availability");
    if (platform !== selectedPlatform() || refreshGeneration !== queueGeneration) return;
    if (await reconcileActiveOrPausedRun()) return;
    if (platform !== selectedPlatform() || refreshGeneration !== queueGeneration) return;
    state.queue = queue;
    showIdleQueue(state.queue, capability);
    setQueueSyncStatus(`Updated ${new Date().toLocaleTimeString()}`);
    await scheduleQueuePolling();
  } catch (error) {
    if (platform !== selectedPlatform() || refreshGeneration !== queueGeneration) return;
    if (await reconcileActiveOrPausedRun()) return;
    if (platform !== selectedPlatform() || refreshGeneration !== queueGeneration) return;
    setPlatformControlsDisabled(false);
    setQueueSyncStatus(error instanceof Error ? error.message : "Could not refresh queue.", true);
  } finally {
    button.disabled = false;
    button.textContent = "Refresh queue";
  }
}

function showQueueUnavailable() {
  clearQueuePolling();
  stopTimers();
  state.queue = null;
  $("queue-card").hidden = true;
  $("empty-card").hidden = true;
  $("run-card").hidden = true;
  renderList([]);
  setPlatformControlsDisabled(false);
  setQueueSyncStatus("Add your Cold DM API key in Settings to load the queue.");
}

function stopTimers() {
  clearInterval(pollTimer);
  clearInterval(countdownTimer);
  pollTimer = null;
  countdownTimer = null;
}

function readableReason(error, platform = selectedPlatform()) {
  const text = String(error ?? "");
  if (/not.?found|no such user|unavailable/i.test(text)) return "Profile not found";
  if (/message button|button/i.test(text)) return "Could not open the conversation";
  if (/login|logged/i.test(text)) {
    return state.capability?.platform === platform && state.capability.loginMessage
      ? state.capability.loginMessage
      : `Log in to ${platformLabel(platform)} in this browser, then resume.`;
  }
  return "Could not send";
}

function statusEntry(row, log, isCurrent) {
  if (log?.status === "sent") {
    return {
      item: row,
      sub: `Sent at ${new Date(log.at).toLocaleTimeString()}`,
      status: "✓ Sent",
      statusClass: "ok"
    };
  }

  if (log?.status === "error") {
    return {
      item: row,
      sub: readableReason(log.error, row.platform),
      status: "✗ Failed",
      statusClass: "fail"
    };
  }

  if (isCurrent) {
    return { item: row, sub: "Sending...", status: "● Sending", statusClass: "run", current: true };
  }

  return { item: row, sub: "-", status: "Pending", statusClass: "wait" };
}

function renderRun(engine) {
  clearQueuePolling();
  setPlatformControlsDisabled(true);
  const { batchQueue = [], batchIndex = 0, batchLogs = [], batchDelay } = engine;
  const total = batchQueue.length;
  const doneCount = Math.min(batchIndex, total);

  $("queue-card").hidden = true;
  $("empty-card").hidden = true;
  $("run-card").hidden = false;
  $("pause-button").hidden = false;
  $("resume-button").hidden = true;
  setHeaderStatus("● Sending", "run");

  $("run-pill").textContent = `${doneCount} / ${total}`;
  $("run-pill").className = `pill ${doneCount === total ? "green" : "amber"}`;
  $("run-progress-bar").style.width = `${total === 0 ? 0 : Math.round((doneCount / total) * 100)}%`;

  if (batchIndex !== lastSeenIndex) {
    lastSeenIndex = batchIndex;
    state.nextSendAt = Date.now() + (batchDelay ?? DEFAULT_DELAY_SECONDS) * 1000;
  }

  const logByActionId = new Map(batchLogs.map((log) => [log.actionId, log]));
  $("list-title").textContent = "Run";
  renderList(batchQueue.map((row, index) => statusEntry(row, logByActionId.get(row.actionId), index === batchIndex)));
  renderCountdown();

  if (!pollTimer) {
    pollTimer = setInterval(pollEngine, 2000);
    countdownTimer = setInterval(renderCountdown, 1000);
  }
}

function renderCountdown() {
  if (!state.nextSendAt) return;

  const ms = state.nextSendAt - Date.now();
  if (ms <= 0) {
    $("run-next").textContent = "Sending next message...";
    return;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  $("run-next").textContent = `Next send in ${minutes} min ${String(seconds).padStart(2, "0")} s — safety delay between messages.`;
}

async function pollEngine() {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  if (!engine?.ok) return;

  if (engine.batchStatus === "running") {
    const lastLog = engine.batchLogs?.[engine.batchLogs.length - 1];
    if (lastLog?.status === "error" && /login|logged/i.test(String(lastLog.error ?? ""))) {
      $("login-banner").textContent = readableReason(lastLog.error, lastLog.platform);
      $("login-banner").hidden = false;
      await pauseRun();
      return;
    }
    renderRun(engine);
    return;
  }

  stopTimers();
  await chrome.action.setBadgeText({ text: "" });
  const { coldDmAccount } = await getSettings();
  setHeaderStatus(`● Connected · ${coldDmAccount}`, "ok");
  await refreshToday();
}

async function pauseRun() {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  await chrome.runtime.sendMessage({ type: "STOP_BATCH" });
  stopTimers();
  state.pausedItems = (engine?.batchQueue ?? []).slice(engine?.batchIndex ?? 0);
  await chrome.storage.local.set({ pausedItems: state.pausedItems });
  if (state.pausedItems[0]?.platform) await applySelectedPlatform(state.pausedItems[0].platform);
  setPlatformControlsDisabled(true);
  $("pause-button").hidden = true;
  $("resume-button").hidden = false;
  $("run-next").textContent = `Paused — ${state.pausedItems.length} message(s) remaining.`;
  setHeaderStatus("● Paused", "run");
}

async function renderHistory() {
  const history = [
    ...(await api.getHistory()).map((entry) => ({ ...entry, source: "Cold DM" })),
    ...(await api.getManualTestHistory()).map((entry) => ({ ...entry, source: "Manual test" })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const list = $("history-list");
  list.innerHTML = "";
  $("history-empty").hidden = history.length > 0;

  for (const entry of history.slice(0, 100)) {
    const li = document.createElement("li");

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    const recipient = displayRecipient(entry);
    avatar.textContent = initials(recipient);

    const who = document.createElement("div");
    who.className = "who";

    const name = document.createElement("b");
    name.textContent = recipient;

    const sub = document.createElement("span");
    const day = new Date(entry.at);
    sub.textContent = `${day.toLocaleDateString()} ${day.toLocaleTimeString()} · ${entry.source} · ${messageTypeLabel(entry.messageType)}${entry.reason ? ` · ${entry.reason}` : ""}`;

    const status = document.createElement("span");
    status.className = `status ${entry.status === "sent" ? "ok" : "fail"}`;
    status.textContent = entry.status === "sent" ? "✓ Sent" : "✗ Failed";

    who.append(name, sub);
    li.append(avatar, who, status);
    list.appendChild(li);
  }
}

async function startManualTest() {
  const platform = $("manual-test-platform").value;
  const item = createManualTestItem({
    platform,
    target: $("manual-test-target").value,
    message: $("manual-test-message").value,
  });
  const error = $("manual-test-error");
  error.hidden = true;
  if (!item) {
    error.textContent = `Enter a valid ${platformLabel(platform)} profile URL or handle and a message.`;
    error.hidden = false;
    return;
  }

  const button = $("manual-test-send-button");
  button.disabled = true;
  button.textContent = "Sending…";
  try {
    const capability = await getPlatformCapability(platform);
    if (!capability?.ok || !capability.executable) throw new Error(capability?.reason ?? "Sending is not available for this platform.");
    if (!capability.loggedIn) throw new Error(capability.loginMessage ?? `Log in to ${platformLabel(platform)} in this browser, then resume.`);
    const { sendDelaySeconds } = await getSettings();
    const response = await chrome.runtime.sendMessage({
      type: "START_BATCH",
      payload: { rows: [item], delaySeconds: sendDelaySeconds },
    });
    if (!response?.ok) throw new Error(response?.error ?? "Could not start the manual test.");
    $("manual-test-message").value = "";
    setHeaderStatus("● Manual test running", "run");
  } catch (exception) {
    error.textContent = exception instanceof Error ? exception.message : "Could not start the manual test.";
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.textContent = "Send test";
  }
}

$("settings-button").addEventListener("click", async () => {
  const settings = await getSettings();
  $("settings-api-key").value = settings.coldDmApiKey;
  $("settings-base-url").value = settings.coldDmBaseUrl;
  $("delay-input").value = settings.sendDelaySeconds;
  $("queue-polling-hours-input").value = String(settings.queuePollingHours);
  $("settings-status").hidden = true;
  $("raw-logs").hidden = true;
  showView("settings");
});

$("settings-back-button").addEventListener("click", () => enterMain());

$("settings-save-button").addEventListener("click", async () => {
  const key = $("settings-api-key").value.trim();
  const baseUrl = $("settings-base-url").value.trim();
  const delay = Math.min(3600, Math.max(60, parseInt($("delay-input").value, 10) || DEFAULT_DELAY_SECONDS));
  const queuePollingHours = [1, 3, 6, 12, 24].includes(Number($("queue-polling-hours-input").value)) ? Number($("queue-polling-hours-input").value) : DEFAULT_QUEUE_POLLING_HOURS;
  await chrome.storage.local.set({
    coldDmApiKey: key,
    coldDmAccount: key ? "Cold DM configured" : "",
    sendDelaySeconds: delay,
    coldDmBaseUrl: baseUrl,
    queuePollingHours,
  });
  if (key) await scheduleQueuePolling();
  $("settings-status").textContent = key
    ? "Saved. The Cold DM queue will be available when this key is valid."
    : "Saved. Add a Cold DM API key to load the queue.";
  $("settings-status").hidden = false;
});

$("show-logs-button").addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({ type: "GET_RUN_LOGS" });
  $("raw-logs").textContent = JSON.stringify(response?.logs ?? [], null, 2);
  $("raw-logs").hidden = false;
});

$("tab-today-button").addEventListener("click", () => showTab("today"));
$("tab-history-button").addEventListener("click", async () => {
  showTab("history");
  await renderHistory();
});

$("refresh-queue-button").addEventListener("click", () => refreshToday());

$("platform-select").addEventListener("change", async (event) => {
  if ($("platform-select").disabled) return;
  clearDisplayedQueue();
  await applySelectedPlatform(event.target.value);
  setQueueSyncStatus("Queue not refreshed yet.");
  await refreshToday();
});

$("start-button").addEventListener("click", async () => {
  if (!state.queue || state.queue.items.length === 0) return;
  $("start-button").disabled = true;
  const started = await startRun(state.queue.items);
  if (!started && state.capability) applyCapability(state.capability, state.queue.items.length > 0);
});

$("manual-test-send-button").addEventListener("click", startManualTest);

$("pause-button").addEventListener("click", pauseRun);

$("resume-button").addEventListener("click", async () => {
  const items = state.pausedItems ?? [];
  lastSeenIndex = -1;
  const started = await startRun(items);
  if (started) {
    state.pausedItems = null;
    await chrome.storage.local.set({ pausedItems: null });
  }
});

$("stop-button").addEventListener("click", async () => {
  const engine = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
  await chrome.runtime.sendMessage({ type: "STOP_BATCH" });
  stopTimers();
  state.pausedItems = null;
  await chrome.storage.local.set({ pausedItems: null });
  await chrome.action.setBadgeText({ text: "" });
  const { coldDmAccount } = await getSettings();
  setHeaderStatus(`● Connected · ${coldDmAccount}`, "ok");
  await refreshToday();
});

async function enterMain() {
  const settings = await getSettings();
  await applySelectedPlatform(settings.selectedPlatform, { persist: false });
  setHeaderStatus(settings.coldDmApiKey ? `● ${settings.coldDmAccount}` : "● Manual mode · Cold DM not connected", settings.coldDmApiKey ? "ok" : "");
  showView("main");
  showTab("today");
  if (settings.coldDmApiKey) await refreshToday();
  else showQueueUnavailable();
}

async function boot() {
  await enterMain();
}

boot();
