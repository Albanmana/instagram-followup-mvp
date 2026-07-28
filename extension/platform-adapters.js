import { isPlatform } from "./platforms.js";

function isAllowedProfileUrl(value, hostname) {
  try {
    return new URL(value).hostname.replace(/^www\./, "") === hostname;
  } catch {
    return false;
  }
}

export function createPlatformAdapters({ sendInstagramMessage, getInstagramSession }) {
  return {
    instagram: {
      platform: "instagram",
      isLoggedIn: getInstagramSession,
      getLoginMessage: () => "Log in to Instagram in this browser, then resume.",
      canExecute: () => ({ ok: true }),
      validateItem: (item) => isAllowedProfileUrl(item?.recipient?.profileUrl, "instagram.com")
        ? null
        : "Instagram profile URL is required.",
      send: sendInstagramMessage,
    },
    linkedin: {
      platform: "linkedin",
      isLoggedIn: async () => false,
      getLoginMessage: () => "Log in to LinkedIn in this browser, then resume.",
      canExecute: () => ({ ok: false, reason: "LinkedIn sending is being prepared." }),
      validateItem: (item) => isAllowedProfileUrl(item?.recipient?.profileUrl, "linkedin.com")
        ? null
        : "LinkedIn profile URL is required.",
      send: async () => ({
        status: "skipped",
        reason: "LinkedIn sending is being prepared.",
        at: new Date().toISOString(),
      }),
    },
  };
}

export function getPlatformAdapter(adapters, platform) {
  return isPlatform(platform) ? adapters[platform] ?? null : null;
}
