import assert from "node:assert/strict";
import test from "node:test";

import { assertLiveLinkedInOptIn } from "./linkedin-extension-fixture.mjs";

test("requires explicit opt-in for a live LinkedIn send", () => {
  assert.throws(
    () => assertLiveLinkedInOptIn({}),
    /LIVE_LINKEDIN_E2E=1/
  );
  assert.doesNotThrow(() => assertLiveLinkedInOptIn({ LIVE_LINKEDIN_E2E: "1" }));
});
