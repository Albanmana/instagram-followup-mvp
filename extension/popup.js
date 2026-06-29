function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === "," && !inQuotes) { cells.push(current.trim()); current = ""; }
    else { current += ch; }
  }
  cells.push(current.trim());
  return cells;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const handleIdx = headers.indexOf("handle");
  const messageIdx = headers.indexOf("message");
  if (handleIdx === -1 || messageIdx === -1) return [];

  return lines.slice(1).reduce((acc, line) => {
    const cells = parseCsvLine(line);
    const handle = (cells[handleIdx] ?? "").replace(/^@+/, "").trim();
    const message = (cells[messageIdx] ?? "").trim();
    if (!handle || !message) return acc;
    const row = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    row.handle = handle;
    acc.push(row);
    return acc;
  }, []);
}

const form = document.getElementById("message-form");
const handleInput = document.getElementById("handle");
const messageInput = document.getElementById("message");
const submitButton = document.getElementById("submit-button");
const logsButton = document.getElementById("logs-button");
const statusNode = document.getElementById("status");
const logsNode = document.getElementById("logs");
const senderMode = document.getElementById("sender-mode");
const scraperMode = document.getElementById("scraper-mode");
const modeSenderButton = document.getElementById("mode-sender-button");
const modeScraperButton = document.getElementById("mode-scraper-button");

const scrapeForm = document.getElementById("scrape-form");
const scrapeSourceButtons = Array.from(document.querySelectorAll("[data-source-type]"));
const scrapeTargetLabel = document.getElementById("scrape-target-label");
const scrapePostUrlInput = document.getElementById("scrape-post-url");
const scrapeIncludeInput = document.getElementById("scrape-include-keywords");
const scrapeExcludeInput = document.getElementById("scrape-exclude-keywords");
const scrapeMinLengthField = document.getElementById("scrape-min-length-field");
const scrapeMinLengthInput = document.getElementById("scrape-min-length");
const scrapeMaxLeadsInput = document.getElementById("scrape-max-leads");
const scrapeProfileEnrichmentInput = document.getElementById("scrape-profile-enrichment");
const startScrapeButton = document.getElementById("start-scrape-button");
const stopScrapeButton = document.getElementById("stop-scrape-button");
const scrapeSummary = document.getElementById("scrape-summary");
const scrapeCursor = document.getElementById("scrape-cursor");
const scrapeLogsButton = document.getElementById("scrape-logs-button");
const downloadScrapeButton = document.getElementById("download-scrape-button");
const scrapeStatusNode = document.getElementById("scrape-status");
const scrapeLogsNode = document.getElementById("scrape-logs");
const scrapeCollectedCount = document.getElementById("scrape-collected-count");
const scrapeReadyCount = document.getElementById("scrape-ready-count");
const scrapeResultsPreview = document.getElementById("scrape-results-preview");
const scrapeResultsBody = document.getElementById("scrape-results-body");
const scrapePreviewColumnLabel = document.getElementById("scrape-preview-column-label");

// Auto-fetch DOM refs
const autofetchBadge    = document.getElementById("autofetch-badge");
const autofetchInterval = document.getElementById("autofetch-interval");
const autofetchToggle   = document.getElementById("autofetch-toggle");
const autofetchCountdown = document.getElementById("autofetch-countdown");
const autofetchTrigger  = document.getElementById("autofetch-trigger");

// Step 1: DOM references for batch UI
const settingsButton    = document.getElementById("settings-button");
const toggleBatchButton = document.getElementById("toggle-batch-button");
const batchSection = document.getElementById("batch-section");
const dropZone = document.getElementById("csv-drop-zone");
const fileInput = document.getElementById("csv-file-input");
const csvPreview = document.getElementById("csv-preview");
const csvRowsPreview = document.getElementById("csv-rows-preview");
const csvRowsBody = document.getElementById("csv-rows-body");
const delayInput = document.getElementById("delay-input");
const startBatchButton = document.getElementById("start-batch-button");
const batchProgress = document.getElementById("batch-progress");
const batchSummary = document.getElementById("batch-summary");
const countdownDisplay = document.getElementById("countdown-display");
const batchLogBody = document.getElementById("batch-log-body");
const stopBatchButton = document.getElementById("stop-batch-button");

