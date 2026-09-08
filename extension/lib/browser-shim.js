/* One namespace for both engines.

   Firefox exposes `browser` with promise-returning APIs; Chrome exposes
   `chrome`, which since MV3 also returns promises for everything Pinpoint
   uses. So aliasing is enough — except for two places where the engines
   genuinely differ, which get a helper each:

     PPX.onMessage()   Firefox lets an onMessage listener return a promise;
                       Chrome needs `return true` plus sendResponse.
     PPX.isRestricted() the URL schemes an extension may not touch.

   Loaded first everywhere: background/service worker, popup, options page and
   the injected content script. Safe to load twice, and safe when tests have
   already installed their own `browser` stub. */
(() => {
  const g = typeof globalThis !== 'undefined' ? globalThis : self;

  if (typeof g.browser === 'undefined' && typeof g.chrome !== 'undefined') {
    g.browser = g.chrome;
  }

  if (g.PPX) return;

  // about:, moz-extension:, chrome:, the web store... no extension runs there.
  const RESTRICTED = /^(about|moz-extension|chrome-extension|chrome|edge|brave|resource|view-source|devtools|jar):/i;
  const STORE = /^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org)\//i;

  g.PPX = {
    /* Register a handler that may return a promise, on either engine. */
    onMessage(handler) {
      g.browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        let out;
        try {
          out = handler(msg, sender);
        } catch (e) {
          sendResponse({ ok: false, error: String((e && e.message) || e) });
          return true;
        }
        if (out && typeof out.then === 'function') {
          out.then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
          return true;   // keeps the channel open on Chrome
        }
        if (out === undefined || out === false) return false;
        sendResponse(out);
        return true;
      });
    },

    isRestricted(url) {
      const u = String(url || '');
      return RESTRICTED.test(u) || STORE.test(u);
    }
  };
})();
