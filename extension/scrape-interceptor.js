(function () {
  window.addEventListener("message", function (event) {
    if (event.source !== window || !event.data?.__igLeadScraper) return;

    chrome.runtime.sendMessage({
      type: "SCRAPE_NETWORK_DATA",
      payload: event.data.payload
    }).catch(() => {});
  });
})();
