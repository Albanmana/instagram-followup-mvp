// ── Defaults (from .env) ─────────────────────────────────────
const DEFAULT_CRM_UPDATE_URL = "https://n8n.srv765660.hstgr.cloud/webhook/8472dc92-a513-4739-bc7a-0261e2e71b00";
const DEFAULT_AUTO_FETCH_URL = "https://n8n.srv765660.hstgr.cloud/webhook/ada824b2-daf0-4209-b302-38cbcce1e57e";
const DEFAULT_MARK_DONE_URL  = "https://n8n.srv765660.hstgr.cloud/webhook/405003b5-07bb-47bf-a087-15714542fd31";
const DEFAULT_BATCH_DELAY    = 400;
const DEFAULT_N8N_API_KEY    = "ExPA5$sG5ngS9h?G";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_RUN_LOGS") {
    getRunLogs()
      .then((logs) => sendResponse({ ok: true, logs }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type !== "SEND_TEST_MESSAGE") {
    return false;
  }

  sendTestMessage(message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

async function sendTestMessage({ handle, message, has_gif, gif_query }) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await clearRunLogs();
  await appendRunLog("background", `Starting run ${runId} for @${handle}.`);

  try {
    const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    await appendRunLog("background", `Opening ${url}`);
    const tab = await chrome.tabs.create({ url, active: true });

    if (!tab.id) {
      throw new Error("Chrome did not return a tab id.");
    }

    await appendRunLog("background", `Created tab ${tab.id}. Waiting for load.`);
    await waitForTabLoad(tab.id);
    await appendRunLog("background", `Tab ${tab.id} loaded.`);
    await delay(1500);

    const hasGif = ["true", "1", "yes"].includes(String(has_gif ?? "").toLowerCase());
    const gifQuery = (gif_query ?? "").trim();

    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [message, runId, hasGif, gifQuery],
      func: async (textToSend, activeRunId, hasGif, gifQuery) => {
      const runtime = window.chrome?.runtime;
      const sendLog = (stage, detail) => {
        console.log(`[IG Follow-Up][${activeRunId}][${stage}] ${detail}`);
        if (runtime?.sendMessage) {
          runtime.sendMessage({
            type: "RUN_LOG",
            payload: { source: "content", message: `[${stage}] ${detail}` }
          });
        }
      };

      const labelTexts = {
        messageButton: ["message", "envoyer un message", "contact", "contacter"],
        sendButton: ["send", "envoyer"],
        composerAria: ["message", "envoyer un message", "votre message"]
      };

      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const normalize = (value) =>
        (value || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .trim();

      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const getElementLabel = (element) => {
        return (
          normalize(element.textContent) ||
          normalize(element.getAttribute("aria-label")) ||
          normalize(element.getAttribute("title")) ||
          normalize(element.getAttribute("placeholder"))
        );
      };

      const findButtonByText = (texts) => {
        const buttons = Array.from(document.querySelectorAll("button, a[role='link'], div[role='button']"));
        return buttons.find((button) => {
          const rawText = getElementLabel(button);

          return isVisible(button) && texts.some((text) => rawText.includes(text));
        });
      };

      const getVisibleActionLabels = () => {
        return Array.from(document.querySelectorAll("button, a[role='link'], div[role='button']"))
          .filter((button) => isVisible(button))
          .map((button) => getElementLabel(button) || "<icon-only>")
          .filter(Boolean)
          .slice(0, 25);
      };

      const findProfileActionButton = () => {
        const selectors = ["header", "main"];

        for (const selector of selectors) {
          const root = document.querySelector(selector);
          if (!root) {
            continue;
          }

          const buttons = Array.from(root.querySelectorAll("button, a[role='link'], div[role='button']"));
          const match = buttons.find((button) => {
            const label = getElementLabel(button);

            return isVisible(button) && labelTexts.messageButton.some((text) => label.includes(text));
          });

          if (match) {
            return match;
          }
        }

        return findButtonByText(labelTexts.messageButton);
      };

      const findSendButton = (composer) => {
        const exactSendButton = Array.from(document.querySelectorAll("button, div[role='button']")).find((button) => {
          const label = getElementLabel(button);
          return isVisible(button) && labelTexts.sendButton.some((text) => label === text || label.includes(text));
        });

        if (exactSendButton) {
          return exactSendButton;
        }

        const containers = [];
        let current = composer;

        while (current && containers.length < 5) {
          containers.push(current);
          current = current.parentElement;
        }

        for (const container of containers) {
          const buttons = Array.from(container.querySelectorAll("button, div[role='button']"));
          const candidate = buttons.find((button) => {
            if (!isVisible(button) || button === composer) {
              return false;
            }

            const label = getElementLabel(button);

            if (labelTexts.sendButton.some((text) => label.includes(text))) {
              return true;
            }

            const ariaLabel = normalize(button.getAttribute("aria-label"));
            if (ariaLabel.includes("emoji") || label.includes("emoji")) {
              return false;
            }

            return false;
          });

          if (candidate) {
            return candidate;
          }
        }

        return null;
      };

      const waitFor = async (finder, stage, timeoutMs = 15000, onTimeout) => {
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
          const result = finder();
          if (result) {
            return result;
          }

          await delay(400);
        }

        if (onTimeout) {
          onTimeout();
        }

        throw new Error(`Timed out while waiting for ${stage}.`);
      };

      const setComposerValue = (element, value) => {
        sendLog("composer", "Filling message composer.");
        element.focus();

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);

        document.execCommand("selectAll", false, null);
        const inserted = document.execCommand("insertText", false, value);

        if (!inserted) {
          element.textContent = value;
          element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
        }
      };

      const findComposer = () => {
        const candidates = Array.from(
          document.querySelectorAll("div[contenteditable='true'], textarea")
        );

        return candidates.find((candidate) => {
          const label = getElementLabel(candidate);

          return isVisible(candidate) && labelTexts.composerAria.some((text) => label.includes(text));
        }) || candidates.find((candidate) => isVisible(candidate));
      };

      const findGifSearchInput = () => {
        const candidates = Array.from(
          document.querySelectorAll(
            'input[aria-label="Rechercher dans GIPHY"], input[placeholder="Rechercher dans GIPHY"]'
          )
        );

        return candidates.find((candidate) => isVisible(candidate)) || null;
      };

      const findVisibleGifTabs = () =>
        Array.from(document.querySelectorAll('[role="tab"]')).filter((tab) => isVisible(tab));

      const findGifPickerButton = () => {
        const directButton = document.querySelector('button[aria-label="Choisir un GIF ou un sticker"]');
        if (directButton && isVisible(directButton)) {
          return directButton;
        }

        const icon = document.querySelector('[aria-label="Choisir un GIF ou un sticker"]');
        const parentButton = icon?.closest('button,[role="button"],div[role="button"]');

        if (parentButton && isVisible(parentButton)) {
          return parentButton;
        }

        return null;
      };

      const findVisibleGifResultButtons = () =>
        Array.from(
          document.querySelectorAll(
            'div[role="button"][aria-label^="Send Animated Image"], button[aria-label^="Send Animated Image"]'
          )
        )
          .filter((button) => isVisible(button));

      const findFirstGifResult = () => findVisibleGifResultButtons()[0] ?? null;

      const clickFirstGifResult = async () => {
        const button = await waitFor(findFirstGifResult, "GIF result", 8000).catch(() => null);

        if (!button) {
          sendLog("gif", "No GIF result found — skipping.");
          return false;
        }

        button.scrollIntoView({ block: "center", inline: "center" });
        await delay(200);

        let freshButton = findFirstGifResult();
        if (!freshButton) {
          sendLog("gif", "GIF result disappeared before click. Retrying once.");
          await delay(400);
          freshButton = findFirstGifResult();
        }

        if (!freshButton) {
          sendLog("gif", "GIF result still unavailable after retry — skipping.");
          return false;
        }

        freshButton.click();
        sendLog("gif", "GIF sent.");
        await delay(800);
        return true;
      };

      sendLog("profile", `Visible action labels on page: ${getVisibleActionLabels().join(" | ")}`);

      const messageButton = await waitFor(
        findProfileActionButton,
        "the profile message button",
        15000,
        () => sendLog("profile", `Did not find a profile message button. Visible labels: ${getVisibleActionLabels().join(" | ")}`)
      );

      sendLog("profile", "Found message button. Opening conversation.");
      messageButton.click();
      await delay(1500);

      const composer = await waitFor(findComposer, "the message composer");
      sendLog("composer", "Composer found.");

      if (hasGif && gifQuery) {
        sendLog("gif", `Sending GIF: "${gifQuery}"`);
        const pickerBtn = await waitFor(
          findGifPickerButton,
          "GIF picker button",
          5000
        ).catch(() => null);

        if (pickerBtn) {
          sendLog("gif", "Step 1/3: opening sticker/GIF picker.");
          pickerBtn.click();
          await delay(800);

          let searchInput = findGifSearchInput();

          if (!searchInput) {
            const gifTabs = findVisibleGifTabs();
            const gifTab =
              gifTabs.find((tab) => normalize(tab.textContent).includes("gif"))
              ?? gifTabs[1]
              ?? null;

            if (gifTab) {
              sendLog("gif", "Step 2/3: switching to the GIPHY tab.");
              gifTab.click();
              await delay(600);
            } else {
              sendLog("gif", `No visible GIF tab found. Visible tabs: ${gifTabs.map((tab) => normalize(tab.textContent) || "<icon-only>").join(" | ")}`);
            }
          } else {
            sendLog("gif", "Step 2/3: GIPHY tab already open.");
          }

          searchInput = await waitFor(
            findGifSearchInput,
            "GIPHY search input",
            5000
          ).catch(() => null);

          if (searchInput) {
            sendLog("gif", "Step 3/3: filling the GIPHY search input.");
            searchInput.focus();
            searchInput.click();
            searchInput.select?.();

            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
            setter.call(searchInput, "");
            searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: null, inputType: "deleteContentBackward" }));
            setter.call(searchInput, gifQuery);
            searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: gifQuery, inputType: "insertText" }));
            searchInput.dispatchEvent(new Event("change", { bubbles: true }));
            await delay(200);
            sendLog("gif", `Search input value is now: "${searchInput.value}"`);
            sendLog("gif", "Waiting 2500ms for GIPHY results to render.");
            await delay(2500);
            await clickFirstGifResult();
          } else {
            sendLog("gif", "GIPHY search input not found — skipping.");
          }
        } else {
          sendLog("gif", "GIF picker button not found — skipping.");
        }
      }

      setComposerValue(composer, textToSend);
      await delay(600);

      const sendButton = findSendButton(composer) || findButtonByText(labelTexts.sendButton);

      if (sendButton) {
        sendLog("send", "Send button found. Clicking it.");
        sendButton.click();
      } else {
        sendLog("send", "No send button found. Falling back to Enter key.");
        composer.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            which: 13,
            keyCode: 13,
            bubbles: true
          })
        );
        composer.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: "Enter",
            code: "Enter",
            which: 13,
            keyCode: 13,
            bubbles: true
          })
        );
      }

      await delay(1200);
      sendLog("done", "Send flow completed.");

      return {
        stage: "sent",
        sentText: textToSend
      };
      }
    });

    if (!execution?.result) {
      throw new Error("Instagram automation finished without a result.");
    }

    await appendRunLog("background", `Run ${runId} completed with stage ${execution.result.stage}.`);
    return { ...execution.result, tabId: tab.id };
  } catch (error) {
    await appendRunLog("background", `Run ${runId} failed: ${error.message}`);
    throw error;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "RUN_LOG") {
    return false;
  }

  appendRunLog(message.payload?.source || "content", message.payload?.message || "Unknown log entry.")
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(listener);
    };

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback(value);
    };

    const listener = (updatedTabId, info) => {
      if (updatedTabId !== tabId || info.status !== "complete") {
        return;
      }

      finish(resolve);
    };

    const timeoutId = setTimeout(() => {
      finish(reject, new Error("Instagram did not finish loading in time."));
    }, 30000);

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        finish(reject, new Error(chrome.runtime.lastError.message));
        return;
      }

      if (tab?.status === "complete") {
        finish(resolve);
      }
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendRunLog(source, message) {
  const { runLogs = [] } = await chrome.storage.local.get("runLogs");
  const nextLogs = [
    ...runLogs,
    {
      at: new Date().toISOString(),
      source,
      message
    }
  ].slice(-200);

  await chrome.storage.local.set({ runLogs: nextLogs });
  console.log(`[IG Follow-Up][${source}] ${message}`);
}

