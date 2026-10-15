/**
 * Keeps the MV3 service worker alive while a web page is open.
 *
 * Chrome stops an idle service worker after about 30 seconds. A long-lived port
 * from a content script keeps it running, so the User-Agent rules and the
 * fallback logic stay available. This script does nothing else: it runs in the
 * isolated world, reads no page data, and sends only an empty heartbeat.
 *
 * Back/forward cache: a page with an open port cannot be cached, and Chrome
 * closes the port when it caches the page. So the port is closed on pagehide and
 * opened again on pageshow. This keeps the page cacheable and avoids
 * "Unchecked runtime.lastError" entries in chrome://extensions.
 */
(() => {
  const PORT_NAME = 'rua-keepalive';
  const HEARTBEAT_MS = 20000;
  let port = null;
  let beat = null;

  function connect() {
    if (port) return;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (_err) {
      // Extension context is gone (reloaded or removed). Stop quietly.
      port = null;
      return;
    }
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it as handled, so Chrome does not log it.
      void chrome.runtime.lastError;
      port = null;
      clearInterval(beat);
      if (!document.hidden) setTimeout(connect, 1000);
    });
    clearInterval(beat);
    beat = setInterval(() => {
      try { port && port.postMessage({ t: 'ping' }); } catch (_err) { /* ignore */ }
    }, HEARTBEAT_MS);
  }

  function release() {
    clearInterval(beat);
    beat = null;
    if (port) {
      try { port.disconnect(); } catch (_err) { /* already gone */ }
      port = null;
    }
  }

  window.addEventListener('pagehide', release);
  window.addEventListener('pageshow', (event) => { if (event.persisted) connect(); });

  connect();
})();
