import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  assertLiveLinkedInOptIn,
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
