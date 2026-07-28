function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function linkedInProfileSlug(profileUrl) {
  try {
    const url = new URL(profileUrl);
    if (
      url.protocol !== "https:"
      || url.hostname.replace(/^www\./, "") !== "linkedin.com"
    ) {
      return null;
    }
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0].toLowerCase() !== "in") return null;
    return nonEmptyString(decodeURIComponent(parts[1]));
  } catch {
    return null;
  }
}

export function createExtensionResult(log) {
  const handle = nonEmptyString(log?.recipient?.handle)
    ?? nonEmptyString(log?.handle)
    ?? (log?.platform === "linkedin"
      ? linkedInProfileSlug(log?.recipient?.profileUrl)
      : null);
  if (!handle) return null;

  const status = ["sent", "failed", "skipped"].includes(log?.status)
    ? log.status
    : "failed";
  const reason = status === "sent" ? null : nonEmptyString(log?.reason ?? log?.error);

  return {
    actionId: log.actionId,
    handle,
    status,
    ...(reason ? { reason } : {}),
    at: log.at,
  };
}
