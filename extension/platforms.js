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

export function recipientLabel(item) {
  if (item.platform === "linkedin") return item.recipient.displayName || item.recipient.handle || item.recipient.profileUrl;
  return item.recipient.handle ? `@${item.recipient.handle.replace(/^@+/, "")}` : item.recipient.displayName || item.recipient.profileUrl;
}
