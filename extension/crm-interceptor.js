(function () {
  console.log("[IG CRM] crm-interceptor.js loaded (isolated world).");

  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data || !event.data.__igFollowUpCrm) return;
    console.log("[IG CRM] postMessage received in content script — relaying to background.");
    chrome.runtime.sendMessage({ type: "CRM_INBOX_DATA", data: event.data.data }).catch(function (err) {
      console.error("[IG CRM] Failed to relay to background:", err);
    });
  });
})();
