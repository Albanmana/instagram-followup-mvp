import { createPlatformAdapters, getPlatformAdapter } from "./platform-adapters.js";
import { validateBatchRows } from "./batch-validation.js";
import { normalizePersistedQueueItems, normalizeSenderOutcome } from "./platforms.js";
import { installLinkedInTestDebugBridge } from "./linkedin-test-debug-bridge.js";
import {
  discoverLinkedInComposeHref,
  sendLinkedInComposeMessage,
  validateLinkedInTestPayload,
} from "./linkedin-send.js";
import { createApiClient, chromeStorageAdapter } from "./api-client.js";
import { createExtensionResult } from "./result-reporting.js";
import {
  createResultReportCoordinator,
  initializeResultReportRecovery,
} from "./result-outbox.js";

// ── Defaults (from .env) ─────────────────────────────────────
const DEFAULT_BATCH_DELAY = 400;
const SCRAPE_POST_TIMEOUT_MS = 30000;
const SCRAPE_PROFILE_TIMEOUT_MS = 12000;
const SCRAPE_LOG_LIMIT = 300;
const RESULT_REPORT_RETRY_ALARM = "COLD_DM_RESULT_REPORT_RETRY";
const MANUAL_TEST_HISTORY_KEY = "manualTestHistory";
const MANUAL_TEST_HISTORY_LIMIT = 100;
const resultApi = createApiClient({ storage: chromeStorageAdapter, baseUrl: "" });
const resultReportCoordinator = createResultReportCoordinator({
  storage: chromeStorageAdapter,
  reportResults: resultApi.reportResults,
  alarms: chrome.alarms,
  alarmName: RESULT_REPORT_RETRY_ALARM,
});

async function flushResultOutbox() {
  return resultReportCoordinator.flush();
}

function startResultOutboxFlush() {
  void flushResultOutbox().catch(() => {
    void resultReportCoordinator.scheduleRetry().catch(() => undefined);
  });
}

initializeResultReportRecovery({
  runtime: chrome.runtime,
  recover: startResultOutboxFlush,
});

async function reportBatchLog(entry) {
  const result = createExtensionResult(entry);
  if (!result) return;
  await resultReportCoordinator.enqueue(result);
  startResultOutboxFlush();
}

async function appendManualTestHistory(entry) {
  const { [MANUAL_TEST_HISTORY_KEY]: history = [] } = await chrome.storage.local.get(MANUAL_TEST_HISTORY_KEY);
  await chrome.storage.local.set({
    [MANUAL_TEST_HISTORY_KEY]: [{ ...entry, localOnly: true }, ...history].slice(0, MANUAL_TEST_HISTORY_LIMIT),
  });
}

const adapters = createPlatformAdapters({
  sendInstagramMessage,
  getInstagramSession: async () => Boolean(await chrome.cookies.get({
    url: "https://www.instagram.com",
    name: "sessionid",
  })),
  sendLinkedInMessage: (item) => sendLinkedInTestMessage({
    profileUrl: item.recipient.profileUrl,
    message: item.message,
  }),
  getLinkedInSession: async () => Boolean(await chrome.cookies.get({
    url: "https://www.linkedin.com",
    name: "li_at",
  })),
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_RUN_LOGS") {
    getRunLogs()
      .then((logs) => sendResponse({ ok: true, logs }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type === "SEND_LINKEDIN_TEST_MESSAGE") {
    sendLinkedInTestMessage(message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message?.type !== "SEND_TEST_MESSAGE") {
    return false;
  }

  sendInstagramMessage(message.payload)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});

export async function sendLinkedInTestMessage(rawPayload) {
  const payload = validateLinkedInTestPayload(rawPayload);
  await clearRunLogs();
  await appendRunLog("linkedin-test", "Starting temporary LinkedIn send test.");

  try {
    const tab = await chrome.tabs.create({ url: payload.profileUrl, active: true });
    if (!tab.id) {
      throw new Error("Chrome did not return a tab id.");
    }

    await appendRunLog("linkedin-test", `Opened profile tab ${tab.id}; waiting for load.`);
    await waitForTabLoad(tab.id);

    const [discoveryExecution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: discoverLinkedInComposeHref,
      args: [payload.profileUrl],
    });
    if (discoveryExecution?.error) {
      throw new Error(`LinkedIn profile discovery failed: ${discoveryExecution.error.message ?? "unknown scripting error"}`);
    }

    const discovery = discoveryExecution?.result;
    if (!discovery) {
      throw new Error("LinkedIn profile discovery returned no structured result.");
    }
    if (discovery.status !== "ready") {
      await appendRunLog("linkedin-test", `Profile discovery ended with ${discovery.status ?? "unknown"}.`);
      return { ...discovery, at: discovery.at ?? new Date().toISOString() };
    }

    const composeUrl = new URL(discovery.composeHref, "https://www.linkedin.com").href;
    await appendRunLog("linkedin-test", `Navigating tab ${tab.id} to the observed compose link.`);
    await chrome.tabs.update(tab.id, { url: composeUrl });
    await waitForTabLoad(tab.id);

    const [sendExecution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: sendLinkedInComposeMessage,
      args: [payload.profileUrl, discovery.recipientId, payload.message],
    });
    if (sendExecution?.error) {
      throw new Error(`LinkedIn compose send failed: ${sendExecution.error.message ?? "unknown scripting error"}`);
    }

    const result = sendExecution?.result;
    if (!result) {
      throw new Error("LinkedIn compose send returned no structured result.");
    }

    const outcome = { ...result, at: new Date().toISOString() };
    await appendRunLog("linkedin-test", `Compose step completed with ${outcome.status ?? "unknown"}.`);
    return outcome;
  } catch (error) {
    const outcome = {
      status: "failed",
      reason: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    };
    await appendRunLog("linkedin-test", `Temporary LinkedIn send test failed: ${outcome.reason}`);
    return outcome;
  }
}

installLinkedInTestDebugBridge(globalThis, sendLinkedInTestMessage);