function setStatus(message, state = "idle") {
  statusNode.textContent = message;
  statusNode.dataset.state = state;
}

function setScrapeStatus(message, state = "idle") {
  scrapeStatusNode.textContent = message;
  scrapeStatusNode.dataset.state = state;
}

function setMode(mode) {
  const isSender = mode === "sender";
  senderMode.hidden = !isSender;
  scraperMode.hidden = isSender;
  modeSenderButton.classList.toggle("is-active", isSender);
  modeScraperButton.classList.toggle("is-active", !isSender);
}

function sanitizeHandle(rawHandle) {
  return rawHandle.trim().replace(/^@+/, "").replace(/\/+$/, "");
}

const SCRAPE_SOURCE_CONFIG = {
  comments: {
    label: "Post URL",
    placeholder: "https://www.instagram.com/p/...",
    previewLabel: "Comment",
    statusLabel: "comment",
  },
  followers: {
    label: "Profile URL or handle",
    placeholder: "instagram or https://www.instagram.com/instagram/",
    previewLabel: "Name",
    statusLabel: "profile",
  },
  following: {
    label: "Profile URL or handle",
    placeholder: "instagram or https://www.instagram.com/instagram/",
    previewLabel: "Name",
    statusLabel: "profile",
  },
};

let activeScrapeSourceType = "comments";

function getScrapeSourceConfig(sourceType) {
  return SCRAPE_SOURCE_CONFIG[sourceType] || SCRAPE_SOURCE_CONFIG.comments;
}

function setScrapeSourceType(sourceType) {
  activeScrapeSourceType = SCRAPE_SOURCE_CONFIG[sourceType] ? sourceType : "comments";
  const config = getScrapeSourceConfig(activeScrapeSourceType);
  scrapeTargetLabel.textContent = config.label;
  scrapePostUrlInput.placeholder = config.placeholder;
  scrapePreviewColumnLabel.textContent = config.previewLabel;
  scrapeSourceButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sourceType === activeScrapeSourceType);
  });
  scrapeMinLengthField.hidden = activeScrapeSourceType !== "comments";
}

scrapeSourceButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setScrapeSourceType(button.dataset.sourceType || "comments");
  });
});

setScrapeSourceType("comments");

modeSenderButton.addEventListener("click", () => setMode("sender"));
modeScraperButton.addEventListener("click", () => setMode("scraper"));
setMode("sender");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const handle = sanitizeHandle(handleInput.value);
  const message = messageInput.value.trim();

  if (!handle || !message) {
    setStatus("Handle and message are required.", "error");
    return;
  }

  submitButton.disabled = true;
  setStatus(`Opening @${handle} on Instagram...`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "SEND_TEST_MESSAGE",
      payload: { handle, message }
    });

    if (!response?.ok) {
      setStatus(response?.error || "The test message failed.", "error");
      return;
    }

    setStatus(`Message sent to @${handle}.`, "success");
  } catch (error) {
    setStatus(error.message || "The extension hit an unexpected error.", "error");
  } finally {
    submitButton.disabled = false;
  }
});

logsButton.addEventListener("click", async () => {
  setStatus("Loading latest logs...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_RUN_LOGS" });

    if (!response?.ok) {
      setStatus(response?.error || "Could not load logs.", "error");
      return;
    }

    const lines = response.logs.length
      ? response.logs.map((entry) => `${entry.at} [${entry.source}] ${entry.message}`)
      : ["No logs yet."];

    logsNode.hidden = false;
    logsNode.textContent = lines.join("\n");
    setStatus("Latest logs loaded.");
  } catch (error) {
    setStatus(error.message || "Could not load logs.", "error");
  }
});

