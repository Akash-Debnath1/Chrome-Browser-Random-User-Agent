import http from 'node:http';
const PORT = 8080;
const seen = [];

const probeHtml = (q) => `<!doctype html><html><head><meta charset="utf-8"><title>probe</title>
<script src="/probe.js"></script></head><body>
<pre id="out">pending</pre>
${q.get('iframe') ? `<iframe id="cross" src="http://${q.get('iframe')}:8080/probe?frame=1"></iframe>` : ''}
<script>
async function collect() {
  const n = navigator;
  const d = {
    ua: n.userAgent, appVersion: n.appVersion, platform: n.platform, vendor: n.vendor,
    productSub: n.productSub, maxTouchPoints: n.maxTouchPoints,
    oscpu: n.oscpu ?? null, buildID: n.buildID ?? null,
    hasUAD: 'userAgentData' in n,
    getterSrc: String(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(n), 'userAgent')?.get),
    toStringSrc: String(Function.prototype.toString),
  };
  if (n.userAgentData) {
    d.brands = n.userAgentData.brands.map(b => ({ brand: b.brand, version: b.version }));
    d.mobile = n.userAgentData.mobile;
    d.uadPlatform = n.userAgentData.platform;
    d.high = await n.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'platformVersion', 'uaFullVersion', 'fullVersionList', 'model', 'wow64']);
  }
  d.echo = await (await fetch('/echo?from=page')).json();
  return d;
}
window.addEventListener('load', async () => {
  const ab = document.createElement('iframe');
  document.body.appendChild(ab);
  const abNav = ab.contentWindow.navigator;
  const aboutBlankFrame = { ua: abNav.userAgent, platform: abNav.platform, hasUAD: 'userAgentData' in abNav };
  const r = await collect();
  r.aboutBlankFrame = aboutBlankFrame;
  // give the cross-origin iframe (if any) a moment, then ask it for its values
  const cross = document.getElementById('cross');
  if (cross) {
    await new Promise(res => setTimeout(res, 1200));
    r.crossFrameLoaded = true;
  }
  document.getElementById('out').textContent = JSON.stringify(r);
});
</script></body></html>`;

const iframeHtml = (q) => `<!doctype html><html><head><meta charset="utf-8"></head><body>
<pre id="out">pending</pre>
<script>
async function collect() {
  const n = navigator;
  const d = { ua: n.userAgent, platform: n.platform, hasUAD: 'userAgentData' in n, brands: n.userAgentData ? n.userAgentData.brands.map(b => b.brand) : null };
  d.echo = await (await fetch('/echo?from=frame')).json();
  return d;
}
collect().then(d => { document.getElementById('out').textContent = JSON.stringify(d); parent.postMessage({ frameProbe: d }, '*'); });
</script></body></html>`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const h = req.headers;
  const log = {
    path: u.pathname, host: h.host, ua: h['user-agent'] ?? null,
    chua: h['sec-ch-ua'] ?? null, chmobile: h['sec-ch-ua-mobile'] ?? null, chplat: h['sec-ch-ua-platform'] ?? null,
    chfvl: h['sec-ch-ua-full-version-list'] ?? null, chpv: h['sec-ch-ua-platform-version'] ?? null,
    dest: h['sec-fetch-dest'] ?? null,
  };
  if (u.pathname !== '/lastseen') seen.push(log);
  const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(body); };
  if (u.pathname === '/lastseen') return send(200, 'application/json', JSON.stringify(seen.splice(0)));
  if (u.pathname === '/echo') return send(200, 'application/json', JSON.stringify(log));
  if (u.pathname === '/probe.js') return send(200, 'application/javascript', 'window.__probeJs = true;');
  if (u.pathname === '/probe') return send(200, 'text/html; charset=utf-8', probeHtml(u.searchParams));
  if (u.pathname === '/frame') return send(200, 'text/html; charset=utf-8', iframeHtml(u.searchParams));
  send(200, 'text/html', '<p>home</p>');
}).listen(PORT, '127.0.0.1', () => console.log('listening', PORT));
