import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueuePendingResult, flushPendingResults } from "../extension/result-outbox.js";

function memoryStorage(initialData = {}) {
  return {
    _data: { ...initialData },
    async get(key) {
      return { [key]: this._data[key] };
    },
    async set(values) {
      Object.assign(this._data, values);
    },
  };
}

function sentResult() {
  return {
    actionId: "action-sent",
    handle: "alice",
    status: "sent",
    at: "2026-07-31T10:00:00.000Z",
  };
}

function skippedResult() {
  return {
    actionId: "action-skipped",
    handle: "bob",
    status: "skipped",
    reason: "Not connected",
    at: "2026-07-31T10:01:00.000Z",
  };
}

function failedResult() {
  return {
    actionId: "action-failed",
    handle: "carol",
    status: "failed",
    reason: "Could not send",
    at: "2026-07-31T10:02:00.000Z",
  };
}

test("persists a terminal result before its first delivery attempt", async () => {
  const storage = memoryStorage();
  const result = sentResult();

  await enqueuePendingResult(storage, result);

  assert.deepEqual(storage._data.pendingResultReports, [result]);
});

test("removes pending results only after successful delivery", async () => {
  const storage = memoryStorage({ pendingResultReports: [sentResult()] });

  const outcome = await flushPendingResults({
    storage,
    reportResults: async () => ({ ok: true }),
  });

  assert.deepEqual(outcome, { ok: true, remaining: [] });
  assert.deepEqual(storage._data.pendingResultReports, []);
});

test("retains pending results after a delivery failure", async () => {
  const result = skippedResult();
  const storage = memoryStorage({ pendingResultReports: [result] });

  const outcome = await flushPendingResults({
    storage,
    reportResults: async () => ({ ok: false, error: "Temporary failure" }),
  });

  assert.equal(outcome.ok, false);
  assert.deepEqual(storage._data.pendingResultReports, [result]);
});

test("deduplicates a result by actionId and timestamp", async () => {
  const storage = memoryStorage();
  const result = failedResult();

  await enqueuePendingResult(storage, result);
  await enqueuePendingResult(storage, result);

  assert.deepEqual(storage._data.pendingResultReports, [result]);
});
