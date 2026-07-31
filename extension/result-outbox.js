export const PENDING_RESULT_REPORTS_KEY = "pendingResultReports";

const sameResult = (left, right) =>
  left.actionId === right.actionId && left.at === right.at;

const storageOperations = new WeakMap();

function withStorageLock(storage, operation) {
  const previous = storageOperations.get(storage) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(operation);
  storageOperations.set(storage, next);
  return next.finally(() => {
    if (storageOperations.get(storage) === next) {
      storageOperations.delete(storage);
    }
  });
}

export async function enqueuePendingResult(storage, result) {
  return withStorageLock(storage, async () => {
    const { [PENDING_RESULT_REPORTS_KEY]: pending = [] } =
      await storage.get(PENDING_RESULT_REPORTS_KEY);
    const next = pending.some((item) => sameResult(item, result))
      ? pending
      : [...pending, result];
    await storage.set({ [PENDING_RESULT_REPORTS_KEY]: next });
    return next;
  });
}

export async function flushPendingResults({ storage, reportResults }) {
  const pending = await withStorageLock(storage, async () => {
    const { [PENDING_RESULT_REPORTS_KEY]: stored = [] } =
      await storage.get(PENDING_RESULT_REPORTS_KEY);
    return stored;
  });
  if (!pending.length) return { ok: true, remaining: [] };

  let response;
  try {
    response = await reportResults(pending);
  } catch (error) {
    return {
      ok: false,
      remaining: pending,
      error: error instanceof Error && error.message
        ? error.message
        : "Could not report results",
    };
  }
  if (!response?.ok) {
    return {
      ok: false,
      remaining: pending,
      error: response?.error ?? "Could not report results",
    };
  }

  await withStorageLock(storage, async () => {
    const { [PENDING_RESULT_REPORTS_KEY]: current = [] } =
      await storage.get(PENDING_RESULT_REPORTS_KEY);
    const remaining = current.filter(
      (item) => !pending.some((reported) => sameResult(item, reported)),
    );
    await storage.set({ [PENDING_RESULT_REPORTS_KEY]: remaining });
  });
  return { ok: true, remaining: [] };
}

export function createResultReportCoordinator({
  storage,
  reportResults,
  alarms,
  alarmName,
  retryDelayInMinutes = 1,
}) {
  let alarmGeneration = 0;
  let flushTail = Promise.resolve();

  async function createRetryAlarm() {
    alarmGeneration += 1;
    await alarms.create(alarmName, { delayInMinutes: retryDelayInMinutes });
  }

  async function scheduleRetry() {
    try {
      await createRetryAlarm();
    } catch {
      await createRetryAlarm();
    }
  }

  async function enqueue(result) {
    await enqueuePendingResult(storage, result);
    void scheduleRetry().catch(() => undefined);
  }

  async function coordinatedFlush() {
    const startingAlarmGeneration = alarmGeneration;

    try {
      const outcome = await flushPendingResults({ storage, reportResults });
      if (!outcome.ok) {
        await scheduleRetry();
        return outcome;
      }

      const { [PENDING_RESULT_REPORTS_KEY]: current = [] } =
        await storage.get(PENDING_RESULT_REPORTS_KEY);
      if (current.length > 0) {
        await scheduleRetry();
      } else if (alarmGeneration === startingAlarmGeneration) {
        await alarms.clear(alarmName);
      }
      return outcome;
    } catch (error) {
      await scheduleRetry();
      return {
        ok: false,
        error: error instanceof Error && error.message
          ? error.message
          : "Could not coordinate result reporting",
      };
    }
  }

  function flush() {
    const current = flushTail
      .catch(() => undefined)
      .then(coordinatedFlush);
    flushTail = current;
    return current;
  }

  return { enqueue, flush, scheduleRetry };
}
