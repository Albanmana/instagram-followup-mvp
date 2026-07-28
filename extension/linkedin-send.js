export function isLinkedInProfileUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "") === "linkedin.com"
      && /^\/in\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isLinkedInComposeHref(value) {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    return url.pathname === "/messaging/compose/" && Boolean(url.searchParams.get("recipient"));
  } catch {
    return false;
  }
}

export function profileIdentityFromUrl(value) {
  const url = new URL(value);
  return url.pathname.replace(/\/$/, "").toLowerCase();
}

export function validateLinkedInTestPayload(payload) {
  const profileUrl = String(payload?.profileUrl ?? "").trim();
  const message = String(payload?.message ?? "").trim();
  if (!isLinkedInProfileUrl(profileUrl)) throw new Error("A canonical LinkedIn profile URL is required.");
  if (!message) throw new Error("A LinkedIn test message is required.");
  return { profileUrl, message };
}