async function sendInstagramMessage({ recipient, handle = recipient?.handle, message, has_gif, gif_query }) {
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let openedTabId = null;
  await clearRunLogs();
  await appendRunLog("background", `Starting run ${runId} for @${handle}.`);

  try {
    const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;
    await appendRunLog("background", `Opening ${url}`);
    const tab = await chrome.tabs.create({ url, active: true });

    if (!tab.id) {
      throw new Error("Chrome did not return a tab id.");
    }

    openedTabId = tab.id;
    await appendRunLog("background", `Created tab ${tab.id}. Waiting for load.`);
    await waitForTabLoad(tab.id);
    await appendRunLog("background", `Tab ${tab.id} loaded.`);
    await delay(1500);

    const hasGif = ["true", "1", "yes"].includes(String(has_gif ?? "").toLowerCase());
    const gifQuery = (gif_query ?? "").trim();

    const [execution] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [handle, message, runId, hasGif, gifQuery],
      func: async (targetHandle, textToSend, activeRunId, hasGif, gifQuery) => {
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

      const findRealProfileActionButton = (root) => {
        if (!root) {
          return null;
        }

        const buttons = Array.from(root.querySelectorAll("button, a[role='link'], div[role='button']"));
        return buttons.find((button) => {
          const label = getElementLabel(button);

          if (!isVisible(button) || !labelTexts.messageButton.some((text) => label.includes(text))) {
            return false;
          }

          // Ignore the floating inbox drawer button; we only want profile-header actions here.
          if (label === "messagesmessages" || label === "messages") {
            return false;
          }

          const rect = button.getBoundingClientRect();
          return rect.top < window.innerHeight * 0.75;
        }) || null;
      };

      const findProfileActionButton = () => {
        const selectors = ["header", "main > div", "main"];

        for (const selector of selectors) {
          const root = document.querySelector(selector);
          const match = findRealProfileActionButton(root);

          if (match) {
            return match;
          }
        }

        return null;
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

      const waitForLocation = async (matcher, stage, timeoutMs = 15000) => {
        await waitFor(
          () => {
            const path = window.location.pathname || "";
            return matcher(path) ? path : null;
          },
          stage,
          timeoutMs
        );
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

      const findInboxSearchInput = () => {
        const candidates = Array.from(document.querySelectorAll("input"));
        return candidates.find((candidate) => {
          const placeholder = normalize(candidate.getAttribute("placeholder"));
          const ariaLabel = normalize(candidate.getAttribute("aria-label"));
          return isVisible(candidate) && [placeholder, ariaLabel].some((value) => value.includes("rechercher") || value.includes("search"));
        }) || null;
      };

      const typeIntoInboxSearch = async (input, query) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        if (!setter) {
          throw new Error("Could not access the native input value setter.");
        }

        const chars = Array.from(query);
        input.focus();
        setter.call(input, "");
        input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "deleteContentBackward", data: null }));
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
        await delay(120);

        for (const char of chars) {
          const nextValue = `${input.value || ""}${char}`;
          setter.call(input, nextValue);
          input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: char }));
          input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: char }));
          input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: char }));
          input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: char }));
          await delay(80);
        }

        input.dispatchEvent(new Event("change", { bubbles: true }));
      };

      const findInboxResultButton = (username) => {
        const normalizedUsername = normalize(String(username || "").replace(/^@+/, ""));
        if (!normalizedUsername) {
          return null;
        }

        const buttons = Array.from(document.querySelectorAll("button"));
        return buttons.find((button) => {
          const label = getElementLabel(button);
          return isVisible(button) && label.includes(normalizedUsername);
        }) || null;
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

      let composer = null;
      const messageButton = findProfileActionButton();

      if (messageButton) {
        sendLog("profile", `Found profile action button: "${getElementLabel(messageButton)}". Opening conversation.`);
        messageButton.click();
        await delay(1500);
        composer = await waitFor(findComposer, "the message composer", 6000).catch(() => null);

        if (!composer) {
          sendLog("fallback", "Profile action button did not open a composer. Switching to inbox fallback.");
        }
      } else {
        sendLog("fallback", `No profile message/contact button found. Visible labels: ${getVisibleActionLabels().join(" | ")}`);
      }

      if (!composer) {
        sendLog("fallback", `Inbox fallback requested for @${targetHandle}. Re-injection required after navigation.`);
        return {
          stage: "needs_inbox_fallback",
          targetHandle,
        };
      }

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

    if (execution?.error) {
      throw new Error(`Instagram automation script failed: ${execution.error.message ?? JSON.stringify(execution.error)}`);
    }

    if (!execution?.result) {
      throw new Error("Instagram automation finished without a result. The content script returned no structured result.");
    }

    let finalResult = execution.result;

    if (finalResult.stage === "needs_inbox_fallback") {
      await appendRunLog("background", `Profile flow requested inbox fallback for @${handle}.`);
      await appendRunLog("background", `Opening inbox fallback in tab ${tab.id}.`);
      await chrome.tabs.update(tab.id, { url: "https://www.instagram.com/direct/inbox/" });
      await waitForTabLoad(tab.id);
      await appendRunLog("background", `Inbox fallback tab ${tab.id} loaded.`);
      await delay(1500);

      const [fallbackExecution] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [handle, message, runId, hasGif, gifQuery],
        func: async (targetHandle, textToSend, activeRunId, hasGif, gifQuery) => {
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

          const waitForLocation = async (matcher, stage, timeoutMs = 15000) => {
            await waitFor(
              () => {
                const path = window.location.pathname || "";
                return matcher(path) ? path : null;
              },
              stage,
              timeoutMs
            );
          };

          const findComposer = () => {
            const candidates = Array.from(document.querySelectorAll("div[contenteditable='true'], textarea"));

            return candidates.find((candidate) => {
              const label = getElementLabel(candidate);
              return isVisible(candidate) && labelTexts.composerAria.some((text) => label.includes(text));
            }) || candidates.find((candidate) => isVisible(candidate));
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
                return labelTexts.sendButton.some((text) => label.includes(text));
              });

              if (candidate) {
                return candidate;
              }
            }

            return null;
          };

          const findInboxSearchInput = () => {
            const candidates = Array.from(document.querySelectorAll("input"));
            return candidates.find((candidate) => {
              const placeholder = normalize(candidate.getAttribute("placeholder"));
              const ariaLabel = normalize(candidate.getAttribute("aria-label"));
              return isVisible(candidate) && [placeholder, ariaLabel].some((value) => value.includes("rechercher") || value.includes("search"));
            }) || null;
          };

          const typeIntoInboxSearch = async (input, query) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
            if (!setter) {
              throw new Error("Could not access the native input value setter.");
            }

            const chars = Array.from(query);
            input.focus();
            setter.call(input, "");
            input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "deleteContentBackward", data: null }));
            input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward", data: null }));
            await delay(120);

            for (const char of chars) {
              const nextValue = `${input.value || ""}${char}`;
              setter.call(input, nextValue);
              input.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, inputType: "insertText", data: char }));
              input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: char }));
              input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: char }));
              input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: char }));
              await delay(80);
            }

            input.dispatchEvent(new Event("change", { bubbles: true }));
          };

          const findInboxResultButton = (username) => {
            const normalizedUsername = normalize(String(username || "").replace(/^@+/, ""));
            if (!normalizedUsername) {
              return null;
            }

            const buttons = Array.from(document.querySelectorAll("button"));
            return buttons.find((button) => {
              const label = getElementLabel(button);
              return isVisible(button) && label.includes(normalizedUsername);
            }) || null;
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
            ).filter((button) => isVisible(button));

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

          const normalizedUsername = String(targetHandle || "").replace(/^@+/, "").trim();
          if (!normalizedUsername) {
            throw new Error("Inbox fallback could not determine which Instagram handle to search.");
          }

          const firstSearchToken = normalizedUsername.slice(0, 1) || normalizedUsername;
          sendLog("fallback", `Inbox fallback script started for @${normalizedUsername}.`);
          await waitForLocation(
            (path) => path.startsWith("/direct/inbox"),
            "the inbox fallback route",
            20000
          );
          await delay(1500);

          const searchInput = await waitFor(
            findInboxSearchInput,
            "the inbox search input",
            10000,
            () => sendLog("fallback", "Inbox search input not found.")
          );
          sendLog("fallback", `Inbox search ready. Triggering search for @${normalizedUsername}.`);
          await typeIntoInboxSearch(searchInput, firstSearchToken);
          await delay(1200);

          const resultButton = await waitFor(
            () => findInboxResultButton(normalizedUsername),
            `the inbox result for @${normalizedUsername}`,
            12000,
            () => sendLog("fallback", `No visible inbox result yet for @${normalizedUsername}.`)
          );
          sendLog("fallback", `Inbox result found for @${normalizedUsername}. Opening conversation.`);
          resultButton.click();

          await waitForLocation(
            (path) => path.startsWith("/direct/t/"),
            "the inbox conversation route",
            20000
          );
          await delay(1200);

          const composer = await waitFor(findComposer, "the inbox fallback message composer", 12000);
          sendLog("composer", "Composer found via inbox fallback.");

          if (hasGif && gifQuery) {
            sendLog("gif", `Sending GIF: "${gifQuery}"`);
            const pickerBtn = await waitFor(findGifPickerButton, "GIF picker button", 5000).catch(() => null);

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

              searchInput = await waitFor(findGifSearchInput, "GIPHY search input", 5000).catch(() => null);

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

          const sendButton = findSendButton(composer);

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
          sendLog("done", "Inbox fallback send flow completed.");

          return {
            stage: "sent",
            sentText: textToSend,
            usedInboxFallback: true,
          };
        }
      });

      if (fallbackExecution?.error) {
        throw new Error(`Instagram inbox fallback script failed: ${fallbackExecution.error.message ?? JSON.stringify(fallbackExecution.error)}`);
      }

      if (!fallbackExecution?.result) {
        throw new Error("Instagram inbox fallback finished without a result. The content script returned no structured result.");
      }

      finalResult = fallbackExecution.result;
    }

    await appendRunLog("background", `Run ${runId} completed with stage ${finalResult.stage}.`);
    return { ...finalResult };
  } catch (error) {
    await appendRunLog("background", `Run ${runId} failed: ${error.message}`);
    throw error;
  } finally {
    if (openedTabId) {
      await appendRunLog("background", `Closing tab ${openedTabId} after run ${runId} (${handle}).`);
      await chrome.tabs.remove(openedTabId)
        .then(() => appendRunLog("background", `Closed tab ${openedTabId}.`))
        .catch(async (closeError) => {
          await appendRunLog("background", `Failed to close tab ${openedTabId}: ${closeError.message}`);
        });
    }
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

let activeScrapeRuntime = null;

function createScrapeRuntime(job) {
  return {
    job,
    stopRequested: false,
    collectedLeadsByUsername: new Map(),
    profilesByUsername: new Map(),
    profileWaiters: new Map(),
    postTabId: null,
    profileTabId: null,
  };
}

function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseKeywordList(value) {
  return String(value ?? "")
    .split(/[\n,]/)
    .map((item) => normalizeText(item))
    .filter(Boolean);
}

function parseBoolean(value) {
  return value === true || ["true", "1", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function parsePositiveInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInteger(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeInstagramProfileTarget(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) {
    throw new Error("Profile URL or handle is required.");
  }

  if (/^https?:\/\//i.test(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("Invalid Instagram profile URL.");
    }

    const hostname = parsed.hostname.replace(/^www\./i, "");
    if (hostname !== "instagram.com") {
      throw new Error("The profile URL must be an Instagram URL.");
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    const username = segments[0];
    if (!username || ["p", "reel", "tv", "explore", "stories", "direct"].includes(username)) {
      throw new Error("The URL must point to an Instagram profile.");
    }

    return `https://www.instagram.com/${username.replace(/^@+/, "")}/`;
  }

  const handle = value.replace(/^@+/, "").replace(/^https?:\/\/www\.instagram\.com\//i, "").replace(/\/+$/, "");
  if (!handle || handle.includes("/") || handle.includes("?")) {
    throw new Error("Profile URL or handle is invalid.");
  }

  return `https://www.instagram.com/${handle}/`;
}

function normalizePostUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || "").trim());
  } catch {
    throw new Error("Invalid post URL.");
  }

  if (!/instagram\.com$/i.test(parsed.hostname) && !/instagram\.com$/i.test(parsed.hostname.replace(/^www\./i, ""))) {
    throw new Error("The post URL must be an Instagram URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments.length < 2 || !["p", "reel", "tv"].includes(segments[0])) {
    throw new Error("The URL must point to an Instagram post or reel.");
  }

  return `https://www.instagram.com/${segments[0]}/${segments[1]}/`;
}

function buildScrapeFilters(input = {}) {
  const sourceType = ["comments", "followers", "following"].includes(input.sourceType)
    ? input.sourceType
    : "comments";
  const targetUrl = sourceType === "comments"
    ? normalizePostUrl(input.postUrl)
    : normalizeInstagramProfileTarget(input.postUrl);

  return {
    sourceType,
    postUrl: targetUrl,
    includeKeywords: parseKeywordList(input.includeKeywords),
    excludeKeywords: parseKeywordList(input.excludeKeywords),
    minimumCommentLength: Math.max(0, parseNonNegativeInteger(input.minimumCommentLength, 0)),
    maxLeads: Math.max(1, parsePositiveInteger(input.maxLeads, 30)),
    profileEnrichment: parseBoolean(input.profileEnrichment),
  };
}

async function appendScrapeLog(message) {
  const { scrapeLogs = [] } = await chrome.storage.local.get("scrapeLogs");
  const next = [...scrapeLogs, { at: new Date().toISOString(), message }].slice(-SCRAPE_LOG_LIMIT);
  await chrome.storage.local.set({ scrapeLogs: next });
  console.log(`[IG Follow-Up][scrape] ${message}`);
}

async function setScrapeCursor(cursor) {
  await chrome.storage.local.set({ scrapeCursor: cursor });
}

async function setScrapeStatus(status) {
  await chrome.storage.local.set({ scrapeStatus: status });
}

async function getScrapeState() {
  return chrome.storage.local.get([
    "scrapeJob",
    "scrapeStatus",
    "scrapeCursor",
    "scrapeResults",
    "scrapeLogs",
    "scrapeFilters",
  ]);
}

async function initializeScrapeState(job, filters) {
  await chrome.storage.local.set({
    scrapeJob: job,
    scrapeStatus: "running",
    scrapeCursor: { phase: "starting", collectedCount: 0, enrichedCount: 0 },
    scrapeResults: [],
    scrapeLogs: [],
    scrapeFilters: filters,
  });
}

async function setScrapeResults(results) {
  await chrome.storage.local.set({
    scrapeResults: Array.isArray(results) ? results : [],
  });
}

async function finalizeScrapeState(status, results) {
  const enrichedCount = results.filter((item) =>
    [item.bio, item.followers_count, item.posts_count, item.external_links]
      .some((value) => value != null && value !== "")
  ).length;

  await chrome.storage.local.set({
    scrapeStatus: status,
    scrapeResults: results,
    scrapeCursor: {
      phase: status,
      collectedCount: results.length,
      enrichedCount,
    },
  });
}

async function cleanupActiveScrapeTabs() {
  if (!activeScrapeRuntime) return;

  const tabIds = [activeScrapeRuntime.postTabId, activeScrapeRuntime.profileTabId].filter(Boolean);
  activeScrapeRuntime.postTabId = null;
  activeScrapeRuntime.profileTabId = null;

  for (const tabId of tabIds) {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function stopActiveScrape(reason = "stopped") {
  if (!activeScrapeRuntime) {
    await setScrapeStatus("stopped");
    return;
  }

  activeScrapeRuntime.stopRequested = true;
  activeScrapeRuntime.profileWaiters.forEach(({ resolve }) => resolve(null));
  activeScrapeRuntime.profileWaiters.clear();
  await appendScrapeLog(`Scrape stopped: ${reason}.`);
  await cleanupActiveScrapeTabs();
  await setScrapeStatus("stopped");
  await setScrapeCursor({ phase: "stopped", reason });
  activeScrapeRuntime = null;
}

function ensureScrapeNotStopped() {
  if (activeScrapeRuntime?.stopRequested) {
    throw new Error("Scrape stopped.");
  }
}

async function getBatchState() {
  const {
    batchQueue: storedBatchQueue = [],
    batchIndex = 0,
    batchStatus = null,
    batchLogs = [],
    batchDelay = 400
  } = await chrome.storage.local.get(["batchQueue", "batchIndex", "batchStatus", "batchLogs", "batchDelay"]);
  const batchQueue = normalizePersistedQueueItems(storedBatchQueue);
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
  chrome.alarms.create("COLD_DM_BATCH_NEXT", { delayInMinutes: batchDelay / 60 });
}

async function processBatchItem(index) {
  const { batchQueue, batchStatus } = await getBatchState();

  if (batchStatus !== "running") return;
  if (index >= batchQueue.length) {
    await setBatchStatus("done");
    return;
  }

  const row = batchQueue[index];
  const adapter = getPlatformAdapter(adapters, row.platform);
  const batchLogFields = {
    platform: row.platform,
    recipient: row.recipient,
    actionId: row.actionId,
    messageId: row.messageId,
    leadId: row.leadId,
    messageType: row.messageType,
    handle: row.recipient?.handle ?? row.handle,
    localOnly: row.localOnly === true,
  };

  let entry;
  try {
    if (!adapter) throw new Error("Unsupported platform.");
    const validationError = adapter.validateItem(row);
    if (validationError) throw new Error(validationError);
    const result = normalizeSenderOutcome(await adapter.send(row));
    const status = result.status;
    entry = {
      ...batchLogFields,
      status,
      ...(status !== "sent" && result?.reason ? { reason: result.reason } : {}),
      at: result?.at ?? new Date().toISOString(),
    };
  } catch (error) {
    entry = {
      ...batchLogFields,
      status: "error",
      error: error.message,
      at: new Date().toISOString()
    };
  }
  await appendBatchLog(entry);
  if (entry.localOnly) await appendManualTestHistory(entry);
  else await reportBatchLog(entry);

  const nextIndex = index + 1;
  await chrome.storage.local.set({ batchIndex: nextIndex });

  if (nextIndex < batchQueue.length) {
    scheduleBatchAlarm();
  } else {
    await setBatchStatus("done");
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === RESULT_REPORT_RETRY_ALARM) {
    startResultOutboxFlush();
    return;
  }
  if (alarm.name === "COLD_DM_BATCH_NEXT") {
    const { batchIndex } = await getBatchState();
    await processBatchItem(batchIndex);
  }
});

function formatTimestamp(value) {
  if (value == null || value === "") return "";

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const millis = numeric > 1e12 ? numeric : numeric > 1e10 ? numeric : numeric * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function getNestedValue(obj, path) {
  return path.reduce((current, key) => current?.[key], obj);
}

function recursiveWalk(value, visitor, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);

  visitor(value);

  if (Array.isArray(value)) {
    value.forEach((item) => recursiveWalk(item, visitor, seen));
    return;
  }

  Object.values(value).forEach((child) => recursiveWalk(child, visitor, seen));
}

function extractCommentsFromNetworkPayload(payload, postUrl) {
  const results = [];
  const seen = new Set();

  recursiveWalk(payload, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;

    const username =
      node.user?.username ||
      node.owner?.username ||
      node.commenter?.username ||
      node.pk_user?.username ||
      null;

    const text =
      (typeof node.text === "string" && node.text) ||
      (typeof node.comment_text === "string" && node.comment_text) ||
      (typeof node.body === "string" && node.body) ||
      null;

    if (!username || !text) return;

    const key = `${username}::${text}`;
    if (seen.has(key)) return;
    seen.add(key);

    results.push({
      source_type: "comments",
      username,
      name:
        node.user?.full_name ||
        node.owner?.full_name ||
        node.commenter?.full_name ||
        node.pk_user?.full_name ||
        "",
      profile_url: `https://www.instagram.com/${username}/`,
      is_verified:
        typeof (node.user?.is_verified ?? node.owner?.is_verified ?? node.commenter?.is_verified ?? node.pk_user?.is_verified) === "boolean"
          ? (node.user?.is_verified ?? node.owner?.is_verified ?? node.commenter?.is_verified ?? node.pk_user?.is_verified)
          : "",
      comment_text: text.trim(),
      comment_date: formatTimestamp(node.created_at ?? node.created_at_utc ?? node.timestamp ?? node.created_at_text),
      post_url: postUrl,
    });
  });

  return results;
}

function extractProfileFromNetworkPayload(payload, expectedUsername) {
  const target = normalizeText(expectedUsername);
  let best = null;

  recursiveWalk(payload, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;

    const username = normalizeText(node.username);
    if (!username || username !== target) return;

    const bio =
      node.biography ||
      node.bio ||
      node.biography_text ||
      "";

    const followerCount =
      node.edge_followed_by?.count ??
      node.followers_count ??
      node.follower_count ??
      null;

    const postsCount =
      node.edge_owner_to_timeline_media?.count ??
      node.media_count ??
      node.posts_count ??
      null;

    const externalLinks = [];
    if (Array.isArray(node.bio_links)) {
      node.bio_links.forEach((link) => {
        const url = link?.url || link?.link_url || link?.href;
        if (url) externalLinks.push(url);
      });
    }
    if (Array.isArray(node.biography_with_entities?.entities)) {
      node.biography_with_entities.entities.forEach((entity) => {
        const url = entity?.link?.url || entity?.link?.external_url;
        if (url) externalLinks.push(url);
      });
    }
    if (node.external_url) externalLinks.push(node.external_url);
    if (node.external_url_linkshimmed) externalLinks.push(node.external_url_linkshimmed);

    const candidate = {
      name: String(node.full_name || node.name || "").trim(),
      bio: String(bio || "").trim(),
      followers_count: followerCount != null ? Number(followerCount) : null,
      posts_count: postsCount != null ? Number(postsCount) : null,
      is_private: typeof node.is_private === "boolean" ? node.is_private : null,
      is_verified: typeof node.is_verified === "boolean" ? node.is_verified : null,
      is_business_account:
        typeof node.is_business_account === "boolean"
          ? node.is_business_account
          : typeof node.account_type === "number"
            ? node.account_type === 2
            : null,
      external_links: [...new Set(externalLinks.filter(Boolean))].join(" | "),
    };

    const score = [
      candidate.bio,
      candidate.followers_count,
      candidate.posts_count,
      candidate.is_private,
      candidate.is_verified,
      candidate.is_business_account,
      candidate.external_links,
    ].filter((value) => value != null && value !== "").length;

    if (!best || score > best.score) {
      best = { score, profile: candidate };
    }
  });

  return best?.profile ?? null;
}