// Step 2: renderBatchProgress
function renderBatchProgress({ batchQueue, batchStatus, batchLogs }) {
  const total = batchQueue.length;
  const processed = batchLogs.length;

  batchProgress.hidden = total === 0;
  batchSummary.textContent = `${processed} / ${total} processed — status: ${batchStatus ?? "—"}`;

  batchLogBody.innerHTML = "";
  for (const entry of batchLogs) {
    const tr = document.createElement("tr");

    const handleTd = document.createElement("td");
    handleTd.textContent = `@${entry.handle}`;

    const statusTd = document.createElement("td");
    if (entry.status === "sent") {
      const span = document.createElement("span");
      span.className = "status-sent";
      span.textContent = "✓ sent";
      statusTd.appendChild(span);
    } else {
      const span = document.createElement("span");
      span.className = "status-error";
      span.textContent = `✗ error: ${entry.error ?? "?"}`;
      statusTd.appendChild(span);
    }

    tr.appendChild(handleTd);
    tr.appendChild(statusTd);
    batchLogBody.appendChild(tr);
  }

  stopBatchButton.disabled = batchStatus !== "running";
  submitButton.disabled = batchStatus === "running";
}

// Step 3: loadBatchStatus — reconnects to in-progress batches on popup open
async function loadBatchStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_BATCH_STATUS" });
    if (response?.ok && response.batchStatus != null) {
      batchSection.hidden = false;
      renderBatchProgress(response);
      if (response.batchStatus === "running") startCountdown();
    }
  } catch (_) {
    // no active batch
  }
}

loadBatchStatus();
loadScrapeStatus();

// Settings button → opens settings.html in a new tab
settingsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("settings.html") });
});

// Step 4: Wire toggle button
toggleBatchButton.addEventListener("click", () => {
  batchSection.hidden = !batchSection.hidden;
});

// Step 5: Wire drag-and-drop and file input
dropZone.addEventListener("click", () => fileInput.click());
dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") fileInput.click();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => {
  dropZone.classList.remove("drag-over");
});
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer?.files?.[0];
  if (file) handleCSVFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) handleCSVFile(file);
});

// Step 6: handleCSVFile
let parsedRows = [];

function handleCSVFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    parsedRows = parseCSV(e.target.result);
    csvPreview.hidden = false;
    csvRowsPreview.hidden = true;
    csvRowsBody.innerHTML = "";

    if (parsedRows.length === 0) {
      csvPreview.textContent = "No valid rows found.";
      startBatchButton.disabled = true;
      return;
    }

    csvPreview.textContent = `${parsedRows.length} row(s) loaded.`;
    startBatchButton.disabled = false;

    const visible = parsedRows.slice(0, 20);
    for (const row of visible) {
      const tr = document.createElement("tr");
      const handleTd = document.createElement("td");
      handleTd.textContent = `@${row.handle}`;
      const msgTd = document.createElement("td");
      msgTd.textContent = row.message.length > 55 ? row.message.slice(0, 55) + "…" : row.message;
      const gifTd = document.createElement("td");
      const hasGif = ["true", "1", "yes"].includes((row.has_gif ?? "").toLowerCase());
      gifTd.textContent = hasGif && row.gif_query ? row.gif_query : "—";
      tr.appendChild(handleTd);
      tr.appendChild(msgTd);
      tr.appendChild(gifTd);
      csvRowsBody.appendChild(tr);
    }

    if (parsedRows.length > 20) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.style.color = "#7a5c3e";
      td.textContent = `… and ${parsedRows.length - 20} more row(s)`;
      tr.appendChild(td);
      csvRowsBody.appendChild(tr);
    }

    csvRowsPreview.hidden = false;
  };
  reader.readAsText(file);
}

