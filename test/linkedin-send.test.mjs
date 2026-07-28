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

test("skips compose sending when the visible recipient is not the expected profile", async () => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      if (selector === 'a[href*="/in/"]') {
        return { getAttribute: () => "/in/not-alice/" };
      }
      throw new Error(`Unexpected selector: ${selector}`);
    },
  };

  try {
    const outcome = await sendLinkedInComposeMessage(
      "https://www.linkedin.com/in/alice/",
      "Hello Alice"
    );
    assert.equal(outcome.status, "skipped");
    assert.match(outcome.reason, /recipient/i);
  } finally {
    globalThis.document = originalDocument;
  }
});
