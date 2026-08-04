export const PLATFORMS = ["instagram", "linkedin"];

export function isPlatform(value) {
  return PLATFORMS.includes(value);
}

export function platformLabel(platform) {
  return platform === "linkedin" ? "LinkedIn" : "Instagram";
}

export function legacyInstagramProfileUrl(handle) {
  return `https://www.instagram.com/${encodeURIComponent(handle.replace(/^@+/, ""))}/`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canonicalInstagramRecipient(target) {
  const value = nonEmptyString(target);
  if (!value) return null;

  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        !["http:", "https:"].includes(url.protocol)
        || url.hostname.replace(/^www\./, "").toLowerCase() !== "instagram.com"
        || parts.length !== 1
      ) return null;
      const handle = decodeURIComponent(parts[0]);
      if (!/^[A-Za-z0-9._]+$/.test(handle)) return null;
      return { displayName: null, handle, profileUrl: legacyInstagramProfileUrl(handle) };
    } catch {
      return null;
    }
  }

  const handle = value.replace(/^@+/, "");
  if (!/^[A-Za-z0-9._]+$/.test(handle)) return null;
  return { displayName: null, handle, profileUrl: legacyInstagramProfileUrl(handle) };
}

function canonicalLinkedInRecipient(target) {
  const value = nonEmptyString(target);
  if (!value) return null;

  let slug = value.replace(/^@+/, "").replace(/^in\//i, "");
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const parts = url.pathname.split("/").filter(Boolean);
      if (
        url.protocol !== "https:"
        || url.hostname.replace(/^www\./, "").toLowerCase() !== "linkedin.com"
        || parts.length !== 2
        || parts[0].toLowerCase() !== "in"
      ) return null;
      slug = decodeURIComponent(parts[1]);
    } catch {
      return null;
    }
  }

  if (!/^[A-Za-z0-9-]+$/.test(slug)) return null;
  return {
    displayName: null,
    handle: slug,
    profileUrl: `https://www.linkedin.com/in/${encodeURIComponent(slug)}/`,
  };
}

export function createManualTestItem({ platform, target, message, id } = {}) {
  if (!isPlatform(platform)) return null;
  const text = nonEmptyString(message);
  const recipient = platform === "instagram"
    ? canonicalInstagramRecipient(target)
    : canonicalLinkedInRecipient(target);
  if (!text || !recipient) return null;

  const localId = nonEmptyString(id) ?? `manual-${crypto.randomUUID()}`;
  return {
    actionId: localId,
    messageId: localId,
    leadId: localId,
    platform,
    message: text,
    messageType: "first_dm",
    localOnly: true,
    recipient,
  };
}

export function normalizeQueueItem(raw, campaign = null) {
  const hasLegacyHandle = typeof raw?.handle === "string" && raw.handle.length > 0;
  const platform = isPlatform(raw?.platform)
    ? raw.platform
    : raw?.platform == null && hasLegacyHandle ? "instagram" : null;
  const profileUrl = raw?.recipient?.profileUrl ?? raw?.profileUrl
    ?? (platform === "instagram" && hasLegacyHandle ? legacyInstagramProfileUrl(raw.handle) : null);
  if (!platform || !profileUrl || !raw?.actionId || !raw?.messageId || !raw?.leadId || !raw?.message) return null;
  return {
    actionId: raw.actionId, messageId: raw.messageId, leadId: raw.leadId,
    campaign: raw.campaign ?? campaign,
    platform, message: raw.message,
    messageType: raw.messageType === "followup" ? "followup" : "first_dm",
    recipient: {
      displayName: raw?.recipient?.displayName ?? raw?.displayName ?? null,
      profileUrl,
      handle: raw?.recipient?.handle ?? raw?.handle ?? null,
    },
  };
}

export function normalizePersistedQueueItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (item?.platform != null || item?.recipient != null) return item;
    const normalized = normalizeQueueItem(item, item?.campaign ?? null);
    if (!normalized) return item;
    return {
      ...item,
      platform: normalized.platform,
      recipient: normalized.recipient,
    };
  });
}

export function normalizeSenderOutcome(result) {
  const status = ["sent", "skipped", "failed"].includes(result?.status)
    ? result.status
    : result?.stage === "sent"
      ? "sent"
      : "failed";
  return { ...result, status };
}

export function recipientLabel(item) {
  if (item.platform === "linkedin") return item.recipient.displayName || item.recipient.handle || item.recipient.profileUrl;
  return item.recipient.handle ? `@${item.recipient.handle.replace(/^@+/, "")}` : item.recipient.displayName || item.recipient.profileUrl;
}
