import test from "node:test";
import assert from "node:assert/strict";
import {
  validateLinkedInTestPayload,
  isLinkedInComposeHref,
  profileIdentityFromUrl,
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
    profileIdentityFromUrl("https://www.linkedin.com/in/alice/?trk=foo"),
    "/in/alice"
  );
});