function extractProfileListFromNetworkPayload(data) {
  const profiles = new Map();

  const processUser = (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const username = normalizeText(node.username);
    if (!username || username.length > 40 || profiles.has(username)) return;

    const bio = String(node.biography || node.bio || "").trim();
    const followerCount = node.follower_count ?? node.edge_followed_by?.count ?? null;
    const postsCount = node.media_count ?? node.edge_owner_to_timeline_media?.count ?? null;

    const externalLinks = [];
    if (node.external_url) externalLinks.push(node.external_url);
    if (Array.isArray(node.bio_links)) {
      node.bio_links.forEach((link) => {
        const url = link?.url || link?.link_url;
        if (url) externalLinks.push(url);
      });
    }

    profiles.set(username, {
      name: String(node.full_name || node.name || "").trim(),
      bio,
      followers_count: followerCount != null ? Number(followerCount) : null,
      posts_count: postsCount != null ? Number(postsCount) : null,
      is_private: typeof node.is_private === "boolean" ? node.is_private : null,
      is_verified: typeof node.is_verified === "boolean" ? node.is_verified : null,
      is_business_account: typeof node.is_business_account === "boolean" ? node.is_business_account : null,
      external_links: [...new Set(externalLinks.filter(Boolean))].join(" | "),
    });
  };

  // REST: { users: [...] }
  if (Array.isArray(data?.users)) {
    data.users.forEach(processUser);
  }

  // GraphQL: walk edges recursively
  const walkEdges = (obj, depth = 0) => {
    if (!obj || typeof obj !== "object" || depth > 8) return;
    if (Array.isArray(obj)) {
      obj.forEach((item) => walkEdges(item, depth + 1));
      return;
    }
    if (Array.isArray(obj.edges)) {
      obj.edges.forEach((edge) => processUser(edge?.node));
    }
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") walkEdges(val, depth + 1);
    }
  };
  walkEdges(data);

  return profiles;
}

