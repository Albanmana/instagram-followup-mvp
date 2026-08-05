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

export async function discoverLinkedInDeliveryPath(expectedProfileUrl, message) {
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
  const expectedProfileTokens = expectedIdentity
    .split("/")
    .filter(Boolean)
    .at(-1)
    .split(/[-_]/)
    .filter((token) => token.length >= 3 && !/\d/.test(token));

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
      const composeLinks = observed
        .filter((element) => elementText(element) === "Message")
        .map((element) => ({
          composeHref: element.getAttribute?.("href"),
          recipientId: composeRecipient(element.getAttribute?.("href")),
        }))
        .filter(({ composeHref, recipientId }) => composeHref && recipientId);

      const connectActions = observed.filter((element) => elementText(element) === "Connect");
      const moreActions = observed.filter((element) => /^(?:more|more actions)$/i.test(elementText(element)));
      const hasConnectionEvidence = labels.some((label) =>
        /\b1st\b/i.test(label) || /\b1st degree connection\b/i.test(label)
      );
      const hasProfileEvidence = labels.some((label) => {
        const normalizedLabel = label.toLowerCase();
        return expectedProfileTokens.length > 0
          && expectedProfileTokens.every((token) => normalizedLabel.includes(token));
      });
      const hasProfileLink = observed.some((element) =>
        profileIdentity(element.getAttribute?.("href")) === expectedIdentity
      );

      return {
        isHeadingSection: section === legacySection,
        hasBlockedPath,
        composeLinks,
        connectActions,
        moreActions,
        hasProfileEvidence,
        hasProfileLink,
        hasConnectionEvidence,
      };
    });

    const directCandidates = candidates.filter(({
      isHeadingSection,
      hasBlockedPath,
      composeLinks,
      hasProfileEvidence,
      hasProfileLink,
      hasConnectionEvidence,
    }) =>
      !hasBlockedPath
      && composeLinks.length === 1
      && (isHeadingSection || hasProfileEvidence || hasProfileLink || hasConnectionEvidence)
    );
    const directComposeLinks = [...new Map(
      directCandidates
        .flatMap(({ composeLinks }) => composeLinks)
        .map((link) => [`${link.recipientId}:${link.composeHref}`, link])
    ).values()];
    if (directComposeLinks.length === 1) {
      return { status: "ready", delivery: "direct", ...directComposeLinks[0] };
    }
    if (candidates.some(({ hasBlockedPath, composeLinks }) => hasBlockedPath && composeLinks.length > 0)) {
      return { status: "skipped", reason: "LinkedIn does not offer a normal Message route for this profile." };
    }
    const targetCandidates = candidates.filter(({
      isHeadingSection,
      hasProfileEvidence,
      hasProfileLink,
      hasConnectionEvidence,
    }) => isHeadingSection || hasProfileEvidence || hasProfileLink || hasConnectionEvidence);
    const invitationAccessActions = [...new Set(targetCandidates.flatMap(({ connectActions, moreActions }) => [
      ...connectActions,
      ...moreActions,
    ]))];
    if (invitationAccessActions.length === 1) {
      const noteLength = String(message ?? "").trim().length;
      if (noteLength > 200) {
        return {
          status: "skipped",
          reason: `LinkedIn invitation notes are limited to 200 characters; the queued message has ${noteLength}.`,
        };
      }
      return { status: "ready", delivery: "invitation" };
    }
    if (invitationAccessActions.length > 1) {
      return { status: "skipped", reason: "The profile-scoped Connect action is ambiguous." };
    }
    return { status: "skipped", reason: "A single profile-scoped Connect action is unavailable." };
  };

  const deadline = Date.now() + 8_000;
  let outcome = inspect();
  const isStillHydrating = (candidate) => candidate.status === "skipped" && [
    "The visible target LinkedIn profile actions could not be identified.",
    "A single profile-scoped Connect action is unavailable.",
  ].includes(candidate.reason);
  while (
    isStillHydrating(outcome)
    && Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    outcome = inspect();
  }
  return outcome;
}

