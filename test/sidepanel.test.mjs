import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

class FakeClassList {
  constructor(element) {
    this.element = element;
    this.values = new Set();
  }

  toggle(name, force) {
    if (force === true) this.values.add(name);
    else if (force === false) this.values.delete(name);
    else if (this.values.has(name)) this.values.delete(name);
    else this.values.add(name);
    this.element.className = [...this.values].join(" ");
  }
}

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.className = "";
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList(this);
  }

  set innerHTML(_value) {
    this.children = [];
  }

  get innerHTML() {
    return "";
  }

  append(...children) {
    this.children.push(...children);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this[name] = value;
  }

  async trigger(type) {
    return this.listeners.get(type)?.({ target: this });
  }
}

function createDocument() {
  const elements = new Map();
  return {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    createElement() {
      return new FakeElement();
    },
  };
}

function queueResponse(platform) {
  return {
    campaigns: [{
      campaign: { id: "campaign-1", name: "Consultants" },
      items: [{
        actionId: "action-1",
        messageId: "message-1",
        leadId: "lead-1",
        platform,
        displayName: platform === "linkedin" ? "Alice Martin" : "Alice",
        handle: "alice",
        profileUrl: platform === "linkedin"
          ? "https://www.linkedin.com/in/alice/"
          : "https://www.instagram.com/alice/",
        message: "Hello",
        messageType: "first_dm",
      }],
    }],
  };
}

async function settle() {
  for (let index = 0; index < 8; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function withPanel({
  storage = {},
  batchStatus = { ok: true, batchStatus: "stopped", batchLogs: [] },
  testBody,
}) {
  const original = {
    chrome: globalThis.chrome,
    document: globalThis.document,
    fetch: globalThis.fetch,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };
  const data = { coldDmApiKey: "cdm_test", coldDmBaseUrl: "https://cold-dm.example", ...storage };
  const document = createDocument();
  const runtimeMessages = [];
  const requests = [];
  let currentBatchStatus = batchStatus;

  globalThis.document = document;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
        },
        async set(values) {
          Object.assign(data, values);
        },
      },
    },
    runtime: {
      async sendMessage(message) {
        runtimeMessages.push(message);
        if (message.type === "GET_BATCH_STATUS") return currentBatchStatus;
        if (message.type === "GET_PLATFORM_CAPABILITY") {
          const executable = message.platform === "instagram";
          return {
            ok: true,
            platform: message.platform,
            executable,
            reason: executable ? undefined : "LinkedIn sending is being prepared.",
            loggedIn: executable,
            loginMessage: `Log in to ${message.platform === "linkedin" ? "LinkedIn" : "Instagram"} in this browser, then resume.`,
          };
        }
        if (message.type === "START_BATCH") return { ok: true };
        if (message.type === "STOP_BATCH") return { ok: true };
        return { ok: true, logs: [] };
      },
    },
    action: {
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
    cookies: {
      async get() {
        return { value: "session" };
      },
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes("/queue/claim")) {
      return new Response(JSON.stringify({ claimed: ["action-1"], skipped: [] }), { status: 200 });
    }
    if (String(url).includes("/results")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const platform = new URL(String(url)).searchParams.get("platform");
    return new Response(JSON.stringify(queueResponse(platform)), { status: 200 });
  };

  try {
    const sidepanelUrl = pathToFileURL(new URL("../extension/sidepanel.js", import.meta.url).pathname);
    sidepanelUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
    await import(sidepanelUrl);
    await settle();
    await testBody({
      data,
      document,
      requests,
      runtimeMessages,
      setBatchStatus(value) {
        currentBatchStatus = value;
      },
    });
  } finally {
    Object.assign(globalThis, original);
  }
}