// Step 7: Wire startBatchButton
startBatchButton.addEventListener("click", async () => {
  if (parsedRows.length === 0) return;

  const delaySeconds = Math.max(5, parseInt(delayInput.value, 10) || 400);
  startBatchButton.disabled = true;
  setStatus(`Batch started — ${parsedRows.length} message(s) queued (delay: ${delaySeconds}s).`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_BATCH",
      payload: { rows: parsedRows, delaySeconds }
    });

    if (!response?.ok) {
      setStatus(response?.error ?? "Failed to start batch.", "error");
      startBatchButton.disabled = false;
      return;
    }

    renderBatchProgress({
      batchQueue: parsedRows,
      batchStatus: "running",
      batchLogs: []
    });
    startCountdown();
  } catch (error) {
    setStatus(error.message ?? "Unexpected error.", "error");
    startBatchButton.disabled = false;
  }
});

// Step 8: Wire stopBatchButton
stopBatchButton.addEventListener("click", async () => {
  try {
    await chrome.runtime.sendMessage({ type: "STOP_BATCH" });
    setStatus("Batch stopped.");
    stopBatchButton.disabled = true;
    submitButton.disabled = false;
    stopCountdown();
  } catch (error) {
    setStatus(error.message ?? "Failed to stop batch.", "error");
  }
});

scrapeForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  startScrapeButton.disabled = true;
  setScrapeStatus(`Starting ${activeScrapeSourceType} scrape…`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "START_SCRAPE",
      payload: {
        postUrl: scrapePostUrlInput.value.trim(),
        sourceType: activeScrapeSourceType,
        includeKeywords: scrapeIncludeInput.value.trim(),
        excludeKeywords: scrapeExcludeInput.value.trim(),
        minimumCommentLength: scrapeMinLengthInput.value,
        maxLeads: scrapeMaxLeadsInput.value,
        profileEnrichment: scrapeProfileEnrichmentInput.checked,
      }
    });

    if (!response?.ok) {
      setScrapeStatus(response?.error ?? "Failed to start scrape.", "error");
      startScrapeButton.disabled = false;
      return;
    }

    renderScrapeStatus({
      scrapeStatus: "running",
      scrapeResults: [],
      scrapeFilters: { sourceType: activeScrapeSourceType },
      scrapeCursor: { phase: "starting", collectedCount: 0, enrichedCount: 0 },
    });
    setScrapeStatus(`${activeScrapeSourceType} scrape started. You can close the popup and reopen it later.`, "success");
    await loadScrapeStatus();
  } catch (error) {
    setScrapeStatus(error.message ?? "Failed to start scrape.", "error");
    startScrapeButton.disabled = false;
  }
});

stopScrapeButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "STOP_SCRAPE" });
    if (!response?.ok) {
      setScrapeStatus(response?.error ?? "Failed to stop scrape.", "error");
      return;
    }
    setScrapeStatus("Scrape stopped.", "success");
    await loadScrapeStatus();
  } catch (error) {
    setScrapeStatus(error.message ?? "Failed to stop scrape.", "error");
  }
});

scrapeLogsButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SCRAPE_LOGS" });
    if (!response?.ok) {
      setScrapeStatus(response?.error ?? "Could not load scrape logs.", "error");
      return;
    }

    const lines = response.logs.length
      ? response.logs.map((entry) => `${entry.at} ${entry.message}`)
      : ["No scrape logs yet."];

    scrapeLogsNode.hidden = false;
    scrapeLogsNode.textContent = lines.join("\n");
    setScrapeStatus("Scrape logs loaded.");
  } catch (error) {
    setScrapeStatus(error.message ?? "Could not load scrape logs.", "error");
  }
});

downloadScrapeButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "DOWNLOAD_SCRAPE_CSV" });
    if (!response?.ok) {
      setScrapeStatus(response?.error ?? "Could not download CSV.", "error");
      return;
    }
    setScrapeStatus(`CSV ready: ${response.filename}`, "success");
  } catch (error) {
    setScrapeStatus(error.message ?? "Could not download CSV.", "error");
  }
});

// Countdown timer — reads chrome.alarms + storage directly (no background round-trip)
let countdownInterval = null;