async function clearRunLogs() {
  await chrome.storage.local.set({ runLogs: [] });
}

async function getRunLogs() {
  const { runLogs = [] } = await chrome.storage.local.get("runLogs");
  return runLogs;
}

async function getBatchState() {
  const {
    batchQueue = [],
    batchIndex = 0,
    batchStatus = null,
    batchLogs = [],
    batchDelay = 400
  } = await chrome.storage.local.get(["batchQueue", "batchIndex", "batchStatus", "batchLogs", "batchDelay"]);
  return { batchQueue, batchIndex, batchStatus, batchLogs, batchDelay };
}

async function clearBatchState() {
  await chrome.storage.local.set({
    batchQueue: [],
    batchIndex: 0,
    batchStatus: null,
    batchLogs: []
  });
}

async function appendBatchLog(entry) {
  const { batchLogs = [] } = await chrome.storage.local.get("batchLogs");
  const next = [...batchLogs, entry].slice(-500);
  await chrome.storage.local.set({ batchLogs: next });
}

async function setBatchStatus(status) {
  await chrome.storage.local.set({ batchStatus: status });
}

async function scheduleBatchAlarm() {
  const { batchDelay = DEFAULT_BATCH_DELAY } = await chrome.storage.local.get("batchDelay");
  chrome.alarms.create("IG_BATCH_NEXT", { delayInMinutes: batchDelay / 60 });
}

