export const PENDING_RESULT_REPORTS_KEY = "pendingResultReports";

const sameResult = (left, right) =>
  left.actionId === right.actionId && left.at === right.at;

export async function enqueuePendingResult(storage, result) {
  const { [PENDING_RESULT_REPORTS_KEY]: pending = [] } =
    await storage.get(PENDING_RESULT_REPORTS_KEY);
  const next = pending.some((item) => sameResult(item, result))
    ? pending
    : [...pending, result];
  await storage.set({ [PENDING_RESULT_REPORTS_KEY]: next });
  return next;
}

export async function flushPendingResults({ storage, reportResults }) {
  const { [PENDING_RESULT_REPORTS_KEY]: pending = [] } =
    await storage.get(PENDING_RESULT_REPORTS_KEY);
  if (!pending.length) return { ok: true, remaining: [] };

  const response = await reportResults(pending);
  if (!response?.ok) {
    return {
      ok: false,
      remaining: pending,
      error: response?.error ?? "Could not report results",
    };
  }

  await storage.set({ [PENDING_RESULT_REPORTS_KEY]: [] });
  return { ok: true, remaining: [] };
}