export async function discoverLinkedInComposeHref(expectedProfileUrl) {
  const outcome = await discoverLinkedInDeliveryPath(expectedProfileUrl, "");
  if (outcome.status === "ready" && outcome.delivery === "direct") {
    const { delivery: _delivery, ...directOutcome } = outcome;
    return directOutcome;
  }
  return outcome.status === "skipped"
    ? outcome
    : { status: "skipped", reason: "A single direct Message action is unavailable for this profile." };
}

export async function sendLinkedInInvitationNote(expectedProfileUrl, message) {
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
  const elementText = (element) => String(
    element?.innerText ?? element?.textContent ?? element?.getAttribute?.("aria-label") ?? ""
  ).replace(/\s+/g, " ").trim();
  const isVisible = (element) => {
    if (!element || element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const visibleElements = (root, selector) =>
    [...(root?.querySelectorAll?.(selector) ?? [])].filter(isVisible);
  const one = (elements) => elements.length === 1 ? elements[0] : null;
  const textMatch = (root, text) => one(visibleElements(root, "[aria-label], a, button").filter(
    (element) => elementText(element) === text
  ));

  const expectedIdentity = profileIdentity(expectedProfileUrl);
  if (!expectedIdentity) {
    return { status: "skipped", reason: "The expected LinkedIn profile is invalid." };
  }
  if (document.location?.href && profileIdentity(document.location.href) !== expectedIdentity) {
    return { status: "skipped", reason: "The current page does not match the expected LinkedIn profile." };
  }

  const textToSend = String(message ?? "").trim();
  if (!textToSend) return { status: "skipped", reason: "A LinkedIn invitation note is required." };
  if (textToSend.length > 200) {
    return {
      status: "skipped",
      reason: `LinkedIn invitation notes are limited to 200 characters; the queued message has ${textToSend.length}.`,
    };
  }

  const main = document.querySelector("main");
  const profileActions = main?.querySelector?.("h1")?.closest?.("section") ?? main;
  if (!profileActions || !isVisible(profileActions)) {
    return { status: "skipped", reason: "The visible target LinkedIn profile actions could not be identified." };
  }

  let connect = textMatch(profileActions, "Connect");
  if (!connect) {
    const moreActions = one(visibleElements(profileActions, "[aria-label], button").filter((element) =>
      /^(?:more|more actions)$/i.test(elementText(element))
    ));
    if (!moreActions) {
      return { status: "skipped", reason: "A single profile-scoped Connect action is unavailable." };
    }
    moreActions.click();
    connect = await waitFor(() => textMatch(document, "Connect"));
  }
  if (!connect) return { status: "skipped", reason: "A single profile-scoped Connect action is unavailable." };
  connect.click();

  const invitationDialog = await waitFor(() => one(visibleElements(document, '[role="dialog"]')));
  if (!invitationDialog) {
    return { status: "skipped", reason: "LinkedIn invitation dialog is unavailable." };
  }
  const addNote = await waitFor(() => textMatch(invitationDialog, "Add a note"));
  if (!addNote) return { status: "skipped", reason: "LinkedIn Add a note action is unavailable." };
  addNote.click();

  const noteField = await waitFor(() => one(
    visibleElements(invitationDialog, "textarea, input").filter((element) => typeof element.value === "string")
  ));
  if (!noteField) return { status: "skipped", reason: "LinkedIn invitation note field is unavailable." };
  noteField.focus?.();
  noteField.value = textToSend;
  noteField.dispatchEvent?.(new Event("input", { bubbles: true }));
  noteField.dispatchEvent?.(new Event("change", { bubbles: true }));
  if (noteField.value !== textToSend) {
    return { status: "failed", reason: "LinkedIn could not establish the exact queued invitation note." };
  }

  const sendButton = await waitFor(() => one(visibleElements(invitationDialog, "button").filter(
    (element) => elementText(element) === "Send" && !element.disabled
  )));
  if (!sendButton) return { status: "skipped", reason: "LinkedIn invitation Send action is unavailable." };
  sendButton.click();

  const sent = await waitFor(() => !isVisible(invitationDialog));
  return sent
    ? { status: "sent", sentText: textToSend }
    : { status: "failed", reason: "LinkedIn did not confirm that the invitation was sent." };
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