function dedupeLeadsByUsername(leads) {
  const seen = new Set();
  const results = [];

  for (const lead of leads) {
    const username = normalizeText(lead.username);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    results.push(lead);
  }

  return results;
}

function matchesAnyKeyword(text, keywords) {
  const haystack = normalizeText(text);
  if (!keywords.length) return true;
  return keywords.some((keyword) => haystack.includes(keyword));
}

function matchesNoKeyword(text, keywords) {
  const haystack = normalizeText(text);
  return !keywords.some((keyword) => haystack.includes(keyword));
}

function passesLeadFilters(lead, filters, includeBio = false) {
  const commentText = (lead.comment_text || "").trim();
  const username = (lead.username || "").trim();
  const name = (lead.name || "").trim();
  const bioText = includeBio ? (lead.bio || "").trim() : "";
  const searchable = filters.sourceType === "comments"
    ? includeBio ? `${commentText}\n${bioText}` : commentText
    : [username, name, bioText].filter(Boolean).join("\n");

  if (filters.sourceType === "comments" && commentText.length < filters.minimumCommentLength) {
    return false;
  }

  if (!matchesNoKeyword(searchable, filters.excludeKeywords)) {
    return false;
  }

  if (!filters.includeKeywords.length) {
    return true;
  }

  return matchesAnyKeyword(searchable, filters.includeKeywords);
}

function createCsvContent(rows) {
  const headers = [
    "source_type",
    "username",
    "name",
    "profile_url",
    "is_verified",
    "comment_text",
    "comment_date",
    "bio",
    "followers_count",
    "posts_count",
    "is_private",
    "is_business_account",
    "external_links",
    "post_url",
  ];

  const escapeCell = (value) => {
    const stringValue = String(value ?? "");
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, "\"\"")}"`;
    }
    return stringValue;
  };

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\n");
}

function createCsvDownloadUrl(csv) {
  return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
}

function sanitizeFilenamePart(value, fallback = "instagram") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return normalized || fallback;
}

function getScrapeTargetLabel(scrapeJob) {
  const sourceType = scrapeJob?.sourceType || "comments";
  const targetUrl = String(scrapeJob?.postUrl || "");

  if (!targetUrl) return "instagram";

  try {
    const parsed = new URL(targetUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);

    if (sourceType === "comments") {
      return sanitizeFilenamePart(segments[1] || segments[0] || "post", "post");
    }

    return sanitizeFilenamePart(segments[0] || "profile", "profile");
  } catch {
    return sanitizeFilenamePart(targetUrl, "instagram");
  }
}

function buildScrapeCsvFilename({ scrapeJob, scrapeResults }) {
  const targetLabel = getScrapeTargetLabel(scrapeJob);
  const sourceLabel = sanitizeFilenamePart(scrapeJob?.sourceType || "comments", "comments");
  const rowCount = Array.isArray(scrapeResults) ? scrapeResults.length : 0;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  return `${targetLabel}-${sourceLabel}-${rowCount}-rows-${timestamp}.csv`;
}

async function downloadScrapeCsv({ scrapeJob, scrapeResults, saveAs = true, allowEmpty = false } = {}) {
  const rows = Array.isArray(scrapeResults) ? scrapeResults : [];
  if (!allowEmpty && !rows.length) {
    throw new Error("No scrape results available yet.");
  }

  const csv = createCsvContent(rows);
  const url = createCsvDownloadUrl(csv);
  const filename = buildScrapeCsvFilename({ scrapeJob, scrapeResults: rows });

  await chrome.downloads.download({
    url,
    filename,
    saveAs,
  });

  return filename;
}

async function openTabAndWait(url, active = false) {
  const tab = await chrome.tabs.create({ url, active });
  if (!tab.id) throw new Error("Chrome did not return a tab id.");
  await waitForTabLoad(tab.id);
  await delay(1500);
  return tab;
}