async function updateCountdown() {
  const { batchIndex = 0, batchQueue = [], batchStatus = null } =
    await chrome.storage.local.get(["batchIndex", "batchQueue", "batchStatus"]);

  if (batchStatus !== "running") {
    stopCountdown();
    return;
  }

  const alarm = await new Promise((resolve) => chrome.alarms.get("IG_BATCH_NEXT", resolve));

  countdownDisplay.hidden = false;

  if (!alarm) {
    countdownDisplay.textContent = "⏳ Sending…";
    return;
  }

  const remaining = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 1000));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  const nextHandle = batchQueue[batchIndex]?.handle ?? "—";
  const rowNum = batchIndex + 1;

  countdownDisplay.textContent =
    `⏱ Next: @${nextHandle} (row ${rowNum}/${batchQueue.length}) — in ${mins}:${String(secs).padStart(2, "0")}`;
}

function startCountdown() {
  stopCountdown();
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function stopCountdown() {
  if (countdownInterval != null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  countdownDisplay.hidden = true;
  countdownDisplay.textContent = "";
}

function renderScrapeStatus(state = {}) {
  const scrapeStatus = state.scrapeStatus ?? null;
  const scrapeResults = state.scrapeResults ?? [];
  const cursor = state.scrapeCursor ?? {};
  const filters = state.scrapeFilters ?? {};
  const sourceType = filters.sourceType || activeScrapeSourceType;
  const sourceConfig = getScrapeSourceConfig(sourceType);
  const collectedCount = cursor.collectedCount ?? 0;
  const readyCount = scrapeResults.length;

  scrapeSummary.textContent =
    `Status: ${scrapeStatus ?? "idle"} — ${readyCount} ${sourceConfig.statusLabel}(s) ready`;

  const cursorParts = [];
  if (cursor.phase) cursorParts.push(`phase: ${cursor.phase}`);
  if (cursor.currentUsername) cursorParts.push(`current: @${cursor.currentUsername}`);
  if (cursor.collectedCount != null) cursorParts.push(`collected: ${cursor.collectedCount}`);
  if (cursor.enrichedCount != null) cursorParts.push(`enriched: ${cursor.enrichedCount}`);
  if (cursor.keptCount != null) cursorParts.push(`ready: ${cursor.keptCount}`);
  if (cursor.totalToEnrich != null) cursorParts.push(`total: ${cursor.totalToEnrich}`);
  if (cursor.error) cursorParts.push(`error: ${cursor.error}`);
  scrapeCursor.textContent = cursorParts.join(" — ") || "No scrape running.";

  scrapeCollectedCount.textContent = String(collectedCount);
  scrapeReadyCount.textContent = String(readyCount);

  scrapeResultsBody.innerHTML = "";
  const previewRows = scrapeResults.slice(0, 12);
  previewRows.forEach((lead) => {
    const tr = document.createElement("tr");

    const handleTd = document.createElement("td");
    handleTd.textContent = `@${lead.username}`;

    const previewTd = document.createElement("td");
    const text = sourceType === "comments"
      ? (lead.comment_text || "").trim()
      : (lead.name || "").trim();
    previewTd.textContent = text.length > 80 ? `${text.slice(0, 80)}…` : text || "—";

    tr.appendChild(handleTd);
    tr.appendChild(previewTd);
    scrapeResultsBody.appendChild(tr);
  });

  if (scrapeResults.length > 12) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 2;
    td.textContent = `… and ${scrapeResults.length - 12} more lead(s)`;
    td.style.color = "#7a5c3e";
    tr.appendChild(td);
    scrapeResultsBody.appendChild(tr);
  }

  scrapeResultsPreview.hidden = scrapeResults.length === 0;
  scrapePreviewColumnLabel.textContent = sourceConfig.previewLabel;

  const isRunning = scrapeStatus === "running";
  startScrapeButton.disabled = isRunning;
  stopScrapeButton.disabled = !isRunning;
  downloadScrapeButton.hidden = scrapeResults.length === 0;
  downloadScrapeButton.textContent = scrapeStatus === "done" ? "Download latest CSV" : "Download partial CSV";
}

async function loadScrapeStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SCRAPE_STATUS" });
    if (!response?.ok) return;

    renderScrapeStatus(response);

    const filters = response.scrapeFilters || {};
    setScrapeSourceType(filters.sourceType || "comments");
    if (filters.postUrl) scrapePostUrlInput.value = filters.postUrl;
    scrapeIncludeInput.value = (filters.includeKeywords || []).join(", ");
    scrapeExcludeInput.value = (filters.excludeKeywords || []).join(", ");
    scrapeMinLengthInput.value = String(filters.minimumCommentLength ?? 0);
    scrapeMaxLeadsInput.value = String(filters.maxLeads ?? 30);
    scrapeProfileEnrichmentInput.checked = Boolean(filters.profileEnrichment);
  } catch (_) {
    // ignore initial load issues
  }
}

