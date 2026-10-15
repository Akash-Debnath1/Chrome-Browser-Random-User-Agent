/**
 * Keeps the MV3 service worker alive while a web page is open.
 *
 * Chrome stops an idle service worker after about 30 seconds. A long-lived port
 * from a content script keeps it running, so the User-Agent rules and the
 * fallback logic stay available. This script does nothing else: it runs in the
 * isolated world, reads no page data, and sends only an empty heartbeat.
 */
(() => {
  const PORT_NAME = 'rua-keepalive';
  const HEARTBEAT_MS = 20000;
  let port = null;
  let beat = null;

  function connect() {
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch (_err) {
      // Extension context is gone (reloaded or removed). Stop quietly.
      port = null;
      return;
    }
    port.onDisconnect.addListener(() => {
      port = null;
      clearInterval(beat);
      setTimeout(connect, 1000);
    });
    clearInterval(beat);
    beat = setInterval(() => {
      try { port && port.postMessage({ t: 'ping' }); } catch (_err) { /* ignore */ }
    }, HEARTBEAT_MS);
  }

  connect();
})();