test("LinkedIn queue renders safely and Start has no sender side effects", { concurrency: false }, async () => {
  await withPanel({
    storage: { selectedPlatform: "linkedin" },
    async testBody({ document, requests, runtimeMessages }) {
      assert.equal(document.getElementById("platform-select").value, "linkedin");
      assert.equal(document.getElementById("queue-campaign").textContent, 'LinkedIn · Campaign "Consultants" · prepared by Cold DM');
      assert.equal(document.getElementById("start-button").disabled, true);
      assert.equal(document.getElementById("start-button").textContent, "Sending not available yet");
      assert.equal(document.getElementById("platform-capability").textContent, "LinkedIn sending is being prepared.");

      const recipientName = document.getElementById("recipient-list").children[0].children[1].children[0].textContent;
      assert.equal(recipientName, "Alice Martin");

      await document.getElementById("start-button").trigger("click");
      await settle();
      assert.equal(requests.some(({ url }) => url.includes("/queue/claim") || url.includes("/results")), false);
      assert.equal(runtimeMessages.some(({ type }) => type === "START_BATCH"), false);
    },
  });
});

test("invalid stored platforms fall back and selector changes persist", { concurrency: false }, async () => {
  await withPanel({
    storage: { selectedPlatform: "facebook" },
    async testBody({ data, document, requests }) {
      const selector = document.getElementById("platform-select");
      assert.equal(data.selectedPlatform, "instagram");
      assert.equal(selector.value, "instagram");
      assert.equal(requests.some(({ url }) => url.includes("platform=instagram")), true);

      selector.value = "linkedin";
      await selector.trigger("change");
      await settle();
      assert.equal(data.selectedPlatform, "linkedin");
      assert.equal(requests.some(({ url }) => url.includes("platform=linkedin")), true);
    },
  });
});

test("paused Instagram rows override and lock a stored LinkedIn selection", { concurrency: false }, async () => {
  const pausedItem = {
    actionId: "action-1",
    messageId: "message-1",
    leadId: "lead-1",
    platform: "instagram",
    recipient: {
      displayName: "Alice",
      handle: "alice",
      profileUrl: "https://www.instagram.com/alice/",
    },
    message: "Hello",
    messageType: "first_dm",
  };

  await withPanel({
    storage: { selectedPlatform: "linkedin", pausedItems: [pausedItem] },
    async testBody({ data, document, requests }) {
      assert.equal(data.selectedPlatform, "instagram");
      assert.equal(document.getElementById("platform-select").value, "instagram");
      assert.equal(document.getElementById("platform-select").disabled, true);
      assert.equal(requests.length, 0);

      await document.getElementById("stop-button").trigger("click");
      await settle();
      assert.equal(document.getElementById("platform-select").disabled, false);
      assert.equal(requests.some(({ url }) => url.includes("platform=instagram")), true);
    },
  });
});

test("Instagram result reporting keeps platform and handle but omits nested recipient", { concurrency: false }, async () => {
  const row = {
    actionId: "action-1",
    messageId: "message-1",
    leadId: "lead-1",
    platform: "instagram",
    recipient: {
      displayName: "Alice",
      handle: "alice",
      profileUrl: "https://www.instagram.com/alice/",
    },
    message: "Hello",
    messageType: "first_dm",
  };
  const log = {
    ...row,
    status: "sent",
    at: "2026-07-28T10:00:00.000Z",
  };

  await withPanel({
    storage: { selectedPlatform: "instagram" },
    batchStatus: { ok: true, batchStatus: "running", batchQueue: [row], batchIndex: 0, batchLogs: [] },
    async testBody({ document, requests, setBatchStatus }) {
      assert.equal(document.getElementById("platform-select").disabled, true);
      setBatchStatus({ ok: true, batchStatus: "stopped", batchQueue: [row], batchIndex: 1, batchLogs: [log] });
      await document.getElementById("stop-button").trigger("click");
      await settle();

      const resultRequest = requests.find(({ url }) => url.includes("/results"));
      assert.ok(resultRequest);
      const result = JSON.parse(resultRequest.options.body).results[0];
      assert.equal(result.platform, "instagram");
      assert.equal(result.handle, "alice");
      assert.equal("recipient" in result, false);
    },
  });
});