async function processBatchItem(index) {
  const { batchQueue, batchStatus } = await getBatchState();

  if (batchStatus !== "running") return;
  if (index >= batchQueue.length) {
    await setBatchStatus("done");
    return;
  }

  const row = batchQueue[index];
  const { handle, message, has_gif, gif_query } = row;

  try {
    const result = await sendTestMessage({ handle, message, has_gif, gif_query });
    await appendBatchLog({ handle, status: "sent", at: new Date().toISOString() });
    await callMarkDone(row);
    if (result?.tabId) {
      await appendRunLog("background", `Closing tab ${result.tabId} after mark-done webhook.`);
      await chrome.tabs.remove(result.tabId).catch(() => {});
    }
  } catch (error) {
    await appendBatchLog({
      handle,
      status: "error",
      error: error.message,
      at: new Date().toISOString()
    });
  }

  const nextIndex = index + 1;
  await chrome.storage.local.set({ batchIndex: nextIndex });

  if (nextIndex < batchQueue.length) {
    scheduleBatchAlarm();
  } else {
    await setBatchStatus("done");
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "IG_BATCH_NEXT") {
    const { batchIndex } = await getBatchState();
    await processBatchItem(batchIndex);
    return;
  }
  if (alarm.name === "IG_AUTO_FETCH") {
    try {
      await runAutoFetch();
    } catch (error) {
      await appendRunLog("auto-fetch", `Error: ${error.message}`);
      console.error(`[IG Follow-Up] Auto-fetch failed: ${error.message}`);
    }
    return;
  }
  if (alarm.name === "IG_CRM_SYNC") {
    try {
      await runCrmSync();
    } catch (error) {
      await appendCrmLog(`Error: ${error.message}`);
    }
  }
});

