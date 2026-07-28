(function () {
  if (window.__igFollowUpHooked) return;
  window.__igFollowUpHooked = true;
  console.log("[IG CRM] MAIN world hook installing at document_start");
  const _orig = window.fetch;
  window.fetch = async function () {
    const response = await _orig.apply(this, arguments);
    try {
      const input = arguments[0];
      const init = arguments[1] || {};
      const url = typeof input === "string" ? input : (input && input.url);
      if (url && url.includes("/api/graphql")) {
        const h = init.headers || {};
        const name = (h instanceof Headers
          ? h.get("x-fb-friendly-name")
          : h["x-fb-friendly-name"]) || "";
        console.log("[IG CRM] graphql:", name);
        if (name === "PolarisDirectInboxQuery") {
          console.log("[IG CRM] PolarisDirectInboxQuery intercepted — posting message…");
          response.clone().json().then(function (data) {
            window.postMessage({ __igFollowUpCrm: true, data: data }, "*");
          }).catch(function (err) {
            console.error("[IG CRM] clone/parse error:", err);
          });
        }
      }
    } catch (err) {
      console.error("[IG CRM] hook error:", err);
    }
    return response;
  };
  console.log("[IG CRM] fetch hook installed.");
})();