async function drivePostPageForComments(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const isScrollable = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        return /(auto|scroll)/i.test(style.overflowY || "") && element.scrollHeight > element.clientHeight + 120;
      };

      const clickMatchingButton = (tokens) => {
        const candidates = Array.from(document.querySelectorAll("button, div[role='button'], a[role='button']"));
        const button = candidates.find((candidate) => {
          const label = normalize(candidate.textContent || candidate.getAttribute("aria-label") || candidate.getAttribute("title"));
          return isVisible(candidate) && tokens.some((token) => label.includes(token));
        });
        if (button) button.click();
        return Boolean(button);
      };

      const findCommentsScroller = () => {
        const permalink = document.querySelector("a[href*='/p/'][href*='/c/']");
        if (permalink) {
          let current = permalink.parentElement;
          while (current) {
            if (isScrollable(current)) return current;
            current = current.parentElement;
          }
        }

        return Array.from(document.querySelectorAll("div, section, main, article")).find(isScrollable) || document.scrollingElement || document.documentElement;
      };

      window.scrollTo({ top: 0, behavior: "instant" });
      await delay(900);

      const scroller = findCommentsScroller();

      for (let index = 0; index < 18; index += 1) {
        clickMatchingButton([
          "more comments",
          "voir plus de commentaires",
          "view all comments",
          "load more comments",
          "load more",
          "plus de commentaires",
        ]);
        if (scroller instanceof HTMLElement) {
          scroller.scrollTop = scroller.scrollHeight;
        } else {
          window.scrollBy({ top: 900, behavior: "instant" });
        }
        await delay(1200);
      }

      window.scrollTo({ top: 0, behavior: "instant" });
    },
  });
}

