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
  const heading = {
    textContent: "Alice Martin",
    hidden: false,
    getAttribute: () => null,
  };
  const directEvidence = {
    textContent: "1st",
    hidden: false,
    getAttribute: () => null,
  };
  const messageLink = {
    textContent: "Message",
    hidden: false,
    getAttribute: (attribute) => attribute === "href"
      ? "/messaging/compose/?recipient=alice-id"
      : null,
  };
  const profileActions = {
    hidden: false,
    querySelector(selector) {
      return selector === "h1" ? heading : null;
    },
    querySelectorAll() {
      return [directEvidence, messageLink];
    },
  };
  heading.closest = () => profileActions;
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/alice/?trk=feed" },
    querySelector(selector) {
      assert.equal(selector, "main");
      return profileActions;
    },
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    assert.deepEqual(
      discoverLinkedInComposeHref("https://www.linkedin.com/in/alice/"),
      {
        status: "ready",
        composeHref: "/messaging/compose/?recipient=alice-id",
        recipientId: "alice-id",
      }
    );
  } finally {
    globalThis.document = originalDocument;
    delete globalThis.getComputedStyle;
  }
});

test("discovers the sole direct Message action when the visible profile main has no heading", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const directProfileSection = {
    hidden: false,
    querySelectorAll() {
      return [
        { textContent: "brice biaou", hidden: false, getAttribute: () => null },
        { textContent: "1st", hidden: false, getAttribute: () => null },
        {
          textContent: "Message",
          hidden: false,
          getAttribute: (attribute) => attribute === "href"
            ? "/messaging/compose/?recipient=brice-id"
            : null,
        },
      ];
    },
  };
  const recommendationSection = {
    hidden: false,
    querySelectorAll() {
      return [{
        textContent: "Message",
        hidden: false,
        getAttribute: (attribute) => attribute === "href"
          ? "/messaging/compose/?recipient=recommendation-id"
          : null,
      }];
    },
  };
  const main = {
    hidden: false,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "section"
      ? [directProfileSection, recommendationSection]
      : [],
  };
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/brice-biaou-32387b156/" },
    querySelector: (selector) => selector === "main" ? main : null,
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    assert.deepEqual(
      discoverLinkedInComposeHref("https://www.linkedin.com/in/brice-biaou-32387b156/"),
      {
        status: "ready",
        composeHref: "/messaging/compose/?recipient=brice-id",
        recipientId: "brice-id",
      }
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test("keeps a direct Message action visible through LinkedIn display contents wrappers", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const displayContentsWrapper = {
    hidden: false,
    parentElement: null,
    getAttribute: () => null,
    getBoundingClientRect: () => ({ width: 0, height: 0 }),
  };
  const directEvidence = {
    textContent: "1st",
    hidden: false,
    parentElement: displayContentsWrapper,
    getAttribute: () => null,
  };
  const messageLink = {
    textContent: "Message",
    hidden: false,
    parentElement: displayContentsWrapper,
    getAttribute: (attribute) => attribute === "href"
      ? "/messaging/compose/?recipient=brice-id"
      : null,
  };
  const profileActions = {
    hidden: false,
    parentElement: null,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "section"
      ? [profileActions]
      : [directEvidence, messageLink],
  };
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/brice-biaou-32387b156/" },
    querySelector: (selector) => selector === "main" ? profileActions : null,
  };
  globalThis.getComputedStyle = (element) => element === displayContentsWrapper
    ? { display: "contents", visibility: "visible" }
    : { display: "block", visibility: "visible" };

  try {
    assert.deepEqual(
      discoverLinkedInComposeHref("https://www.linkedin.com/in/brice-biaou-32387b156/"),
      {
        status: "ready",
        composeHref: "/messaging/compose/?recipient=brice-id",
        recipientId: "brice-id",
      }
    );
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test("ignores a direct Message candidate hidden by an ancestor", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const hiddenAncestor = {
    hidden: false,
    getAttribute: () => null,
    parentElement: null,
  };
  const hiddenProfileSection = {
    hidden: false,
    parentElement: hiddenAncestor,
    querySelectorAll() {
      return [
        { textContent: "1st", hidden: false, getAttribute: () => null },
        {
          textContent: "Message",
          hidden: false,
          getAttribute: (attribute) => attribute === "href"
            ? "/messaging/compose/?recipient=hidden-recipient"
            : null,
        },
      ];
    },
  };
  const main = {
    hidden: false,
    parentElement: null,
    querySelector: () => null,
    querySelectorAll: (selector) => selector === "section" ? [hiddenProfileSection] : [],
  };
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/alice/" },
    querySelector: (selector) => selector === "main" ? main : null,
  };
  globalThis.getComputedStyle = (element) => element === hiddenAncestor
    ? { display: "none", visibility: "visible" }
    : { display: "block", visibility: "visible" };

  try {
    const outcome = discoverLinkedInComposeHref("https://www.linkedin.com/in/alice/");
    assert.equal(outcome.status, "skipped");
    assert.notEqual(outcome.recipientId, "hidden-recipient");
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test("skips a global Message link that is outside the visible target profile actions", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const heading = { textContent: "Alice", hidden: false, getAttribute: () => null };
  const profileActions = {
    querySelector: (selector) => selector === "h1" ? heading : null,
    querySelectorAll: () => [{
      textContent: "1st",
      hidden: false,
      getAttribute: () => null,
    }],
  };
  heading.closest = () => profileActions;
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/alice/" },
    querySelector: (selector) => selector === "main" ? profileActions : null,
    querySelectorAll: () => [{
      textContent: "Message",
      getAttribute: () => "/messaging/compose/?recipient=unrelated",
    }],
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    const outcome = discoverLinkedInComposeHref("https://www.linkedin.com/in/alice/");
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /direct Message action/i);
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test("skips clear InMail or Open Profile message paths", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const makeProfileActions = (blockedLabel) => {
    const heading = { textContent: "Alice", hidden: false, getAttribute: () => null };
    const profileActions = {
      querySelector: (selector) => selector === "h1" ? heading : null,
      querySelectorAll: () => [
      { textContent: "1st", hidden: false, getAttribute: () => null },
      { textContent: blockedLabel, hidden: false, getAttribute: () => null },
      {
        textContent: "Message",
        hidden: false,
        getAttribute: (attribute) => attribute === "href"
          ? "/messaging/compose/?recipient=alice-id"
          : null,
      },
    ],
    };
    heading.closest = () => profileActions;
    return profileActions;
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    for (const blockedLabel of ["InMail", "Open Profile"]) {
      globalThis.document = {
        location: { href: "https://www.linkedin.com/in/alice/" },
        querySelector: (selector) => selector === "main"
          ? makeProfileActions(blockedLabel)
          : null,
      };
      const outcome = discoverLinkedInComposeHref("https://www.linkedin.com/in/alice/");
      assert.equal(outcome.status, "skipped");
      assert.match(outcome.reason, /direct connection/i);
    }
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }
});

test("skips when the visible profile cannot prove a first-degree connection", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const heading = { textContent: "Alice", hidden: false, getAttribute: () => null };
  const profileActions = {
    querySelector: (selector) => selector === "h1" ? heading : null,
    querySelectorAll: () => [{
      textContent: "Message",
      hidden: false,
      getAttribute: (attribute) => attribute === "href"
        ? "/messaging/compose/?recipient=alice-id"
        : null,
    }],
  };
  heading.closest = () => profileActions;
  globalThis.document = {
    location: { href: "https://www.linkedin.com/in/alice/" },
    querySelector: (selector) => selector === "main" ? profileActions : null,
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    const outcome = discoverLinkedInComposeHref("https://www.linkedin.com/in/alice/");
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /direct connection/i);
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
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
    querySelectorAll(selector) {
      if (selector === 'button[aria-label^="Remove "]') {
        return [];
      }
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };
  globalThis.getComputedStyle = () => ({ display: "block", visibility: "visible" });

  try {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "alice",
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

function withComposeDom({
  recipientHidden = false,
  recipientAvailableAfterChecks = 0,
  composerText = "",
  preserveDraftOnInsert = false,
  onSend = () => {},
}, run) {
  const original = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    getSelection: globalThis.getSelection,
    InputEvent: globalThis.InputEvent,
  };
  const oldMessage = createElement({ text: "Hello Alice" });
  const recipient = createElement({ text: "Alice", hidden: recipientHidden });
  const composer = createElement({ text: composerText });
  const sendButton = createElement();
  const context = createElement({ children: [recipient, oldMessage, composer, sendButton] });
  context.querySelectorAll = (selector) => {
    if (selector === '[contenteditable="true"][role="textbox"][aria-label="Write a message…"]') {
      return [composer];
    }
    if (selector === 'button[type="submit"]:not([disabled])') return [sendButton];
    return [];
  };
  let recipientChecks = 0;
  sendButton.click = () => {
    sendButton.clicked = true;
    composer.textContent = "";
    composer.innerText = "";
    onSend({ context, composer, oldMessage });
  };

  globalThis.document = {
    location: { href: "https://www.linkedin.com/messaging/compose/?recipient=alice" },
    body: createElement(),
    querySelectorAll(selector) {
      if (selector === 'button[aria-label^="Remove "]') {
        recipientChecks += 1;
        return recipientChecks > recipientAvailableAfterChecks ? [recipient] : [];
      }
      throw new Error(`Unexpected selector: ${selector}`);
    },
    createRange() {
      return {
        selectedContents: false,
        selectNodeContents() {
          this.selectedContents = true;
        },
        collapse() {
          this.selectedContents = false;
        },
      };
    },
    execCommand(command, _showUi, value) {
      assert.equal(command, "insertText");
      const nextValue = preserveDraftOnInsert ? `${composer.innerText}${value}` : value;
      composer.textContent = nextValue;
      composer.innerText = nextValue;
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
      "alice",
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
      "alice",
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
        "alice",
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
        "alice",
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
  const originalDateNow = Date.now;
  let now = 0;
  Date.now = () => {
    now += 9_000;
    return now;
  };
  try {
    await withComposeDom({ recipientHidden: true }, async () => {
      const outcome = await sendLinkedInComposeMessage(
        "https://www.linkedin.com/in/alice/",
        "alice",
        "Hello Alice"
      );
      assert.equal(outcome.status, "skipped");
      assert.match(outcome.reason, /recipient/i);
    });
  } finally {
    Date.now = originalDateNow;
  }
});

test("replaces a restored LinkedIn draft before sending the queued text", async () => {
  await withComposeDom({
    composerText: "Restored draft",
    onSend({ context }) {
      context.children.push(createElement({ text: "Hello Alice", parent: context }));
    },
  }, async ({ composer, sendButton }) => {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "alice",
      "Hello Alice"
    );
    assert.equal(outcome.status, "sent");
    assert.equal(composer.innerText, "");
    assert.equal(sendButton.clicked, true);
  });
});

test("does not send when the exact queued text cannot replace a restored draft", async () => {
  await withComposeDom({
    composerText: "Restored draft",
    preserveDraftOnInsert: true,
  }, async ({ sendButton }) => {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "alice",
      "Hello Alice"
    );
    assert.equal(outcome.status, "failed");
    assert.match(outcome.reason, /exact queued message/i);
    assert.equal(sendButton.clicked, false);
  });
});

test("skips when the compose route is not bound to the discovered recipient", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    location: { href: "https://www.linkedin.com/messaging/compose/?recipient=other" },
  };

  try {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "alice",
      "Hello Alice"
    );
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /recipient/i);
  } finally {
    globalThis.document = originalDocument;
  }
});

test("uses only the send action scoped to the bound compose conversation", async () => {
  await withComposeDom({
    onSend({ context }) {
      context.children.push(createElement({ text: "Hello Alice", parent: context }));
    },
  }, async ({ sendButton }) => {
    const unrelatedSendButton = createElement();
    unrelatedSendButton.click = () => {
      throw new Error("Clicked unrelated global send action");
    };
    globalThis.document.querySelector = () => unrelatedSendButton;

    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "alice",
      "Hello Alice"
    );
    assert.equal(outcome.status, "sent");
    assert.equal(sendButton.clicked, true);
  });
});