// Re-register alarms after Chrome restarts (alarms persist but being explicit is safer)
chrome.runtime.onStartup.addListener(async () => {
  const {
    autoFetchEnabled,
    autoFetchIntervalHours = 3,
    crmSyncEnabled,
    crmSyncIntervalHours = 6,
  } = await chrome.storage.local.get([
    "autoFetchEnabled", "autoFetchIntervalHours",
    "crmSyncEnabled", "crmSyncIntervalHours",
  ]);

  if (autoFetchEnabled) {
    const existing = await new Promise((resolve) => chrome.alarms.get("IG_AUTO_FETCH", resolve));
    if (!existing) {
      chrome.alarms.create("IG_AUTO_FETCH", { periodInMinutes: autoFetchIntervalHours * 60 });
    }
  }

  if (crmSyncEnabled) {
    const existing = await new Promise((resolve) => chrome.alarms.get("IG_CRM_SYNC", resolve));
    if (!existing) {
      chrome.alarms.create("IG_CRM_SYNC", { periodInMinutes: crmSyncIntervalHours * 60 });
    }
  }
});

// ── Crypto helpers ────────────────────────────────────────────
function bufToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuf(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function getDecryptedApiKey() {
  const { apiKeyEncrypted, apiKeyIv, apiKeyCryptoKey } =
    await chrome.storage.local.get(["apiKeyEncrypted", "apiKeyIv", "apiKeyCryptoKey"]);
  if (!apiKeyEncrypted || !apiKeyIv || !apiKeyCryptoKey) return DEFAULT_N8N_API_KEY;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      base64ToBuf(apiKeyCryptoKey),
      { name: "AES-GCM" },
      false,
      ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuf(apiKeyIv) },
      cryptoKey,
      base64ToBuf(apiKeyEncrypted)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

// ── CSV parser (background copy) ─────────────────────────────
function parseLine(line) {
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

function parseCSVText(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().trim());
  const handleIdx = headers.indexOf("handle");
  const messageIdx = headers.indexOf("message");
  if (handleIdx === -1 || messageIdx === -1) return [];

  return lines.slice(1).reduce((acc, line) => {
    const cells = parseLine(line);
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

// ── Auto-fetch ────────────────────────────────────────────────
async function runAutoFetch(forceRun = false) {
  const { autoFetchUrl = DEFAULT_AUTO_FETCH_URL, autoFetchEnabled } =
    await chrome.storage.local.get(["autoFetchUrl", "autoFetchEnabled"]);
  if (!autoFetchUrl) throw new Error("No URL configured in Settings.");
  if (!forceRun && !autoFetchEnabled) return;

  await appendRunLog("auto-fetch", `Fetching from ${autoFetchUrl}…`);

  const headers = { Accept: "text/csv,text/plain,*/*" };
  const apiKey = await getDecryptedApiKey();
  if (apiKey) headers["x-api-key"] = apiKey;

  const response = await fetch(autoFetchUrl, { headers });
  if (!response.ok) {
    await appendRunLog("auto-fetch", `HTTP error ${response.status} — fetch aborted.`);
    throw new Error(`Endpoint returned ${response.status}`);
  }

  const rows = parseCSVText(await response.text());
  await appendRunLog("auto-fetch", `Response received — ${rows.length} valid row(s).`);

  if (rows.length === 0) {
    await appendRunLog("auto-fetch", "No valid rows — batch not started.");
    return;
  }

  const { batchDelay = DEFAULT_BATCH_DELAY } = await chrome.storage.local.get("batchDelay");
  await chrome.alarms.clear("IG_BATCH_NEXT");
  await chrome.storage.local.set({
    batchQueue: rows,
    batchIndex: 0,
    batchStatus: "running",
    batchLogs: [],
    batchDelay,
  });
  await appendRunLog("auto-fetch", `Batch started — ${rows.length} message(s) queued (delay: ${batchDelay}s).`);
  await processBatchItem(0);
}

// ── CRM Sync ──────────────────────────────────────────────────

let crmSyncPendingTabId = null;
let crmSyncPendingTimeout = null;

async function runCrmSync(forceRun = false) {
  const { crmSyncEnabled, crmWebhookUrl = DEFAULT_CRM_UPDATE_URL } =
    await chrome.storage.local.get(["crmSyncEnabled", "crmWebhookUrl"]);
  if (!crmWebhookUrl) throw new Error("No CRM webhook URL configured in Settings.");
  if (!forceRun && !crmSyncEnabled) return;

  await appendCrmLog("Starting CRM sync — opening Instagram DMs…");
  await chrome.storage.local.set({ crmSyncRequestedAt: Date.now() });

  // crm-hook.js (MAIN world content script) is always pre-installed via manifest
  // so no executeScript needed here — just open the tab and wait for postMessage
  const tab = await chrome.tabs.create({ url: "https://www.instagram.com/direct/", active: true });
  crmSyncPendingTabId = tab.id;
  await appendCrmLog(`[debug] Tab created: id=${tab.id} status=${tab.status}`);

  if (crmSyncPendingTimeout) clearTimeout(crmSyncPendingTimeout);
  crmSyncPendingTimeout = setTimeout(async () => {
    if (crmSyncPendingTabId != null) {
      chrome.tabs.remove(crmSyncPendingTabId).catch(() => {});
      crmSyncPendingTabId = null;
    }
    await chrome.storage.local.set({ crmSyncRequestedAt: 0 });
    await appendCrmLog("Timeout — no data received from Instagram within 30s.");
  }, 30000);
}

async function processCrmData(rawData) {
  const edges = rawData?.data
    ?.get_slide_mailbox_for_iris_subscription
    ?.threads_by_system_folder_and_ig_inbox_folder
    ?.edges;

  if (!Array.isArray(edges)) throw new Error("Unexpected Instagram response structure.");

  await appendCrmLog(`Received ${edges.length} thread(s) from Instagram.`);

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const myFbid = edges[0]?.node?.as_ig_direct_thread?.viewer?.interop_messaging_user_fbid ?? null;

  let skippedUnread = 0;
  let skippedOld = 0;
  const results = [];

  for (const edge of edges) {
    const thread = edge?.node?.as_ig_direct_thread;
    if (!thread) continue;

    if (thread.marked_as_unread) { skippedUnread++; continue; }

    const lastActivity = parseInt(thread.last_activity_timestamp_ms, 10);
    if (lastActivity < thirtyDaysAgo) { skippedOld++; continue; }

    const username = thread.users?.[0]?.username;
    if (!username) continue;

    const lastMsgNode = thread.slide_messages?.edges?.[0]?.node;
    const sentByMe = myFbid != null && lastMsgNode?.sender_fbid === myFbid;

    results.push({
      handle: username,
      thread_key: thread.thread_key,
      last_activity_ms: lastActivity,
      last_message_sent_by_me: sentByMe,
      last_message_preview: lastMsgNode?.igd_snippet ?? "",
      last_message_text: lastMsgNode?.text_body ?? "",
      last_message_timestamp_ms: lastMsgNode?.timestamp_ms
        ? parseInt(lastMsgNode.timestamp_ms, 10)
        : null,
    });
  }

  await appendCrmLog(
    `Filtered: ${results.length} thread(s) to sync (skipped ${skippedUnread} unread, ${skippedOld} too old).`
  );

  if (results.length === 0) {
    await appendCrmLog("Nothing to send to CRM.");
    return;
  }

  const { crmWebhookUrl = DEFAULT_CRM_UPDATE_URL } = await chrome.storage.local.get("crmWebhookUrl");
  const crmApiKey = await getDecryptedCrmApiKey();
  const headers = { "Content-Type": "application/json" };
  if (crmApiKey) headers["x-api-key"] = crmApiKey;

  const response = await fetch(crmWebhookUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ threads: results, synced_at: new Date().toISOString() }),
  });

  if (!response.ok) throw new Error(`CRM webhook returned ${response.status}`);

  await appendCrmLog(`Sent ${results.length} thread(s) to CRM. Status: ${response.status}.`);
  await chrome.storage.local.set({
    crmLastSync: new Date().toISOString(),
    crmLastSyncCount: results.length,
  });
}

async function appendCrmLog(message) {
  const { crmLogs = [] } = await chrome.storage.local.get("crmLogs");
  const next = [...crmLogs, { at: new Date().toISOString(), message }].slice(-100);
  await chrome.storage.local.set({ crmLogs: next });
  console.log(`[IG Follow-Up][crm] ${message}`);
}

async function getCrmLogs() {
  const { crmLogs = [] } = await chrome.storage.local.get("crmLogs");
  return crmLogs;
}

async function getDecryptedCrmApiKey() {
  const { crmApiKeyEncrypted, crmApiKeyIv, crmApiKeyCryptoKey } =
    await chrome.storage.local.get(["crmApiKeyEncrypted", "crmApiKeyIv", "crmApiKeyCryptoKey"]);
  if (!crmApiKeyEncrypted || !crmApiKeyIv || !crmApiKeyCryptoKey) return DEFAULT_N8N_API_KEY;
  try {
    const cryptoKey = await crypto.subtle.importKey(
      "raw", base64ToBuf(crmApiKeyCryptoKey), { name: "AES-GCM" }, false, ["decrypt"]
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBuf(crmApiKeyIv) },
      cryptoKey,
      base64ToBuf(crmApiKeyEncrypted)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}

async function callMarkDone(row) {
  const { markDoneUrl = DEFAULT_MARK_DONE_URL } = await chrome.storage.local.get("markDoneUrl");
  if (!markDoneUrl) return;
  const apiKey = await getDecryptedApiKey();
  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;
  try {
    await fetch(markDoneUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...row, sent_at: new Date().toISOString() }),
    });
  } catch (e) {
    await appendRunLog("mark-done", `Error: ${e.message}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CRM_INBOX_DATA") {
    (async () => {
      try {
        const { crmSyncRequestedAt = 0 } = await chrome.storage.local.get("crmSyncRequestedAt");
        if (Date.now() - crmSyncRequestedAt > 60000) {
          sendResponse({ ok: false, error: "No CRM sync pending." });
          return;
        }
        await chrome.storage.local.set({ crmSyncRequestedAt: 0 });
        if (crmSyncPendingTimeout != null) {
          clearTimeout(crmSyncPendingTimeout);
          crmSyncPendingTimeout = null;
        }
        await processCrmData(message.data);
        if (crmSyncPendingTabId != null) {
          chrome.tabs.remove(crmSyncPendingTabId).catch(() => {});
          crmSyncPendingTabId = null;
        }
        sendResponse({ ok: true });
      } catch (error) {
        await appendCrmLog(`Processing error: ${error.message}`);
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "TRIGGER_CRM_SYNC") {
    (async () => {
      try {
        await runCrmSync(true);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "GET_CRM_LOGS") {
    getCrmLogs()
      .then((logs) => sendResponse({ ok: true, logs }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_BATCH") {
    (async () => {
      try {
        const rows = message.payload?.rows ?? [];
        const delaySeconds = message.payload?.delaySeconds ?? 400;
        await chrome.alarms.clear("IG_BATCH_NEXT");
        await chrome.storage.local.set({
          batchQueue: rows,
          batchIndex: 0,
          batchStatus: "running",
          batchLogs: [],
          batchDelay: delaySeconds
        });
        sendResponse({ ok: true });
        await processBatchItem(0);
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "STOP_BATCH") {
    (async () => {
      try {
        await chrome.alarms.clear("IG_BATCH_NEXT");
        await setBatchStatus("stopped");
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "GET_BATCH_STATUS") {
    getBatchState()
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "TRIGGER_AUTO_FETCH") {
    (async () => {
      try {
        await runAutoFetch(true);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});
