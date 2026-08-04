import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  assertLiveLinkedInOptIn,
  getChromiumWindowSizeArgs,
  waitForLinkedInContextClose,
} from "./linkedin-extension-fixture.mjs";

test("requires explicit opt-in for a live LinkedIn send", () => {
  assert.throws(
    () => assertLiveLinkedInOptIn({}),
    /LIVE_LINKEDIN_E2E=1/
  );
  assert.doesNotThrow(() => assertLiveLinkedInOptIn({ LIVE_LINKEDIN_E2E: "1" }));
});

test("keeps the login launcher open until its persistent context closes", async () => {
  const context = new EventEmitter();
  const closed = waitForLinkedInContextClose(context);
  context.emit("close");
  await closed;
});

test("builds a native Chromium window-size argument from a viewport", () => {
  assert.deepEqual(
    getChromiumWindowSizeArgs({ width: 1280, height: 720 }),
    ["--window-size=1280,720"]
  );
});

test("rejects malformed viewport dimensions", () => {
  assert.throws(() => getChromiumWindowSizeArgs({ width: 0, height: 720 }), /positive integers/);
  assert.throws(() => getChromiumWindowSizeArgs({ width: 1280.5, height: 720 }), /positive integers/);
});