async function fallbackCollectCommentsFromDom(tabId, postUrl) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [postUrl],
    func: (currentPostUrl) => {
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const isControlText = (value) => /^(reply|repondre|répondre|view translation|voir la traduction|like|j'aime|j’aime|verified|verifie|vérifié)$/i.test(value);
      const isRelativeDate = (value) => /^\d+\s*(s|sec|min|h|d|j|w|sem|sem\.|wk|mo)$/i.test(value);
      const items = [];
      const seenPermalinks = new Set();
      const permalinkLinks = Array.from(document.querySelectorAll("a[href*='/p/'][href*='/c/']"));

      permalinkLinks.forEach((permalinkLink) => {
        const permalink = permalinkLink.href;
        if (!permalink || seenPermalinks.has(permalink)) return;

        let row = permalinkLink;
        for (let i = 0; i < 4; i++) row = row?.parentElement;
        if (!row) return;

        const profileLink = Array.from(
          row.querySelectorAll("a[href^='/'], a[href^='https://www.instagram.com/']")
        ).find((candidate) => {
          const href = candidate.getAttribute("href") || "";
          if (!href) return false;
          if (href.includes("/p/") || href.includes("/reel/") || href.includes("/explore/") || href.includes("/stories/") || href.includes("/c/")) {
            return false;
          }
          return true;
        });

        if (!profileLink) return;

        const username = normalize((profileLink.getAttribute("href") || "").split("/").filter(Boolean)[0]);
        if (!username || username.length > 40) return;
        const usernameLower = username.toLowerCase();
        const rowText = normalize(row.textContent);

        const isVerified = !!(
          row.querySelector("svg title") &&
          Array.from(row.querySelectorAll("svg title")).some((t) => /vérifié|verified/i.test(t.textContent))
        ) || !!row.querySelector("[aria-label=\"Vérifié\"], [aria-label=\"Verified\"]");

        const baseCandidates = Array.from(row.querySelectorAll("span, h3"))
          .map((element) => normalize(element.textContent))
          .filter(Boolean)
          .filter((text) => text.toLowerCase() !== usernameLower)
          .filter((text) => text !== normalize(permalinkLink.textContent))
          .filter((text) => !isControlText(text))
          .filter((text) => !isRelativeDate(text))
          .filter((text) => !/(?:\d+\s+)?j[‘’]aime$/i.test(text))
          .filter((text) => !/^\d+\s+likes?$/i.test(text))
          .filter((text) => !/\b(verified|verifie|vérifié)\b/i.test(text))
          .filter((text) => !text.toLowerCase().startsWith(usernameLower));

        let commentText = baseCandidates.sort((a, b) => b.length - a.length)[0] || "";

        if (!commentText) {
          const usernameIdx = rowText.toLowerCase().indexOf(usernameLower);
          const afterUsername = usernameIdx !== -1 ? rowText.slice(usernameIdx + username.length) : rowText;
          commentText = afterUsername
            .replace(/\b(verified|verifie|vérifié)\b/gi, "")
            .replace(/\b\d+\s*(?:sem|w|d|j|min|h|wk|mo)\b/gi, "")
            .replace(/\b\d+\s+(?:j[‘’]aime|likes?)\b/gi, "")
            .replace(/\b(répondre|reply|voir la traduction|j[‘’]aime|like)\b/gi, "")
            .replace(/\s+/g, " ")
            .trim();
        }

        if (!commentText) {
          commentText = "[comment missing]";
        }

        seenPermalinks.add(permalink);

        items.push({
          source_type: "comments",
          username,
          name: "",
          profile_url: `https://www.instagram.com/${username}/`,
          is_verified: isVerified,
          comment_text: commentText,
          comment_date: normalize(permalinkLink.textContent),
          post_url: currentPostUrl,
        });
      });

      return {
        items,
        debug: {
          permalinkCount: permalinkLinks.length,
          itemCount: items.length,
          bodyTextLength: normalize(document.body?.innerText || "").length,
          pageUrl: location.href,
          pageTitle: document.title,
        },
      };
    },
  });

  if (result?.error) {
    await appendScrapeLog(`DOM collection script error: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.result ?? { items: [], debug: { permalinkCount: 0, itemCount: 0, bodyTextLength: 0 } };
}

function resolveProfileWaiter(username, profile) {
  if (!activeScrapeRuntime) return;

  const key = normalizeText(username);
  const waiter = activeScrapeRuntime.profileWaiters.get(key);
  if (!waiter) return;

  clearTimeout(waiter.timeoutId);
  activeScrapeRuntime.profileWaiters.delete(key);
  waiter.resolve(profile);
}

async function waitForProfileNetworkData(username) {
  if (!activeScrapeRuntime) return null;

  const key = normalizeText(username);
  const cached = activeScrapeRuntime.profilesByUsername.get(key);
  if (cached) return cached;

  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      if (activeScrapeRuntime) {
        activeScrapeRuntime.profileWaiters.delete(key);
      }
      resolve(null);
    }, SCRAPE_PROFILE_TIMEOUT_MS);

    activeScrapeRuntime.profileWaiters.set(key, { resolve, timeoutId });
  });
}

async function fallbackProfileFromDom(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const description = document.querySelector('meta[property="og:description"]')?.content || "";
      const counts = description.match(/([\d.,]+)\s+Followers?.*?([\d.,]+)\s+Following.*?([\d.,]+)\s+Posts?/i);
      const bioNode = Array.from(document.querySelectorAll("header section span, header section h1"))
        .find((node) => {
          const text = (node.textContent || "").trim();
          return text && !/^posts?$|^followers?$|^following$/i.test(text);
        });

      const parseCount = (raw) => {
        if (!raw) return null;
        const cleaned = raw.replace(/[^\d.,]/g, "").replace(/,/g, "");
        const value = Number(cleaned);
        return Number.isFinite(value) ? value : null;
      };

      return {
        name: (document.querySelector("header section h1")?.textContent || document.querySelector('meta[property="og:title"]')?.content || "").trim(),
        bio: (bioNode?.textContent || "").trim(),
        followers_count: parseCount(counts?.[1]),
        posts_count: parseCount(counts?.[3]),
        is_private: null,
        is_verified: null,
        is_business_account: null,
        external_links: Array.from(document.querySelectorAll("a[href^='http']")).map((link) => link.href).join(" | "),
      };
    },
  });

  return result?.result ?? null;
}

async function openProfileListModal(tabId, sourceType) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [sourceType],
    func: async (activeSourceType) => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const hrefKeyword = activeSourceType === "followers" ? "/followers/" : "/following/";
      const matchesSourceText = (label) => {
        if (activeSourceType === "followers") {
          return label.includes("followers") || label.includes("abonn") || label.includes("suiveur");
        }
        return (
          label.includes("following") ||
          label.includes("abonnement") ||
          label.includes("suivi") ||
          label.includes("followed")
        );
      };

      const findTrigger = () => {
        // Prefer href-based matching — language-independent
        const byHref = Array.from(document.querySelectorAll("a[href]")).find((a) => {
          const href = a.getAttribute("href") || "";
          return href.includes(hrefKeyword) && isVisible(a) && a.closest("header, section, main, nav") != null;
        });
        if (byHref) return byHref;

        // Fallback: text-based matching
        return Array.from(document.querySelectorAll("a, button, span[role='link'], div[role='button']")).find((candidate) => {
          const text = normalize(candidate.textContent || candidate.getAttribute("aria-label") || "");
          if (!text || !matchesSourceText(text) || !isVisible(candidate)) return false;
          return candidate.closest("header, section, main") != null;
        });
      };

      let trigger = null;
      const startedAt = Date.now();
      while (!trigger && Date.now() - startedAt < 15000) {
        trigger = findTrigger();
        if (!trigger) await delay(300);
      }

      if (!trigger) {
        return { error: `Could not find the ${activeSourceType} trigger on the profile.` };
      }

      trigger.click();

      const modalStartedAt = Date.now();
      while (Date.now() - modalStartedAt < 10000) {
        const dialog = document.querySelector("div[role='dialog'], section[role='dialog']");
        if (dialog && isVisible(dialog)) {
          return { ok: true };
        }
        await delay(250);
      }

      return { error: `The ${activeSourceType} modal did not open after clicking trigger (href=${trigger.getAttribute("href")}, text="${trigger.textContent?.trim().slice(0, 40)}").` };
    },
  });

  if (result?.error) {
    throw new Error(result.error.message ?? JSON.stringify(result.error));
  }
  if (result?.result?.error) {
    throw new Error(result.result.error);
  }
}

async function expandFollowersModalIfNeeded(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const isProfileLink = (href) => {
        const value = String(href || "");
        if (!value) return false;
        const normalizedHref = value.startsWith("/")
          ? value
          : value.replace(/^https:\/\/www\.instagram\.com/i, "");
        return /^\/?[^/?#]+\/?$/.test(normalizedHref);
      };
      const countProfileAnchors = (dialog) => {
        if (!(dialog instanceof HTMLElement)) return 0;
        return Array.from(dialog.querySelectorAll("a[href]")).filter((anchor) => {
          return isVisible(anchor) && isProfileLink(anchor.getAttribute("href") || anchor.href);
        }).length;
      };
      const findExpandTrigger = (dialog) => {
        if (!(dialog instanceof HTMLElement)) return null;

        const anchors = Array.from(dialog.querySelectorAll("a[href]"));
        const byHref = anchors.find((anchor) => {
          const href = anchor.getAttribute("href") || anchor.href || "";
          return isVisible(anchor) && href.includes("/followers/mutualFirst");
        });
        if (byHref) return byHref;

        return Array.from(dialog.querySelectorAll("a, button, span[role='link'], div[role='button']")).find((candidate) => {
          const label = normalize(candidate.textContent || candidate.getAttribute("aria-label") || "");
          return isVisible(candidate) && label.includes("all followers");
        }) || null;
      };

      const modalStartedAt = Date.now();
      let dialog = null;
      while (!dialog && Date.now() - modalStartedAt < 10000) {
        const candidate = document.querySelector("div[role='dialog'], section[role='dialog']");
        if (candidate && isVisible(candidate)) {
          dialog = candidate;
          break;
        }
        await delay(250);
      }

      if (!dialog) {
        return { error: "Followers modal is not open." };
      }

      const expandTrigger = findExpandTrigger(dialog);
      if (!expandTrigger) {
        return {
          expanded: false,
          beforeCount: countProfileAnchors(dialog),
          afterCount: countProfileAnchors(dialog),
          reason: "expand-trigger-not-found",
        };
      }

      const beforeCount = countProfileAnchors(dialog);
      const previousUrl = window.location.pathname;
      expandTrigger.click();

      const expandedStartedAt = Date.now();
      while (Date.now() - expandedStartedAt < 10000) {
        const activeDialog = document.querySelector("div[role='dialog'], section[role='dialog']");
        if (!activeDialog || !isVisible(activeDialog)) {
          await delay(250);
          continue;
        }

        const afterCount = countProfileAnchors(activeDialog);
        const currentPath = window.location.pathname;
        const expandStillVisible = findExpandTrigger(activeDialog);
        const movedToFullList = currentPath.includes("/followers/mutualFirst") && currentPath !== previousUrl;
        const listGrew = afterCount > beforeCount;

        if (movedToFullList || listGrew || !expandStillVisible) {
          await delay(800);
          return {
            expanded: true,
            beforeCount,
            afterCount: countProfileAnchors(activeDialog),
            previousPath: previousUrl,
            currentPath,
          };
        }

        await delay(250);
      }

      return {
        expanded: true,
        beforeCount,
        afterCount: countProfileAnchors(dialog),
        previousPath: previousUrl,
        currentPath: window.location.pathname,
        timedOut: true,
      };
    },
  });

  if (result?.error) {
    throw new Error(result.error.message ?? JSON.stringify(result.error));
  }
  if (result?.result?.error) {
    throw new Error(result.result.error);
  }
  return result?.result ?? { expanded: false, reason: "no-result" };
}

async function collectProfileListFromDom(tabId, sourceType, maxLeads) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    args: [sourceType, maxLeads],
    func: async (activeSourceType, limit) => {
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const isVisible = (element) => {
        if (!(element instanceof HTMLElement)) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const isProfileHref = (href) => {
        if (!href) return false;
        const value = String(href);
        if (value.startsWith("/")) {
          return !/^\/(?:p|reel|tv|stories|explore|direct)\//i.test(value);
        }
        return /^https:\/\/www\.instagram\.com\/(?!p\/|reel\/|tv\/|stories\/|explore\/|direct\/)/i.test(value);
      };
      const getUsernameFromHref = (href) => {
        const raw = String(href || "");
        if (!raw) return "";
        const normalized = raw.startsWith("/")
          ? raw
          : raw.replace(/^https:\/\/www\.instagram\.com/i, "");
        return normalized.split("/").filter(Boolean)[0] || "";
      };

      const dialog = document.querySelector("div[role='dialog'], section[role='dialog']");
      if (!dialog || !isVisible(dialog)) {
        throw new Error(`${activeSourceType} modal is not open.`);
      }

      const limitationText = normalize(dialog.innerText || "");
      const ownerOnlyListNotice =
        activeSourceType === "followers" &&
        (
          /only\s+[^\n]{0,80}\s+can see all followers/i.test(limitationText) ||
          /seul(?:\(e\))?\s+[^\n]{0,80}\s+peut voir tous les followers/i.test(limitationText)
        );
      const othersSummaryMatch = limitationText.match(
        activeSourceType === "followers"
          ? /\b(?:and|et)\s+([\d.,kmb\s]+)\s+others\b/i
          : /\b(?:and|et)\s+([\d.,kmb\s]+)\s+others\b/i
      );

      // Find the innermost scrollable container — prefer the one that already holds anchors
      const findListRoot = () => {
        const candidates = Array.from(dialog.querySelectorAll("*")).filter((el) => {
          if (!(el instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(el);
          return /(auto|scroll)/i.test(style.overflowY) && el.scrollHeight > el.clientHeight + 50;
        });
        return (
          candidates.reverse().find((el) => el.querySelector("a[href]")) ||
          candidates[0] ||
          dialog
        );
      };

      const collected = new Map();
      let idlePasses = 0;
      let lastCount = 0;

      const collectVisibleRows = () => {
        const anchors = Array.from(dialog.querySelectorAll("a[href]"))
          .filter((anchor) => isProfileHref(anchor.getAttribute("href")));

        anchors.forEach((anchor) => {
          const username = normalize(getUsernameFromHref(anchor.getAttribute("href") || anchor.href)).replace(/^@+/, "");
          if (!username || collected.has(username)) return;

          const row = anchor.closest("li, div[role='button'], button, article, div");
          const textNodes = row
            ? Array.from(row.querySelectorAll("span, div"))
                .map((node) => normalize(node.textContent))
                .filter(Boolean)
            : [];
          const name = textNodes.find((text) => text && text !== username && !/^suivre$/i.test(text) && !/^following$/i.test(text) && !/^s'abonner$/i.test(text)) || "";

          collected.set(username, {
            source_type: activeSourceType,
            username,
            name,
            profile_url: `https://www.instagram.com/${username}/`,
            comment_text: "",
            comment_date: "",
            post_url: "",
            is_verified: "",
          });
        });
      };

      // Initial collection before first scroll
      collectVisibleRows();
      await delay(800);

      for (let step = 0; step < 80; step += 1) {
        collectVisibleRows();
        if (collected.size >= limit) break;

        if (collected.size === lastCount) {
          idlePasses += 1;
        } else {
          idlePasses = 0;
          lastCount = collected.size;
        }

        if (idlePasses >= 6) break;

        const listRoot = findListRoot();
        const scrollAmount = Math.max(400, listRoot.clientHeight - 80);
        listRoot.scrollTop += scrollAmount;
        listRoot.dispatchEvent(new Event("scroll", { bubbles: true }));

        await delay(1500);
      }

      return {
        items: Array.from(collected.values()).slice(0, limit),
        debug: {
          scannedCount: collected.size,
          idlePasses,
          ownerOnlyListNotice,
          othersSummaryText: othersSummaryMatch?.[0] || "",
        },
      };
    },
  });

  if (result?.error) {
    await appendScrapeLog(`Profile list script error: ${result.error.message ?? JSON.stringify(result.error)}`);
  }
  return result?.result ?? { items: [], debug: { scannedCount: 0, idlePasses: 0 } };
}

