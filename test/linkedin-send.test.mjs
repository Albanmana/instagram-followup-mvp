import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLinkedInTestPayload,
  isLinkedInProfileUrl,
  isLinkedInComposeHref,
  profileIdentityFromUrl,
  classifyLinkedInUnavailable,
  discoverLinkedInComposeHref,
  sendLinkedInComposeMessage,
} from "../extension/linkedin-send.js";
import { installLinkedInTestDebugBridge } from "../extension/linkedin-test-debug-bridge.js";

test("installs a direct service-worker debug bridge without runtime messaging", async () => {
  const target = {};
  const send = async (payload) => ({ status: "sent", payload });

  installLinkedInTestDebugBridge(target, send);

  assert.equal(typeof target.__coldDmLinkedInTest.send, "function");
  assert.deepEqual(
    await target.__coldDmLinkedInTest.send({ message: "Test" }),
    { status: "sent", payload: { message: "Test" } }
  );
});

test("accepts a canonical LinkedIn profile and non-empty message", () => {
  assert.deepEqual(validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/in/brice-biaou-32387b156/",
    message: "Test",
  }), {
    profileUrl: "https://www.linkedin.com/in/brice-biaou-32387b156/",
    message: "Test",
  });
});

test("rejects non-profile URLs and blank messages", () => {
  assert.throws(() => validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/messaging/",
    message: "Test",
  }), /LinkedIn profile URL/);
  assert.throws(() => validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/in/alice/",
    message: "   ",
  }), /message is required/);
});

test("does not classify an invalid LinkedIn test payload as sent", () => {
  assert.throws(
    () => validateLinkedInTestPayload({
      profileUrl: "https://linkedin.com/feed/",
      message: "Test",
    }),
    /profile URL/
  );
});

test("recognizes only LinkedIn compose hrefs and normalizes profile identity", () => {
  assert.equal(isLinkedInComposeHref("/messaging/compose/?recipient=abc"), true);
  assert.equal(isLinkedInComposeHref("/messaging/?recipient=abc"), false);
  assert.equal(
    isLinkedInComposeHref("https://attacker.example/messaging/compose/?recipient=abc"),
    false
  );
  assert.equal(
    profileIdentityFromUrl("https://www.linkedin.com/in/alice/?trk=foo"),
    "/in/alice"
  );
});

test("requires an unambiguous HTTPS LinkedIn profile URL", () => {
  assert.equal(isLinkedInProfileUrl("http://www.linkedin.com/in/alice/"), false);
  assert.equal(isLinkedInProfileUrl("https://attacker.example/in/alice/"), false);
  assert.equal(isLinkedInProfileUrl("https://www.linkedin.com/in/alice%2Fother/"), false);

  assert.throws(() => validateLinkedInTestPayload({
    profileUrl: "http://www.linkedin.com/in/alice/",
    message: "Test",
  }), /LinkedIn profile URL/);
  assert.throws(() => validateLinkedInTestPayload({
    profileUrl: "https://www.linkedin.com/in/alice%2Fother/",
    message: "Test",
  }), /LinkedIn profile URL/);
});

test("classifies unavailable direct messaging as skipped with an ISO timestamp", () => {
  const outcome = classifyLinkedInUnavailable("LinkedIn Message action is unavailable for this profile.");

  assert.deepEqual({ status: outcome.status, reason: outcome.reason }, {
    status: "skipped",
    reason: "LinkedIn Message action is unavailable for this profile.",
  });
  assert.ok(Number.isFinite(Date.parse(outcome.at)));
});

test("discovers only the observed Message compose link on the expected profile", () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/alice/?trk=feed" },
    querySelectorAll(selector) {
      assert.equal(selector, "a");
      return [
        {
          textContent: "Connect",
          getAttribute: () => "/messaging/compose/?recipient=other",
        },
        {
          textContent: "Message",
          getAttribute: (attribute) => attribute === "href"
            ? "/messaging/compose/?recipient=alice"
            : null,
        },
      ];
    },
  };

  try {
    assert.deepEqual(
      discoverLinkedInComposeHref("https://www.linkedin.com/in/alice/"),
      { status: "ready", composeHref: "/messaging/compose/?recipient=alice" }
    );
  } finally {
    globalThis.document = originalDocument;
  }
});

test("skips compose sending when the compose recipient chip is unavailable", async () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalDateNow = Date.now;
  let now = 0;
  Date.now = () => {
    now += 9_000;
    return now;
  };
  globalThis.document = {
    location: { href: "https://www.linkedin.com/messaging/compose/?recipient=alice" },
    querySelector(selector) {
      if (selector === 'button[aria-label^="Remove "]') {
        return null;
      }
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "Hello Alice"
    );
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /recipient/i);
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    Date.now = originalDateNow;
  }
});

