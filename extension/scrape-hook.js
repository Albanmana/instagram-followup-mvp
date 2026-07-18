(function () {
  if (window.__igLeadScraperHooked) return;
  window.__igLeadScraperHooked = true;

  const postPayload = (payload) => {
    window.postMessage({ __igLeadScraper: true, payload }, "*");
  };

  const shouldInspect = (url) => {
    if (!url || typeof url !== "string") return false;

    return (
      url.includes("/api/graphql") ||
      url.includes("/api/v1/media/") ||
      url.includes("/api/v1/users/web_profile_info/") ||
      url.includes("/api/v1/users/") ||
      url.includes("/api/v1/friendships/") ||
      url.includes("/graphql/query")
    );
  };

  const readFriendlyName = (headers) => {
    if (!headers) return "";
    if (headers instanceof Headers) {
      return headers.get("x-fb-friendly-name") || "";
    }
    return headers["x-fb-friendly-name"] || headers["X-FB-Friendly-Name"] || "";
  };

  const relayJsonResponse = (kind, url, friendlyName, response) => {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("json")) return;

    response.clone().json()
      .then((data) => {
        postPayload({
          kind,
          url,
          friendlyName,
          data,
          at: new Date().toISOString()
        });
      })
      .catch(() => {});
  };

  const originalFetch = window.fetch;
  window.fetch = async function () {
    const response = await originalFetch.apply(this, arguments);

    try {
      const input = arguments[0];
      const init = arguments[1] || {};
      const url = typeof input === "string" ? input : input?.url;
      if (shouldInspect(url)) {
        relayJsonResponse("fetch", url, readFriendlyName(init.headers), response);
      }
    } catch (_) {}

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__igLeadScraperUrl = url;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      try {
        const url = this.__igLeadScraperUrl;
        const contentType = this.getResponseHeader("content-type") || "";
        if (!shouldInspect(url) || !contentType.includes("json")) return;

        const data = JSON.parse(this.responseText);
        postPayload({
          kind: "xhr",
          url,
          friendlyName: "",
          data,
          at: new Date().toISOString()
        });
      } catch (_) {}
    });

    return originalSend.apply(this, arguments);
  };
})();