async function enrichLead(lead, index, total) {
  ensureScrapeNotStopped();
  await setScrapeCursor({
    phase: "enriching",
    currentUsername: lead.username,
    collectedCount: activeScrapeRuntime?.collectedLeadsByUsername.size ?? 0,
    enrichedCount: index,
    totalToEnrich: total,
  });
  await appendScrapeLog(`Enriching @${lead.username} (${index + 1}/${total})…`);

  const jitter = 5000 + Math.floor(Math.random() * 3000);
  const tab = await openTabAndWait(lead.profile_url, true);
  if (!activeScrapeRuntime) throw new Error("Scrape stopped.");
  activeScrapeRuntime.profileTabId = tab.id;

  let profile = await waitForProfileNetworkData(lead.username);
  if (!profile) {
    await appendScrapeLog(`Network profile data missing for @${lead.username}; using DOM fallback.`);
    profile = await fallbackProfileFromDom(tab.id);
  }

  await chrome.tabs.remove(tab.id).catch(() => {});
  if (activeScrapeRuntime?.profileTabId === tab.id) {
    activeScrapeRuntime.profileTabId = null;
  }

  await delay(jitter);

  return {
    ...lead,
    name: profile?.name ?? lead.name ?? "",
    bio: profile?.bio ?? "",
    followers_count: profile?.followers_count ?? "",
    posts_count: profile?.posts_count ?? "",
    is_private: profile?.is_private ?? "",
    is_verified: profile?.is_verified ?? lead.is_verified ?? "",
    is_business_account: profile?.is_business_account ?? "",
    external_links: profile?.external_links ?? "",
  };
}

async function collectCommentsForScrape(postUrl) {
  const tab = await openTabAndWait(postUrl, true);
  if (!activeScrapeRuntime) throw new Error("Scrape stopped.");

  activeScrapeRuntime.postTabId = tab.id;
  await setScrapeCursor({ phase: "collecting", collectedCount: 0, enrichedCount: 0 });
  await appendScrapeLog("Post tab opened. Waiting for Instagram comment payloads…");

  await drivePostPageForComments(tab.id);
  await delay(2500);

  let domPayload = { items: [], debug: { permalinkCount: 0, itemCount: 0, bodyTextLength: 0 } };
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    domPayload = await fallbackCollectCommentsFromDom(tab.id, postUrl);
    if (domPayload.items.length > 0 || domPayload.debug.permalinkCount > 0) {
      break;
    }
    await appendScrapeLog(`DOM probe ${attempt}/8: 0 permalink found, retrying…`);
    await delay(1000);
  }

  const domLeads = domPayload.items;
  await appendScrapeLog(
    `DOM collection captured ${domLeads.length} visible commenter(s) ` +
    `(permalinks: ${domPayload.debug.permalinkCount}, bodyTextLength: ${domPayload.debug.bodyTextLength}, ` +
    `url: ${domPayload.debug.pageUrl}, title: ${domPayload.debug.pageTitle}).`
  );

  const networkLeads = Array.from(activeScrapeRuntime.collectedLeadsByUsername.values());
  if (networkLeads.length) {
    await appendScrapeLog(`Network interception captured ${networkLeads.length} commenter candidate(s).`);
  } else {
    await appendScrapeLog("No reliable network comment payload captured for this post.");
  }

  const leads = dedupeLeadsByUsername([...domLeads, ...networkLeads]);

  await chrome.tabs.remove(tab.id).catch(() => {});
  if (activeScrapeRuntime?.postTabId === tab.id) {
    activeScrapeRuntime.postTabId = null;
  }

  await setScrapeCursor({ phase: "collected", collectedCount: leads.length, enrichedCount: 0 });
  await appendScrapeLog(`Collected ${leads.length} unique commenter(s).`);
  return leads;
}

async function collectProfileListForScrape(profileUrl, sourceType, maxLeads) {
  const tab = await openTabAndWait(profileUrl, true);
  if (!activeScrapeRuntime) throw new Error("Scrape stopped.");

  activeScrapeRuntime.postTabId = tab.id;
  await setScrapeCursor({ phase: "collecting", collectedCount: 0, enrichedCount: 0 });
  await appendScrapeLog(`Profile tab opened. Opening ${sourceType} modal…`);

  await openProfileListModal(tab.id, sourceType);
  await delay(1200);

  if (sourceType === "followers") {
    await appendScrapeLog("Checking whether Instagram requires expanding the full followers list…");
    const expansionResult = await expandFollowersModalIfNeeded(tab.id);
    if (expansionResult.expanded) {
      const suffix = expansionResult.timedOut ? " (timed out while waiting for full refresh)" : "";
      await appendScrapeLog(
        `Expanded followers list${suffix}: ` +
        `${expansionResult.beforeCount ?? 0} -> ${expansionResult.afterCount ?? 0} visible profile link(s).`
      );
    } else {
      await appendScrapeLog("No extra 'all followers' action detected; scraping the visible followers list directly.");
    }
    await delay(1200);
  }

  const domPayload = await collectProfileListFromDom(tab.id, sourceType, maxLeads);
  domPayload.items.forEach((lead) => {
    const networkProfile = activeScrapeRuntime.profilesByUsername.get(normalizeText(lead.username));
    const enrichedLead = networkProfile
      ? {
          ...lead,
          post_url: profileUrl,
          name: networkProfile.name || lead.name || "",
          bio: networkProfile.bio || "",
          followers_count: networkProfile.followers_count ?? "",
          posts_count: networkProfile.posts_count ?? "",
          is_private: networkProfile.is_private ?? "",
          is_verified: networkProfile.is_verified ?? lead.is_verified ?? "",
          is_business_account: networkProfile.is_business_account ?? "",
          external_links: networkProfile.external_links || "",
        }
      : { ...lead, post_url: profileUrl };
    activeScrapeRuntime.collectedLeadsByUsername.set(normalizeText(lead.username), enrichedLead);
  });

  const networkEnrichedCount = domPayload.items.filter((l) =>
    activeScrapeRuntime.profilesByUsername.has(normalizeText(l.username))
  ).length;
  const isInstagramPreviewLimit =
    Boolean(domPayload.debug.ownerOnlyListNotice) ||
    Boolean(domPayload.debug.othersSummaryText);
  const limitationReason = domPayload.debug.ownerOnlyListNotice
    ? "Only the account owner can see the full followers list for this profile."
    : domPayload.debug.othersSummaryText
      ? `Instagram is showing a preview list (${domPayload.debug.othersSummaryText}) instead of the full ${sourceType} list.`
      : "";
  await appendScrapeLog(
    `DOM collection captured ${domPayload.items.length} visible ${sourceType} profile(s) ` +
    `(scanned: ${domPayload.debug.scannedCount}, idle passes: ${domPayload.debug.idlePasses}, network-enriched: ${networkEnrichedCount}).`
  );
  if (isInstagramPreviewLimit) {
    await appendScrapeLog(
      `Instagram limited this ${sourceType} list for the current session. ` +
      `${limitationReason} Max leads cannot override this UI restriction.`
    );
  }

  await chrome.tabs.remove(tab.id).catch(() => {});
  if (activeScrapeRuntime?.postTabId === tab.id) {
    activeScrapeRuntime.postTabId = null;
  }

  const leads = dedupeLeadsByUsername(Array.from(activeScrapeRuntime.collectedLeadsByUsername.values())).slice(0, maxLeads);
  await setScrapeCursor({
    phase: "collected",
    collectedCount: leads.length,
    enrichedCount: 0,
    warning: isInstagramPreviewLimit
      ? `Instagram limited this ${sourceType} list. ${limitationReason}`
      : "",
  });
  await appendScrapeLog(`Collected ${leads.length} unique ${sourceType} profile(s).`);
  return leads;
}