function createElement({ text = "", href = null, parent = null, children = [], hidden = false } = {}) {
  const element = {
    textContent: text,
    innerText: text,
    parentElement: parent,
    children,
    hidden,
    focused: false,
    clicked: false,
    getAttribute(attribute) {
      return attribute === "href" ? href : null;
    },
    focus() {
      this.focused = true;
    },
    dispatchEvent() {},
    contains(candidate) {
      return candidate === this || this.children.some((child) => child.contains(candidate));
    },
  };
  children.forEach((child) => { child.parentElement = element; });
  return element;
}

function withComposeDom({ recipientHidden = false, recipientAvailableAfterChecks = 0, onSend = () => {} }, run) {
  const original = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    getSelection: globalThis.getSelection,
    InputEvent: globalThis.InputEvent,
  };
  const oldMessage = createElement({ text: "Hello Alice" });
  const recipient = createElement({ text: "Alice", hidden: recipientHidden });
  const composer = createElement();
  const context = createElement({ children: [recipient, oldMessage, composer] });
  const sendButton = createElement();
  let recipientChecks = 0;
  sendButton.click = () => {
    sendButton.clicked = true;
    composer.textContent = "";
    composer.innerText = "";
    onSend({ context, composer, oldMessage });
  };

  globalThis.document = {
    location: { href: "https://www.linkedin.com/messaging/compose/?recipient=alice" },
    querySelector(selector) {
      if (selector === 'button[aria-label^="Remove "]') {
        recipientChecks += 1;
        return recipientChecks > recipientAvailableAfterChecks ? recipient : null;
      }
      if (selector === '[contenteditable="true"][role="textbox"][aria-label="Write a message…"]') return composer;
      if (selector === 'button[type="submit"]:not([disabled])') return sendButton;
      throw new Error(`Unexpected selector: ${selector}`);
    },
    createRange() {
      return { selectNodeContents() {}, collapse() {} };
    },
    execCommand(command, _showUi, value) {
      assert.equal(command, "insertText");
      composer.textContent = value;
      composer.innerText = value;
      return true;
    },
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });
  globalThis.getSelection = () => ({ removeAllRanges() {}, addRange() {} });
  globalThis.InputEvent = class InputEvent {};

  return Promise.resolve(run({ context, composer, oldMessage, sendButton })).finally(() => {
    Object.assign(globalThis, original);
  });
}

test("confirms a newly rendered matching message in the active compose context", async () => {
  await withComposeDom({
    onSend({ context }) {
      context.children.push(createElement({ text: "Hello Alice", parent: context }));
    },
  }, async ({ sendButton }) => {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "Hello Alice"
    );
    assert.deepEqual(outcome, { status: "sent", sentText: "Hello Alice" });
    assert.equal(sendButton.clicked, true);
  });
});

test("waits for the LinkedIn recipient chip before deciding the compose recipient is unavailable", async () => {
  await withComposeDom({
    recipientAvailableAfterChecks: 1,
    onSend({ context }) {
      context.children.push(createElement({ text: "Hello Alice", parent: context }));
    },
  }, async () => {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "Hello Alice"
    );
    assert.equal(outcome.status, "sent");
  });
});

test("fails deterministically when only an old matching message is visible after send", async () => {
  const originalDateNow = Date.now;
  let now = 0;
  Date.now = () => {
    now += 9_000;
    return now;
  };

  try {
    await withComposeDom({}, async () => {
      const outcome = await sendLinkedInComposeMessage(
        "https://www.linkedin.com/in/alice/",
        "Hello Alice"
      );
      assert.equal(outcome.status, "failed");
      assert.match(outcome.reason, /did not confirm/i);
    });
  } finally {
    Date.now = originalDateNow;
  }
});

test("fails when React replaces an old matching message without adding one", async () => {
  const originalDateNow = Date.now;
  let now = 0;
  Date.now = () => {
    now += 9_000;
    return now;
  };

  try {
    await withComposeDom({
      onSend({ context, oldMessage }) {
        context.children.splice(
          context.children.indexOf(oldMessage),
          1,
          createElement({ text: "Hello Alice", parent: context })
        );
      },
    }, async () => {
      const outcome = await sendLinkedInComposeMessage(
        "https://www.linkedin.com/in/alice/",
        "Hello Alice"
      );
      assert.equal(outcome.status, "failed");
      assert.match(outcome.reason, /did not confirm/i);
    });
  } finally {
    Date.now = originalDateNow;
  }
});

test("skips compose sending when the expected recipient link is hidden", async () => {
  await withComposeDom({ recipientHidden: true }, async () => {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "Hello Alice"
    );
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /recipient/i);
  });
});
