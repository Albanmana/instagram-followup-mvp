import { test } from "node:test";
import assert from "node:assert/strict";
import * as resultOutbox from "../extension/result-outbox.js";

const { enqueuePendingResult, flushPendingResults } = resultOutbox;

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

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function memoryAlarms({ rejectCreateCalls = [], rejectClearCalls = [] } = {}) {
  return {
    active: new Set(),
    createCalls: [],
    clearCalls: [],
    async create(name, options) {
      this.createCalls.push({ name, options });
      if (rejectCreateCalls.includes(this.createCalls.length)) {
        throw new Error("alarm create failed");
      }
      this.active.add(name);
    },
    async clear(name) {
      this.clearCalls.push(name);
      if (rejectClearCalls.includes(this.clearCalls.length)) {
        throw new Error("alarm clear failed");
      }
      this.active.delete(name);
      return true;
    },
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

test("retains a result enqueued while a successful flush is in flight", async () => {
  const delivered = sentResult();
  const enqueuedDuringFlush = skippedResult();
  const storage = memoryStorage({ pendingResultReports: [delivered] });
  const delivery = deferred();

  const flush = flushPendingResults({
    storage,
    reportResults: async () => delivery.promise,
  });
  await Promise.resolve();
  await enqueuePendingResult(storage, enqueuedDuringFlush);
  delivery.resolve({ ok: true });

  assert.deepEqual(await flush, { ok: true, remaining: [] });
  assert.deepEqual(storage._data.pendingResultReports, [enqueuedDuringFlush]);
});

test("returns a failure outcome when delivery rejects and retains the queue", async () => {
  const result = failedResult();
  const storage = memoryStorage({ pendingResultReports: [result] });

  const outcome = await flushPendingResults({
    storage,
    reportResults: async () => {
      throw new Error("offline");
    },
  });

  assert.deepEqual(outcome, {
    ok: false,
    remaining: [result],
    error: "offline",
  });
  assert.deepEqual(storage._data.pendingResultReports, [result]);
});

test("a stale successful flush cannot clear recovery for a newer failed result", async () => {
  assert.equal(typeof resultOutbox.createResultReportCoordinator, "function");

  const first = sentResult();
  const second = skippedResult();
  const storage = memoryStorage({ pendingResultReports: [first] });
  const alarms = memoryAlarms();
  const firstDelivery = deferred();
  const firstDeliveryStarted = deferred();
  const deliveries = [];
  const coordinator = resultOutbox.createResultReportCoordinator({
    storage,
    alarms,
    alarmName: "COLD_DM_RESULT_REPORT_RETRY",
    reportResults: async (results) => {
      deliveries.push(results);
      if (deliveries.length === 1) {
        firstDeliveryStarted.resolve();
        return firstDelivery.promise;
      }
      return { ok: false, error: "offline" };
    },
  });

  const olderFlush = coordinator.flush();
  await firstDeliveryStarted.promise;
  await coordinator.enqueue(second);
  const newerFlush = coordinator.flush();
  firstDelivery.resolve({ ok: true });

  assert.equal((await olderFlush).ok, true);
  assert.equal((await newerFlush).ok, false);
  assert.deepEqual(deliveries, [[first], [second]]);
  assert.deepEqual(storage._data.pendingResultReports, [second]);
  assert.equal(alarms.active.has("COLD_DM_RESULT_REPORT_RETRY"), true);
});

test("reschedules retry when storage rejects after a successful delivery", async () => {
  assert.equal(typeof resultOutbox.createResultReportCoordinator, "function");

  const storage = memoryStorage({ pendingResultReports: [failedResult()] });
  const originalGet = storage.get.bind(storage);
  let reads = 0;
  storage.get = async (key) => {
    reads += 1;
    if (reads === 3) throw new Error("storage unavailable");
    return originalGet(key);
  };
  const alarms = memoryAlarms();
  const coordinator = resultOutbox.createResultReportCoordinator({
    storage,
    alarms,
    alarmName: "COLD_DM_RESULT_REPORT_RETRY",
    reportResults: async () => ({ ok: true }),
  });

  const outcome = await coordinator.flush();

  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /storage unavailable/);
  assert.equal(alarms.active.has("COLD_DM_RESULT_REPORT_RETRY"), true);
});

test("retries a rejected alarm create while retaining a failed delivery", async () => {
  assert.equal(typeof resultOutbox.createResultReportCoordinator, "function");

  const result = failedResult();
  const storage = memoryStorage({ pendingResultReports: [result] });
  const alarms = memoryAlarms({ rejectCreateCalls: [1] });
  const coordinator = resultOutbox.createResultReportCoordinator({
    storage,
    alarms,
    alarmName: "COLD_DM_RESULT_REPORT_RETRY",
    reportResults: async () => ({ ok: false, error: "offline" }),
  });

  const outcome = await coordinator.flush();

  assert.equal(outcome.ok, false);
  assert.equal(alarms.createCalls.length, 2);
  assert.equal(alarms.active.has("COLD_DM_RESULT_REPORT_RETRY"), true);
  assert.deepEqual(storage._data.pendingResultReports, [result]);
});

test("reschedules retry when clearing the alarm rejects", async () => {
  const storage = memoryStorage({ pendingResultReports: [sentResult()] });
  const alarms = memoryAlarms({ rejectClearCalls: [1] });
  const coordinator = resultOutbox.createResultReportCoordinator({
    storage,
    alarms,
    alarmName: "COLD_DM_RESULT_REPORT_RETRY",
    reportResults: async () => ({ ok: true }),
  });

  const outcome = await coordinator.flush();

  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /alarm clear failed/);
  assert.equal(alarms.active.has("COLD_DM_RESULT_REPORT_RETRY"), true);
});

test("does not own recovery until the new result is durably persisted", async () => {
  const result = sentResult();
  const storage = memoryStorage();
  const persisted = deferred();
  const originalSet = storage.set.bind(storage);
  storage.set = async (values) => {
    await persisted.promise;
    return originalSet(values);
  };
  const alarms = memoryAlarms();
  const coordinator = resultOutbox.createResultReportCoordinator({
    storage,
    alarms,
    alarmName: "COLD_DM_RESULT_REPORT_RETRY",
    reportResults: async () => ({ ok: true }),
  });

  const enqueue = coordinator.enqueue(result);
  await Promise.resolve();

  assert.equal(alarms.createCalls.length, 0);
  persisted.resolve();
  await enqueue;
  assert.deepEqual(storage._data.pendingResultReports, [result]);
  assert.equal(alarms.active.has("COLD_DM_RESULT_REPORT_RETRY"), true);
});