const scrapeStatusInterval = setInterval(() => {
  loadScrapeStatus().catch(() => {});
}, 2000);

window.addEventListener("unload", () => {
  stopCountdown();
  stopAutoFetchCountdown();
  stopCrmCountdown();
  clearInterval(scrapeStatusInterval);
});

// ── CRM Sync controls ─────────────────────────────────────────
const crmBadge        = document.getElementById("crm-badge");
const crmInterval     = document.getElementById("crm-interval");
const crmToggle       = document.getElementById("crm-toggle");
const crmCountdown    = document.getElementById("crm-countdown");
const crmTrigger      = document.getElementById("crm-trigger");
const crmLogsButton   = document.getElementById("crm-logs-button");
const crmLastSyncEl   = document.getElementById("crm-last-sync");
const crmLogsEl       = document.getElementById("crm-logs");

let crmCountdownInterval = null;

async function updateCrmCountdown() {
  const { crmSyncEnabled = false } = await chrome.storage.local.get("crmSyncEnabled");
  if (!crmSyncEnabled) { stopCrmCountdown(); return; }
  const alarm = await new Promise((resolve) => chrome.alarms.get("IG_CRM_SYNC", resolve));
  crmCountdown.hidden = false;
  if (!alarm) { crmCountdown.textContent = "⏳ Waiting for first cycle…"; return; }
  const remaining = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 1000));
  const hours = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${String(mins).padStart(2, "0")}min`);
  parts.push(`${String(secs).padStart(2, "0")}s`);
  crmCountdown.textContent = `⏱ Next CRM sync in ${parts.join(" ")}`;
}

function startCrmCountdown() {
  stopCrmCountdown();
  updateCrmCountdown();
  crmCountdownInterval = setInterval(updateCrmCountdown, 1000);
}

function stopCrmCountdown() {
  if (crmCountdownInterval != null) {
    clearInterval(crmCountdownInterval);
    crmCountdownInterval = null;
  }
  crmCountdown.hidden = true;
  crmCountdown.textContent = "";
}

function renderCrmSync(enabled) {
  crmBadge.textContent = enabled ? "Active" : "Inactive";
  crmBadge.dataset.state = enabled ? "active" : "inactive";
  crmToggle.textContent = enabled ? "Disable" : "Enable";
  if (enabled) { startCrmCountdown(); } else { stopCrmCountdown(); }
}

async function loadCrmStatus() {
  const { crmSyncEnabled = false, crmSyncIntervalHours = 6, crmLastSync, crmLastSyncCount } =
    await chrome.storage.local.get(["crmSyncEnabled", "crmSyncIntervalHours", "crmLastSync", "crmLastSyncCount"]);
  crmInterval.value = String(crmSyncIntervalHours);
  renderCrmSync(crmSyncEnabled);
  if (crmLastSync) {
    crmLastSyncEl.hidden = false;
    crmLastSyncEl.textContent = `Last sync: ${new Date(crmLastSync).toLocaleString()} — ${crmLastSyncCount ?? 0} thread(s)`;
  }
}

loadCrmStatus();

crmToggle.addEventListener("click", async () => {
  const { crmSyncEnabled = false, crmWebhookUrl = "https://n8n.srv765660.hstgr.cloud/webhook/8472dc92-a513-4739-bc7a-0261e2e71b00" } =
    await chrome.storage.local.get(["crmSyncEnabled", "crmWebhookUrl"]);
  const next = !crmSyncEnabled;
  const hours = parseFloat(crmInterval.value);

  if (next && !crmWebhookUrl) {
    setStatus("Configure the CRM webhook URL in Settings (⚙) first.", "error");
    return;
  }

  await chrome.storage.local.set({ crmSyncEnabled: next, crmSyncIntervalHours: hours });

  if (next) {
    chrome.alarms.create("IG_CRM_SYNC", { periodInMinutes: hours * 60 });
  } else {
    await chrome.alarms.clear("IG_CRM_SYNC");
  }

  renderCrmSync(next);
});

crmInterval.addEventListener("change", async () => {
  const hours = parseFloat(crmInterval.value);
  await chrome.storage.local.set({ crmSyncIntervalHours: hours });
  const { crmSyncEnabled = false } = await chrome.storage.local.get("crmSyncEnabled");
  if (crmSyncEnabled) {
    await chrome.alarms.clear("IG_CRM_SYNC");
    chrome.alarms.create("IG_CRM_SYNC", { periodInMinutes: hours * 60 });
  }
});

crmTrigger.addEventListener("click", async () => {
  crmTrigger.disabled = true;
  crmTrigger.textContent = "⏳ Syncing…";
  crmBadge.textContent = "Sync…";
  crmBadge.dataset.state = "loading";
  setStatus("Opening Instagram DMs for CRM sync…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "TRIGGER_CRM_SYNC" });
    if (!response?.ok) {
      setStatus(response?.error ?? "CRM sync failed.", "error");
    } else {
      setStatus("CRM sync triggered — check CRM logs for results.", "success");
    }
  } catch (error) {
    setStatus(error.message ?? "Error.", "error");
  } finally {
    crmTrigger.disabled = false;
    crmTrigger.textContent = "▶ Trigger now";
    const { crmSyncEnabled = false } = await chrome.storage.local.get("crmSyncEnabled");
    renderCrmSync(crmSyncEnabled);
    // Refresh last sync info
    const { crmLastSync, crmLastSyncCount } =
      await chrome.storage.local.get(["crmLastSync", "crmLastSyncCount"]);
    if (crmLastSync) {
      crmLastSyncEl.hidden = false;
      crmLastSyncEl.textContent = `Last sync: ${new Date(crmLastSync).toLocaleString()} — ${crmLastSyncCount ?? 0} thread(s)`;
    }
  }
});

crmLogsButton.addEventListener("click", async () => {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_CRM_LOGS" });
    if (!response?.ok) { setStatus(response?.error ?? "Could not load CRM logs.", "error"); return; }
    const lines = response.logs.length
      ? response.logs.map((e) => `${e.at} ${e.message}`)
      : ["No CRM logs yet."];
    crmLogsEl.hidden = false;
    crmLogsEl.textContent = lines.join("\n");
  } catch (error) {
    setStatus(error.message ?? "Could not load CRM logs.", "error");
  }
});

// ── Auto-fetch controls ────────────────────────────────────────
let autoFetchCountdownInterval = null;

async function updateAutoFetchCountdown() {
  const { autoFetchEnabled = false } = await chrome.storage.local.get("autoFetchEnabled");
  if (!autoFetchEnabled) { stopAutoFetchCountdown(); return; }
  const alarm = await new Promise((resolve) => chrome.alarms.get("IG_AUTO_FETCH", resolve));
  autofetchCountdown.hidden = false;
  if (!alarm) { autofetchCountdown.textContent = "⏳ Waiting for first cycle…"; return; }
  const remaining = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 1000));
  const hours = Math.floor(remaining / 3600);
  const mins = Math.floor((remaining % 3600) / 60);
  const secs = remaining % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${String(mins).padStart(2, "0")}min`);
  parts.push(`${String(secs).padStart(2, "0")}s`);
  autofetchCountdown.textContent = `⏱ Next fetch in ${parts.join(" ")}`;
}

