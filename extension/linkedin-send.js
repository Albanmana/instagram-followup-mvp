export function isLinkedInProfileUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname.replace(/^www\./, "") === "linkedin.com"
      && /^\/in\/[^/]+\/?$/.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

export function isLinkedInComposeHref(value) {
  try {
    const url = new URL(value, "https://www.linkedin.com");
    return url.protocol === "https:"
      && url.hostname.replace(/^www\./, "") === "linkedin.com"
      && url.pathname === "/messaging/compose/"
      && Boolean(url.searchParams.get("recipient"));
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

export function classifyLinkedInUnavailable(reason) {
  return { status: "skipped", reason, at: new Date().toISOString() };
}

export function discoverLinkedInComposeHref(expectedProfileUrl) {
  const profileIdentity = (value) => {
    try {
      return new URL(value, "https://www.linkedin.com").pathname.replace(/\/$/, "").toLowerCase();
    } catch {
      return null;
    }
  };

  const expectedIdentity = profileIdentity(expectedProfileUrl);
  if (!expectedIdentity) {
    return { status: "skipped", reason: "The expected LinkedIn profile is invalid." };
  }

  if (document.location?.href && profileIdentity(document.location.href) !== expectedIdentity) {
    return { status: "skipped", reason: "The current page does not match the expected LinkedIn profile." };
  }

  const messageLink = [...document.querySelectorAll("a")].find((anchor) =>
    anchor.textContent?.trim() === "Message" &&
    anchor.getAttribute("href")?.startsWith("/messaging/compose/")
  );
  const composeHref = messageLink?.getAttribute("href");

  return composeHref
    ? { status: "ready", composeHref }
    : { status: "skipped", reason: "LinkedIn Message action is unavailable for this profile." };
}

export async function sendLinkedInComposeMessage(expectedProfileUrl, message) {
  const profileIdentity = (value) => {
    try {
      return new URL(value, "https://www.linkedin.com").pathname.replace(/\/$/, "").toLowerCase();
    } catch {
      return null;
    }
  };
  const waitFor = (find, timeoutMs = 8_000) => new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const value = find();
      if (value) return resolve(value);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(poll, 100);
    };
    poll();
  });
  const elementText = (element) => String(element?.innerText ?? element?.textContent ?? "").trim();
  const isVisible = (element) => {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };

  const expectedIdentity = profileIdentity(expectedProfileUrl);
  if (!expectedIdentity) {
    return { status: "skipped", reason: "The expected LinkedIn profile is invalid." };
  }

  const visibleProfile = document.querySelector('a[href*="/in/"]');
  if (!visibleProfile || profileIdentity(visibleProfile.getAttribute("href")) !== expectedIdentity) {
    return { status: "skipped", reason: "The compose recipient does not match the expected LinkedIn profile." };
  }

  const textToSend = String(message ?? "").trim();
  if (!textToSend) {
    return { status: "skipped", reason: "A LinkedIn test message is required." };
  }

  const composer = document.querySelector('[contenteditable="true"][role="textbox"][aria-label="Write a message…"]');
  if (!composer) {
    return { status: "skipped", reason: "LinkedIn message composer is unavailable." };
  }

  composer.focus();
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand("insertText", false, textToSend);
  if (!inserted || elementText(composer) !== textToSend) {
    composer.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: textToSend,
    }));
  }

  const sendButton = await waitFor(() => document.querySelector('button[type="submit"]:not([disabled])'));
  if (!sendButton) {
    return { status: "skipped", reason: "LinkedIn Send action is unavailable." };
  }

  sendButton.click();
  const sent = await waitFor(() => {
    const composerIsEmpty = elementText(composer) === "";
    const sentTextIsVisible = [...document.querySelectorAll("*")].some((element) =>
      element !== composer && isVisible(element) && elementText(element) === textToSend
    );
    return composerIsEmpty && sentTextIsVisible;
  });

  return sent
    ? { status: "sent", sentText: textToSend }
    : { status: "failed", reason: "LinkedIn did not confirm that the message was sent." };
}
