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

export async function discoverLinkedInComposeHref(expectedProfileUrl) {
  const profileIdentity = (value) => {
    try {
      return new URL(value, "https://www.linkedin.com").pathname.replace(/\/$/, "").toLowerCase();
    } catch {
      return null;
    }
  };
  const elementText = (element) =>
    String(
      element?.innerText
      || element?.textContent
      || element?.getAttribute?.("aria-label")
      || ""
    )
      .replace(/\s+/g, " ")
      .trim();
  const isVisible = (element) => {
    for (let current = element; current; current = current.parentElement) {
      if (current.hidden || current.getAttribute?.("aria-hidden") === "true") return false;
      const style = getComputedStyle(current);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    const rect = element?.getBoundingClientRect?.();
    return Boolean(element) && (!rect || (rect.width > 0 && rect.height > 0));
  };
  const composeRecipient = (href) => {
    try {
      const url = new URL(href, "https://www.linkedin.com");
      if (
        url.protocol !== "https:"
        || url.hostname.replace(/^www\./, "") !== "linkedin.com"
        || url.pathname !== "/messaging/compose/"
      ) {
        return null;
      }
      return url.searchParams.get("recipient")?.trim() || null;
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

  const inspect = () => {
    const main = document.querySelector("main");
    if (!main || !isVisible(main)) {
      return { status: "skipped", reason: "The visible target LinkedIn profile actions could not be identified." };
    }

    const sections = [...(main.querySelectorAll?.("section") ?? [])];
    const legacySection = main.querySelector?.("h1")?.closest?.("section");
    if (legacySection && !sections.includes(legacySection)) sections.push(legacySection);
    if (sections.length === 0) {
      return { status: "skipped", reason: "The visible target LinkedIn profile actions could not be identified." };
    }

    const candidates = sections.filter(isVisible).map((section) => {
      const observed = [...(section.querySelectorAll?.("[aria-label], a, button, p, span") ?? [])]
        .filter(isVisible);
      const labels = observed.map(elementText);
      const hasBlockedPath = labels.some((label) => /\b(?:inmail|open profile)\b/i.test(label));
      const isDirectConnection = labels.some((label) =>
        /\b1st\b/i.test(label) || /\b1st degree connection\b/i.test(label)
      );
      const composeLinks = observed
        .filter((element) => elementText(element) === "Message")
        .map((element) => ({
          composeHref: element.getAttribute?.("href"),
          recipientId: composeRecipient(element.getAttribute?.("href")),
        }))
        .filter(({ composeHref, recipientId }) => composeHref && recipientId);

      return { hasBlockedPath, isDirectConnection, composeLinks };
    });

    const directCandidates = candidates.filter(({ hasBlockedPath, isDirectConnection, composeLinks }) =>
      !hasBlockedPath && isDirectConnection && composeLinks.length === 1
    );
    if (directCandidates.length === 1) {
      return { status: "ready", ...directCandidates[0].composeLinks[0] };
    }
    if (candidates.some(({ hasBlockedPath, composeLinks }) => hasBlockedPath && composeLinks.length > 0)) {
      return { status: "skipped", reason: "LinkedIn does not prove a direct connection for this message path." };
    }
    if (candidates.some(({ isDirectConnection, composeLinks }) => !isDirectConnection && composeLinks.length > 0)) {
      return { status: "skipped", reason: "LinkedIn does not prove a direct connection for this profile." };
    }
    return { status: "skipped", reason: "A single direct Message action is unavailable for this profile." };
  };

  const deadline = Date.now() + 8_000;
  let outcome = inspect();
  while (
    outcome.reason === "The visible target LinkedIn profile actions could not be identified."
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    outcome = inspect();
  }
  return outcome;
}

export async function sendLinkedInComposeMessage(expectedProfileUrl, expectedRecipientId, message) {
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
  const visibleElements = (root, selector) =>
    [...(root?.querySelectorAll?.(selector) ?? [])].filter(isVisible);
  const activeConversation = (recipient) => {
    for (let candidate = recipient?.parentElement; candidate && candidate !== document.body; candidate = candidate.parentElement) {
      const composers = visibleElements(
        candidate,
        '[contenteditable="true"][role="textbox"][aria-label="Write a message…"]'
      );
      if (composers.length === 1) {
        return { root: candidate, composer: composers[0] };
      }
    }
    return null;
  };
  const visibleMatchingElements = (root, text) => {
    const matches = [];
    const visit = (element) => {
      if (!element) return;
      if (element !== root && isVisible(element) && elementText(element) === text) matches.push(element);
      for (const child of element.children ?? []) visit(child);
    };
    visit(root);
    return matches;
  };

  const expectedIdentity = profileIdentity(expectedProfileUrl);
  if (!expectedIdentity) {
    return { status: "skipped", reason: "The expected LinkedIn profile is invalid." };
  }

  const composeUrl = new URL(document.location.href, "https://www.linkedin.com");
  const recipientId = composeUrl.pathname === "/messaging/compose/"
    ? composeUrl.searchParams.get("recipient")
    : null;
  if (!expectedRecipientId || recipientId !== expectedRecipientId) {
    return { status: "skipped", reason: "The compose recipient does not match the expected LinkedIn profile." };
  }

  const conversation = await waitFor(() => {
    const recipientChips = visibleElements(document, 'button[aria-label^="Remove "]');
    if (recipientChips.length !== 1) return null;
    return activeConversation(recipientChips[0]);
  });
  if (!conversation) {
    return { status: "skipped", reason: "The compose recipient does not match the expected LinkedIn profile." };
  }

  const textToSend = String(message ?? "").trim();
  if (!textToSend) {
    return { status: "skipped", reason: "A LinkedIn test message is required." };
  }

  const { root: conversationRoot, composer } = conversation;
  const visibleMessageCountBeforeSend = visibleMatchingElements(conversationRoot, textToSend).length;

  composer.focus();
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(composer);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand("insertText", false, textToSend);
  if (inserted) {
    composer.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: textToSend,
    }));
  }
  if (!inserted || elementText(composer) !== textToSend) {
    return { status: "failed", reason: "LinkedIn could not establish the exact queued message in the composer." };
  }

  const sendButton = await waitFor(() => {
    const candidates = visibleElements(conversationRoot, 'button[type="submit"]:not([disabled])');
    return candidates.length === 1 ? candidates[0] : null;
  });
  if (!sendButton) {
    return { status: "skipped", reason: "LinkedIn Send action is unavailable." };
  }

  sendButton.click();
  const sent = await waitFor(() => {
    const composerIsEmpty = elementText(composer) === "";
    const visibleMessageCountAfterSend = visibleMatchingElements(conversationRoot, textToSend).length;
    return composerIsEmpty && visibleMessageCountAfterSend > visibleMessageCountBeforeSend;
  });

  return sent
    ? { status: "sent", sentText: textToSend }
    : { status: "failed", reason: "LinkedIn did not confirm that the message was sent." };
}