function startAutoFetchCountdown() {
  stopAutoFetchCountdown();
  updateAutoFetchCountdown();
  autoFetchCountdownInterval = setInterval(updateAutoFetchCountdown, 1000);
}

function stopAutoFetchCountdown() {
  if (autoFetchCountdownInterval != null) {
    clearInterval(autoFetchCountdownInterval);
    autoFetchCountdownInterval = null;
  }
  autofetchCountdown.hidden = true;
  autofetchCountdown.textContent = "";
}

function renderAutoFetch(enabled) {
  autofetchBadge.textContent = enabled ? "Active" : "Inactive";
  autofetchBadge.dataset.state = enabled ? "active" : "inactive";
  autofetchToggle.textContent = enabled ? "Disable" : "Enable";
  if (enabled) { startAutoFetchCountdown(); } else { stopAutoFetchCountdown(); }
}

async function loadAutoFetchStatus() {
  const { autoFetchEnabled = false, autoFetchIntervalHours = 3 } =
    await chrome.storage.local.get(["autoFetchEnabled", "autoFetchIntervalHours"]);
  autofetchInterval.value = String(autoFetchIntervalHours);
  renderAutoFetch(autoFetchEnabled);
}

loadAutoFetchStatus();

autofetchToggle.addEventListener("click", async () => {
  const { autoFetchEnabled = false, autoFetchUrl = "https://n8n.srv765660.hstgr.cloud/webhook/ada824b2-daf0-4209-b302-38cbcce1e57e" } =
    await chrome.storage.local.get(["autoFetchEnabled", "autoFetchUrl"]);
  const next = !autoFetchEnabled;
  const hours = parseFloat(autofetchInterval.value);

  if (next && !autoFetchUrl) {
    setStatus("Configure the endpoint URL in Settings (⚙) first.", "error");
    return;
  }

  await chrome.storage.local.set({ autoFetchEnabled: next, autoFetchIntervalHours: hours });

  if (next) {
    chrome.alarms.create("IG_AUTO_FETCH", { periodInMinutes: hours * 60 });
  } else {
    await chrome.alarms.clear("IG_AUTO_FETCH");
  }

  renderAutoFetch(next);
});

