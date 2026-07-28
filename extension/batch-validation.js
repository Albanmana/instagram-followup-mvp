export function validateBatchRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "No sender actions were provided.";
  const platforms = new Set(rows.map((row) => row.platform));
  return platforms.size === 1 ? null : "A sender run must use one platform.";
}