async function runScrapeJob(payload) {
  if (activeScrapeRuntime?.job && !activeScrapeRuntime.stopRequested) {
    throw new Error("A scrape is already running.");
  }

  const filters = buildScrapeFilters(payload);
  const job = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    sourceType: filters.sourceType,
    postUrl: filters.postUrl,
  };

  activeScrapeRuntime = createScrapeRuntime(job);
  await initializeScrapeState(job, filters);
  await appendScrapeLog(`Starting ${filters.sourceType} scrape job ${job.id} for ${filters.postUrl}`);

  try {
    const rawLeads = filters.sourceType === "comments"
      ? await collectCommentsForScrape(filters.postUrl)
      : await collectProfileListForScrape(filters.postUrl, filters.sourceType, filters.maxLeads);
    ensureScrapeNotStopped();

    const minLengthLeads = filters.sourceType === "comments"
      ? rawLeads.filter((lead) => (lead.comment_text || "").trim().length >= filters.minimumCommentLength)
      : rawLeads;
    if (filters.sourceType === "comments") {
      await appendScrapeLog(`${minLengthLeads.length} lead(s) remain after minimum comment length filter.`);
    }

    const finalResults = [];

    if (!filters.profileEnrichment) {
      const filtered = minLengthLeads.filter((lead) => passesLeadFilters(lead, filters, false)).slice(0, filters.maxLeads);
      filtered.forEach((lead) => {
        finalResults.push({
          ...lead,
          source_type: lead.source_type ?? filters.sourceType,
          name: lead.name ?? "",
          bio: lead.bio ?? "",
          followers_count: lead.followers_count ?? "",
          posts_count: lead.posts_count ?? "",
          is_private: lead.is_private ?? "",
          is_verified: lead.is_verified ?? "",
          is_business_account: lead.is_business_account ?? "",
          external_links: lead.external_links ?? "",
        });
      });
      await setScrapeResults(finalResults);
      await setScrapeCursor({
        phase: "filtered",
        collectedCount: rawLeads.length,
        enrichedCount: 0,
        keptCount: finalResults.length,
        totalToEnrich: 0,
      });
    } else {
      for (let index = 0; index < minLengthLeads.length; index += 1) {
        ensureScrapeNotStopped();
        const enrichedLead = await enrichLead(minLengthLeads[index], index, minLengthLeads.length);
        if (passesLeadFilters(enrichedLead, filters, true)) {
          finalResults.push({
            ...enrichedLead,
            source_type: enrichedLead.source_type ?? filters.sourceType,
          });
          await setScrapeResults(finalResults);
          await setScrapeCursor({
            phase: "enriching",
            currentUsername: enrichedLead.username,
            collectedCount: rawLeads.length,
            enrichedCount: index + 1,
            keptCount: finalResults.length,
            totalToEnrich: minLengthLeads.length,
          });
          await appendScrapeLog(`Lead kept: @${enrichedLead.username} (${finalResults.length}/${filters.maxLeads})`);
        } else {
          await setScrapeCursor({
            phase: "enriching",
            currentUsername: enrichedLead.username,
            collectedCount: rawLeads.length,
            enrichedCount: index + 1,
            keptCount: finalResults.length,
            totalToEnrich: minLengthLeads.length,
          });
          await appendScrapeLog(`Lead filtered out after enrichment: @${enrichedLead.username}`);
        }

        if (finalResults.length >= filters.maxLeads) {
          break;
        }
      }
    }

    if (!filters.profileEnrichment && finalResults.length < filters.maxLeads) {
      await appendScrapeLog(`Lead filter result: ${finalResults.length} lead(s) kept.`);
    }

    await finalizeScrapeState("done", finalResults);
    try {
      const filename = await downloadScrapeCsv({
        scrapeJob: job,
        scrapeResults: finalResults,
        saveAs: true,
        allowEmpty: true,
      });
      await appendScrapeLog(`CSV download dialog opened automatically: ${filename}`);
    } catch (downloadError) {
      await appendScrapeLog(`Automatic CSV download failed: ${downloadError.message}`);
    }
    await appendScrapeLog(`Scrape completed with ${finalResults.length} lead(s).`);
    activeScrapeRuntime = null;
  } catch (error) {
    const wasStopped = activeScrapeRuntime?.stopRequested || error.message === "Scrape stopped.";
    await cleanupActiveScrapeTabs();
    if (wasStopped) {
      await setScrapeStatus("stopped");
      await appendScrapeLog("Scrape stopped before completion.");
    } else {
      await setScrapeStatus("error");
      await setScrapeCursor({ phase: "error", error: error.message });
      await appendScrapeLog(`Scrape failed: ${error.message}`);
    }
    activeScrapeRuntime = null;
    if (!wasStopped) {
      throw error;
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SCRAPE_NETWORK_DATA") {
    (async () => {
      try {
        if (!activeScrapeRuntime) {
          sendResponse({ ok: true, ignored: true });
          return;
        }

        const tabId = sender.tab?.id;
        const isActiveTab =
          tabId != null &&
          (tabId === activeScrapeRuntime.postTabId || tabId === activeScrapeRuntime.profileTabId);

        if (!isActiveTab) {
          sendResponse({ ok: true, ignored: true });
          return;
        }

        const payload = message.payload || {};

        if (tabId === activeScrapeRuntime.postTabId && activeScrapeRuntime.job.sourceType === "comments") {
          const leads = extractCommentsFromNetworkPayload(payload.data, activeScrapeRuntime.job.postUrl);
          if (leads.length) {
            leads.forEach((lead) => {
              const key = normalizeText(lead.username);
              if (!activeScrapeRuntime.collectedLeadsByUsername.has(key)) {
                activeScrapeRuntime.collectedLeadsByUsername.set(key, lead);
              }
            });
            await setScrapeCursor({
              phase: "collecting",
              collectedCount: activeScrapeRuntime.collectedLeadsByUsername.size,
              enrichedCount: 0,
            });
          }
        }

        if (tabId === activeScrapeRuntime.postTabId &&
            (activeScrapeRuntime.job.sourceType === "followers" || activeScrapeRuntime.job.sourceType === "following")) {
          const networkProfiles = extractProfileListFromNetworkPayload(payload.data);
          networkProfiles.forEach((profile, username) => {
            if (!activeScrapeRuntime.profilesByUsername.has(username)) {
              activeScrapeRuntime.profilesByUsername.set(username, profile);
            }
          });
        }

        if (tabId === activeScrapeRuntime.profileTabId) {
          const urlMatch = String(payload.url || "").match(/users\/web_profile_info\/?\?username=([^&]+)/i);
          const expectedUsername = decodeURIComponent(urlMatch?.[1] || "");
          const profile = extractProfileFromNetworkPayload(payload.data, expectedUsername);
          if (profile && expectedUsername) {
            const key = normalizeText(expectedUsername);
            activeScrapeRuntime.profilesByUsername.set(key, profile);
            resolveProfileWaiter(expectedUsername, profile);
          }
        }

        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "START_SCRAPE") {
    try {
      buildScrapeFilters(message.payload || {});
      sendResponse({ ok: true });
      runScrapeJob(message.payload || {}).catch((error) => {
        console.error(`[IG Follow-Up][scrape] ${error.message}`);
      });
    } catch (error) {
      sendResponse({ ok: false, error: error.message });
    }
    return true;
  }

  if (message?.type === "STOP_SCRAPE") {
    (async () => {
      try {
        await stopActiveScrape("manual stop");
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  if (message?.type === "GET_SCRAPE_STATUS") {
    getScrapeState()
      .then((state) => sendResponse({ ok: true, ...state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SCRAPE_LOGS") {
    chrome.storage.local.get("scrapeLogs")
      .then(({ scrapeLogs = [] }) => sendResponse({ ok: true, logs: scrapeLogs }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "DOWNLOAD_SCRAPE_CSV") {
    (async () => {
      try {
        const { scrapeJob = null, scrapeResults = [] } = await chrome.storage.local.get(["scrapeJob", "scrapeResults"]);
        const filename = await downloadScrapeCsv({
          scrapeJob,
          scrapeResults,
          saveAs: true,
          allowEmpty: false,
        });
        sendResponse({ ok: true, filename });
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  }

  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PLATFORM_CAPABILITY") {
    const adapter = getPlatformAdapter(adapters, message.platform);
    if (!adapter) {
      sendResponse({ ok: false, error: "Unsupported platform." });
      return false;
    }
    const capability = adapter.canExecute();
    adapter.isLoggedIn().then((loggedIn) => sendResponse({
      ok: true,
      platform: adapter.platform,
      executable: capability.ok,
      reason: capability.reason,
      loggedIn,
      loginMessage: adapter.getLoginMessage(),
    }));
    return true;
  }

  if (message?.type === "START_BATCH") {
    (async () => {
      try {
        const rows = message.payload?.rows ?? [];
        const batchValidationError = validateBatchRows(rows);
        if (batchValidationError) throw new Error(batchValidationError);
        const adapter = getPlatformAdapter(adapters, rows[0].platform);
        if (!adapter) throw new Error("Unsupported platform.");
        const itemValidationError = rows
          .map((row) => adapter.validateItem(row))
          .find(Boolean);
        if (itemValidationError) throw new Error(itemValidationError);
        const capability = adapter.canExecute();
        if (!capability.ok) throw new Error(capability.reason ?? "Platform sending is unavailable.");

        const delaySeconds = message.payload?.delaySeconds ?? 400;
        await chrome.alarms.clear("COLD_DM_BATCH_NEXT");
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
        await chrome.alarms.clear("COLD_DM_BATCH_NEXT");
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

  return false;
});

// Open the side panel when the toolbar icon is clicked (Cold DM — Sender UI).
chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