autofetchInterval.addEventListener("change", async () => {
  const hours = parseFloat(autofetchInterval.value);
  await chrome.storage.local.set({ autoFetchIntervalHours: hours });
  const { autoFetchEnabled = false } = await chrome.storage.local.get("autoFetchEnabled");
  if (autoFetchEnabled) {
    await chrome.alarms.clear("IG_AUTO_FETCH");
    chrome.alarms.create("IG_AUTO_FETCH", { periodInMinutes: hours * 60 });
  }
});

autofetchTrigger.addEventListener("click", async () => {
  autofetchTrigger.disabled = true;
  autofetchTrigger.textContent = "⏳ Fetching…";
  autofetchBadge.textContent = "Fetch…";
  autofetchBadge.dataset.state = "loading";
  setStatus("Fetching from endpoint…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "TRIGGER_AUTO_FETCH" });
    if (!response?.ok) {
      setStatus(response?.error ?? "Fetch failed.", "error");
    } else {
      setStatus("Fetch complete — batch started if rows were found.", "success");
    }
  } catch (error) {
    setStatus(error.message ?? "Error.", "error");
  } finally {
    autofetchTrigger.disabled = false;
    autofetchTrigger.textContent = "▶ Trigger now";
    const { autoFetchEnabled = false } = await chrome.storage.local.get("autoFetchEnabled");
    renderAutoFetch(autoFetchEnabled);
  }
});
