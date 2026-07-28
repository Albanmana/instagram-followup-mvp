import { isPlatform } from "./platforms.js";

function isAllowedProfileUrl(value, hostname) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") === hostname;
  } catch {
    return false;
  }
}

function instagramDestinationHandle(item) {
  const suppliedHandle = item?.recipient?.handle;
  if (typeof suppliedHandle !== "string" || !suppliedHandle.trim()) return null;

  try {
    const url = new URL(item?.recipient?.profileUrl);
    if (url.hostname.replace(/^www\./, "") !== "instagram.com") return null;
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (pathParts.length !== 1) return null;
    const profileHandle = decodeURIComponent(pathParts[0]);
    const normalizedSuppliedHandle = suppliedHandle.trim().replace(/^@+/, "");
    if (!profileHandle || profileHandle.toLowerCase() !== normalizedSuppliedHandle.toLowerCase()) return null;
    return profileHandle;
  } catch {
    return null;
  }
}

export function createPlatformAdapters({
  sendInstagramMessage,
  getInstagramSession,
  sendLinkedInMessage,
  getLinkedInSession,
}) {
  return {
    instagram: {
      platform: "instagram",
      isLoggedIn: getInstagramSession,
      getLoginMessage: () => "Log in to Instagram in this browser, then resume.",
      canExecute: () => ({ ok: true }),
      validateItem: (item) => instagramDestinationHandle(item)
        ? null
        : "Instagram profile URL and handle must match.",
      send: (item) => {
        const handle = instagramDestinationHandle(item);
        if (!handle) throw new Error("Instagram profile URL and handle must match.");
        return sendInstagramMessage({
          ...item,
          handle,
          recipient: {
            ...item.recipient,
            handle,
          },
        });
      },
    },
    linkedin: {
      platform: "linkedin",
      isLoggedIn: getLinkedInSession,
      getLoginMessage: () => "Log in to LinkedIn in this browser, then resume.",
      canExecute: () => ({ ok: true }),
      validateItem: (item) => isAllowedProfileUrl(item?.recipient?.profileUrl, "linkedin.com")
        ? null
        : "LinkedIn profile URL is required.",
      send: sendLinkedInMessage,
    },
  };
}

export function getPlatformAdapter(adapters, platform) {
  return isPlatform(platform) ? adapters[platform] ?? null : null;
}
