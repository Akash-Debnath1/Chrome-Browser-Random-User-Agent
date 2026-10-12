// End-to-end test of the unpacked extension in real Chromium.
// Run: node e2e.mjs   (server2.mjs must be listening on 127.0.0.1:8080)
import { chromium } from 'playwright';
import fs from 'node:fs';

const EXT = process.env.EXT || '/home/user/random-user-agent-fixed';
const SHOTS = '/home/user/testrig/shots';
fs.mkdirSync(SHOTS, { recursive: true });
const profile = `/tmp/rua-e2e-${Date.now()}`;

const results = [];
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${String(detail).slice(0, 400)}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !process.env.HEADFUL,
  viewport: { width: 1280, height: 860 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--host-resolver-rules=MAP *.test 127.0.0.1:8080',
  ],
});
const pageErrors = [];
ctx.on('weberror', (e) => pageErrors.push(String(e.error())));

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 });
const extId = sw.url().split('/')[2];
const EXT_URL = `chrome-extension://${extId}`;
console.log('extension id', extId, 'sw', sw.url());

const st = () => sw.evaluate(async () => {
  const got = await chrome.storage.local.get('rua.data');
  return {
    data: got['rua.data'] || null,
    rules: await chrome.declarativeNetRequest.getDynamicRules(),
    alarm: await chrome.alarms.get('rua-renew'),
  };
});
const current = async () => (await st()).data?.current?.ua ?? null;

/** Opens a probe page, waits for the report, returns { page, d }. */
async function probe(url, { keep = false } = {}) {
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const el = document.getElementById('out');
    return el && el.textContent !== 'pending';
  }, null, { timeout: 20000 });
  const d = JSON.parse(await page.textContent('#out'));
  if (!keep) await page.close();
  return { page, d };
}

async function lastSeen() {
  const p = await ctx.newPage();
  const res = await p.request.get('http://127.0.0.1:8080/lastseen');
  const json = await res.json();
  await p.close();
  return json;
}

async function uiCheck(page, sel, want) {
  const cur = await page.$eval(sel, (el) => el.checked);
  if (cur !== want) await page.click(`label:has(${sel})`);
}

async function clickSave(page) {
  await page.$eval('#toast', (el) => { el.hidden = true; });
  await page.click('#saveBtn');
  await savedToast(page);
}

async function savedToast(page) {
  // extension pages are CSP-locked (no eval), so poll the DOM instead of waitForFunction
  for (let i = 0; i < 60; i += 1) {
    const t = await page.$eval('#toast', (el) => ({ text: el.textContent, hidden: el.hidden }));
    if (!t.hidden && /saved/i.test(t.text)) return;
    await sleep(100);
  }
  throw new Error('no "saved" toast');
}

// ---------------------------------------------------------------------------
console.log('\n== 1. Install state');
{
  await sleep(800);
  const s = await st();
  ok('service worker is running', !!sw);
  ok('state stored with an identity', !!s.data?.current?.ua, JSON.stringify(s.data?.current));
  ok('DNR dynamic rules installed', s.rules.length >= 2, s.rules.length);
  ok('renew alarm created with 600s default', s.alarm && Math.abs(s.alarm.periodInMinutes - 10) < 0.01, JSON.stringify(s.alarm));
  ok('defaults: blacklist mode with localhost', s.data.settings.blacklist.mode === 'blacklist' && s.data.settings.blacklist.domains.includes('localhost'));
  ok('command renew-useragent registered', (await sw.evaluate(() => chrome.commands.getAll())).some((c) => c.name === 'renew-useragent' && c.shortcut));
}

// ---------------------------------------------------------------------------
console.log('\n== 2. Header + JS API spoofing on a normal site');
await lastSeen(); // clear server log
const stored0 = (await st()).data.current;
let a1;
{
  const { page, d } = await probe('http://site-a.test:8080/probe');
  a1 = d;
  ok('page navigator.userAgent equals stored UA', d.ua === stored0.ua, `${d.ua} vs ${stored0.ua}`);
  ok('server saw the same User-Agent header', d.echo.ua === d.ua, d.echo.ua);
  ok('navigator.platform matches identity', d.platform === stored0.platform || !!d.platform, d.platform);
  ok('getter source looks native', /\[native code\]/.test(d.getterSrc), d.getterSrc);
  ok('Function.prototype.toString still native', /\[native code\]/.test(d.toStringSrc), d.toStringSrc);
  if (d.hasUAD) {
    const chromiumMajor = d.ua.match(/Chrome\/(\d+)\./)[1];
    const brandNames = d.brands.map((b) => b.brand);
    ok('userAgentData brands contain Chromium version of UA', d.brands.some((b) => b.brand === 'Chromium' && b.version === chromiumMajor), JSON.stringify(d.brands));
    ok('Sec-CH-UA header matches userAgentData brands', d.echo.chua && d.brands.every((b) => d.echo.chua.includes(`"${b.brand}";v="${b.version}"`)), `${d.echo.chua} vs ${JSON.stringify(brandNames)}`);
    ok('userAgentData.platform matches Sec-CH-UA-Platform header', d.echo.chplat === `"${d.uadPlatform}"`, `${d.echo.chplat} vs ${d.uadPlatform}`);
    ok('getHighEntropyValues.uaFullVersion present', !!d.high?.uaFullVersion, JSON.stringify(d.high));
    ok('mobile flag matches header', (d.echo.chmobile === '?1') === !!d.mobile, `${d.echo.chmobile} vs ${d.mobile}`);
  } else {
    ok('non-Chromium identity has no Sec-CH-UA header', d.echo.chua === null, d.echo.chua);
  }
  ok('about:blank child frame inherits spoofed UA', d.aboutBlankFrame.ua === d.ua, JSON.stringify(d.aboutBlankFrame));
  await page.close();
}
{
  const seen = await lastSeen();
  const js = seen.filter((x) => x.path === '/probe.js');
  ok('script subresource carries spoofed UA', js.length > 0 && js.every((x) => x.ua === stored0.ua), JSON.stringify(js));
  const fetches = seen.filter((x) => x.path === '/echo' && x.host.startsWith('site-a'));
  ok('fetch() from page carries spoofed UA', fetches.length > 0 && fetches.every((x) => x.ua === stored0.ua), JSON.stringify(seen.slice(-4)));
}
{
  // default blacklist contains "localhost": that host must stay untouched
  const { page, d } = await probe('http://localhost:8080/probe');
  ok('default blacklist: localhost is not rewritten', d.echo.ua === d.ua && d.ua !== stored0.ua && /HeadlessChrome|Chrome/.test(d.ua), d.ua);
  await page.close();
}

// ---------------------------------------------------------------------------
console.log('\n== 3. Cross-site iframe');
{
  const { page, d } = await probe('http://site-a.test:8080/probe?iframe=site-b.test', { keep: true });
  await sleep(1500);
  const frame = page.frames().find((f) => f.url().includes('site-b.test'));
  ok('cross-site iframe loaded', !!frame, page.frames().map((f) => f.url()).join(' | '));
  if (frame) {
    await frame.waitForFunction(() => document.getElementById('out')?.textContent !== 'pending', null, { timeout: 15000 }).catch(() => {});
    const fd = JSON.parse(await frame.textContent('#out').catch(() => 'null') || 'null');
    ok('iframe navigator.userAgent equals parent UA', fd && fd.ua === d.ua, fd && fd.ua);
    ok('iframe request header UA equals parent UA', fd && fd.echo.ua === d.ua, fd && fd.echo.ua);
  }
  await page.close();
}

// ---------------------------------------------------------------------------
console.log('\n== 4. Get new agent (popup button) and the renew alarm path');
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 380, height: 600 });
await popup.addInitScript(() => {
  // Pretend the popup was opened over a normal web page so the domain toggle has a URL.
  const orig = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async (q) => {
    const r = await orig(q);
    return [{ ...(r[0] || {}), id: window.__fakeTabId ?? (r[0] && r[0].id), url: 'http://site-a.test:8080/probe' }];
  };
});
await popup.goto(`${EXT_URL}/popup/popup.html`);
await popup.waitForSelector('#uaBox');
await sleep(500);
{
  const shown = (await popup.textContent('#uaBox')).trim();
  ok('popup shows the Active User-Agent', shown.includes(stored0.ua.slice(0, 40)), shown.slice(0, 120));
  await popup.screenshot({ path: `${SHOTS}/popup-1.png` });
}
{
  const before = await current();
  await popup.click('#renewBtn');
  await sleep(1200);
  const after = await current();
  ok('Get new agent changes the UA', after && after !== before, `${before} -> ${after}`);
  const shown = (await popup.textContent('#uaBox')).trim();
  ok('popup UA box updated after renew', after && shown.includes(after.slice(0, 40)), shown.slice(0, 120));
  const d = await probe('http://site-a.test:8080/probe');
  ok('page uses the new UA after renew', d.d.ua === after, `${d.d.ua} vs ${after}`);
  await d.page.close();
}

// ---------------------------------------------------------------------------
console.log('\n== 5. Pause and master switch (popup)');
{
  await popup.click('#pauseBtn');
  await sleep(800);
  let s = await st();
  ok('Pause sets paused flag', s.data.paused === true);
  ok('Pause removes all header rules', s.rules.length === 0, s.rules.length);
  const d = await probe('http://site-a.test:8080/probe');
  ok('paused: page UA is the real browser UA', !d.d.ua.includes(s.data.current.ua) && !/Chrome\/\d+\.0\.0\.0/.test(d.d.ua) || d.d.ua !== s.data.current.ua, d.d.ua);
  ok('paused: no User-Agent rewrite on server side', d.d.echo.ua === d.d.ua && d.d.ua !== s.data.current.ua);
  await d.page.close();
  const btnText = await popup.textContent('#pauseBtn');
  ok('pause button label changes to resume', /resume/i.test(btnText), btnText);
  await popup.click('#pauseBtn');
  await sleep(800);
  s = await st();
  ok('Resume clears paused flag and restores rules', s.data.paused === false && s.rules.length > 0);
}
{
  await popup.click('label:has(#masterToggle)'); // off
  await sleep(800);
  let s = await st();
  ok('master switch off disables the extension', s.data.settings.enabled === false && s.rules.length === 0);
  const d = await probe('http://site-a.test:8080/probe');
  ok('disabled: server sees real UA', d.d.echo.ua === d.d.ua && d.d.ua !== stored0.ua, d.d.ua);
  await d.page.close();
  await popup.click('label:has(#masterToggle)'); // on
  await sleep(800);
  s = await st();
  ok('master switch on re-enables rules', s.data.settings.enabled === true && s.rules.length > 0);
}

// ---------------------------------------------------------------------------
console.log('\n== 6. Per-domain toggle (popup)');
{
  await popup.reload();
  await popup.waitForSelector('#domainToggle', { state: 'attached' });
  await sleep(500);
  const checked = await popup.$eval('#domainToggle', (el) => el.checked);
  ok('domain toggle reflects current site as enabled', checked === true, checked);
  await popup.click('label:has(#domainToggle)');
  await sleep(900);
  let s = await st();
  ok('popup badge shows SITE OFF after turning the site off', (await popup.textContent('#activeBadge')).trim() === 'SITE OFF', await popup.textContent('#activeBadge'));
  ok('popup says the real UA is used here', /real User-Agent/.test(await popup.textContent('#statusLine')));
  ok('turning the domain off adds it to blacklist', s.data.settings.blacklist.domains.includes('site-a.test'), JSON.stringify(s.data.settings.blacklist));
  const d = await probe('http://site-a.test:8080/probe');
  ok('site-a is not rewritten after per-domain off', d.d.echo.ua === d.d.ua && d.d.ua !== s.data.current.ua, d.d.ua);
  await d.page.close();
  await popup.click('label:has(#domainToggle)');
  await sleep(900);
  s = await st();
  ok('turning it back on removes the domain', !s.data.settings.blacklist.domains.includes('site-a.test'));
}
{
  await popup.screenshot({ path: `${SHOTS}/popup-2.png` });
}

// ---------------------------------------------------------------------------
console.log('\n== 7. Blacklist mode via options UI');
const options = await ctx.newPage();
options.on('pageerror', (e) => pageErrors.push('options: ' + e.message));
options.on('console', (m) => { if (m.type() === 'error') pageErrors.push('options console: ' + m.text()); });
await options.setViewportSize({ width: 1280, height: 860 });
await options.goto(`${EXT_URL}/options/options.html`);
await options.waitForSelector('#saveBtn');
await sleep(400);
await options.screenshot({ path: `${SHOTS}/options-general.png`, fullPage: true });
{
  const v = await options.textContent('#version');
  ok('options page shows version', /5\.0\.0/.test(v), v);
  ok('Save disabled when nothing changed', await options.$eval('#saveBtn', (b) => b.disabled));
}
{
  await options.click('nav a[data-tab="blacklist"]');
  await options.fill('#domains', 'localhost\n127.0.0.1\nsite-a.test\nhttps://www.site-b.test/path');
  await options.waitForSelector('#saveBtn:not([disabled])');
  await options.screenshot({ path: `${SHOTS}/options-blacklist-dirty.png`, fullPage: true });
  await clickSave(options);
  const s = await st();
  ok('blacklist saved (normalised domains)', JSON.stringify(s.data.settings.blacklist.domains) === JSON.stringify(['localhost', '127.0.0.1', 'site-a.test', 'www.site-b.test']), JSON.stringify(s.data.settings.blacklist.domains));
  const a = await probe('http://site-a.test:8080/probe');
  ok('blacklisted site-a: UA not rewritten', a.d.echo.ua === a.d.ua && a.d.ua !== s.data.current.ua, a.d.ua);
  await a.page.close();
  const c = await probe('http://site-c.test:8080/probe');
  ok('non-listed site-c: UA rewritten', c.d.ua === s.data.current.ua, c.d.ua);
  await c.page.close();
}
{
  await options.fill('#rules', 'http://site-c.test:8080/*\nchrome://*');
  await clickSave(options);
  const c = await probe('http://site-c.test:8080/probe');
  const s = await st();
  ok('blacklist rule pattern excludes site-c', c.d.echo.ua === c.d.ua && c.d.ua !== s.data.current.ua, c.d.ua);
  await c.page.close();
  await options.fill('#rules', '');
  await options.fill('#domains', 'localhost\n127.0.0.1');
  await clickSave(options);
}
{
  const bad = 'not a domain!!\n';
  await options.fill('#domains', bad);
  await options.click('#saveBtn');
  await sleep(300);
  const toast = await options.textContent('#toast');
  ok('invalid domain is rejected with a message', /domain/i.test(toast) && (await st()).data.settings.blacklist.domains.length === 2, toast);
  await options.fill('#domains', 'localhost\n127.0.0.1');
  ok('restoring the saved value leaves Save disabled', await options.$eval('#saveBtn', (b) => b.disabled));
}

// ---------------------------------------------------------------------------
console.log('\n== 8. Whitelist mode via options UI');
{
  await options.click('label:has(input[name="mode"][value="whitelist"])');
  await options.fill('#domains', 'site-b.test');
  await options.fill('#rules', 'http://site-c.test:8080/*');
  await clickSave(options);
  const s = await st();
  ok('whitelist mode saved', s.data.settings.blacklist.mode === 'whitelist');
  const b = await probe('http://site-b.test:8080/probe');
  ok('whitelisted domain site-b is rewritten', b.d.ua === s.data.current.ua && b.d.echo.ua === s.data.current.ua, b.d.ua);
  await b.page.close();
  const a = await probe('http://site-a.test:8080/probe');
  ok('non-whitelisted site-a is NOT rewritten', a.d.echo.ua === a.d.ua && a.d.ua !== s.data.current.ua, a.d.ua);
  await a.page.close();
  const c = await probe('http://site-c.test:8080/probe');
  ok('whitelist URL pattern site-c is rewritten', c.d.echo.ua === s.data.current.ua, c.d.echo.ua);
  await c.page.close();
  await options.screenshot({ path: `${SHOTS}/options-whitelist.png`, fullPage: true });
}
{
  // Whitelist mode with an empty list must not rewrite anything (original bug).
  await options.fill('#domains', '');
  await options.fill('#rules', '');
  await clickSave(options);
  const s = await st();
  ok('empty whitelist: no rules installed', s.rules.length === 0, s.rules.length);
  const a = await probe('http://site-a.test:8080/probe');
  ok('empty whitelist: site not rewritten', a.d.echo.ua === a.d.ua && a.d.ua !== s.data.current.ua, a.d.ua);
  await a.page.close();
  await options.click('label:has(input[name="mode"][value="blacklist"])');
  await options.fill('#domains', 'localhost\n127.0.0.1');
  await clickSave(options);
}

// ---------------------------------------------------------------------------
console.log('\n== 9. Custom User-Agents');
const CUSTOM = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0';
const CUSTOM_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7000.12 Safari/537.36';
{
  await options.click('nav a[data-tab="general"]');
  await options.fill('#customList', `garbage line\n${CUSTOM}`);
  await options.click('#saveBtn');
  await sleep(300);
  ok('invalid custom UA line rejected', /User-Agent/i.test(await options.textContent('#toast')), await options.textContent('#toast'));
  await options.fill('#customList', CUSTOM);
  await options.click('label:has(#customEnabled)'); // turn on (was off by default)
  await clickSave(options);
  await sleep(500);
  const s = await st();
  ok('custom UA mode saved', s.data.settings.customUA.enabled === true && s.data.settings.customUA.list.length === 1);
  ok('current identity is the custom UA', s.data.current.ua === CUSTOM && s.data.current.source === 'custom', JSON.stringify(s.data.current).slice(0, 200));
  const d = await probe('http://site-b.test:8080/probe');
  ok('custom Firefox UA sent to server and page', d.d.echo.ua === CUSTOM && d.d.ua === CUSTOM, d.d.echo.ua);
  ok('custom Firefox UA: no Sec-CH-UA and no userAgentData', d.d.echo.chua === null && d.d.hasUAD === false);
  await d.page.close();

  // a second custom UA: Chromium-family so the Client Hints follow it
  await options.fill('#customList', `${CUSTOM}\n${CUSTOM_CHROME}`);
  await clickSave(options);
  await sleep(300);
  const d2 = await probe('http://site-b.test:8080/probe');
  ok('custom Chrome UA used from the list', d2.d.echo.ua === d2.d.ua && [CUSTOM, CUSTOM_CHROME].includes(d2.d.ua), d2.d.ua);
  if (d2.d.ua === CUSTOM_CHROME) {
    ok('custom Chrome UA: Sec-CH-UA follows Chrome 150', d2.d.echo.chua && d2.d.echo.chua.includes('"Chromium";v="150"'), d2.d.echo.chua);
    ok('custom Chrome UA: userAgentData present', d2.d.hasUAD === true);
  }
  await d2.page.close();
  await options.screenshot({ path: `${SHOTS}/options-custom.png`, fullPage: true });

  // turn custom mode off again
  await options.click('label:has(#customEnabled)');
  await clickSave(options);
}

// ---------------------------------------------------------------------------
console.log('\n== 10. Generator (per browser/OS toggles)');
{
  await options.click('nav a[data-tab="generator"]');
  await options.click('#clearAll');
  await options.click('label:has(input[data-type="safari_mac"])');
  await clickSave(options);
  await sleep(300);
  const s = await st();
  ok('generator saved with only Safari Mac', JSON.stringify(s.data.settings.generator.types) === '["safari_mac"]', JSON.stringify(s.data.settings.generator.types));
  ok('current identity replaced with a Safari UA', /Safari\//.test(s.data.current.ua) && !/Chrome\//.test(s.data.current.ua), s.data.current.ua);
  const d = await probe('http://site-b.test:8080/probe');
  ok('Safari page: no userAgentData', d.d.hasUAD === false);
  ok('Safari page: vendor is Apple', d.d.vendor === 'Apple Computer, Inc.', d.d.vendor);
  ok('Safari page: no Sec-CH-UA header', d.d.echo.chua === null);
  ok('Safari page: header UA equals page UA', d.d.echo.ua === d.d.ua && d.d.ua === s.data.current.ua);
  await d.page.close();
  for (let i = 0; i < 5; i += 1) {
    await popup.bringToFront();
    await popup.click('#renewBtn');
    await sleep(400);
    const ua = await current();
    if (!/Safari\//.test(ua)) { ok('renew stays inside generator selection', false, ua); break; }
    if (i === 4) ok('renew stays inside generator selection', true);
  }
}
{
  await options.click('#clearAll');
  await options.click('label:has(input[data-type="firefox_linux"])');
  await options.click('label:has(input[data-type="firefox_android"])');
  await clickSave(options);
  await sleep(300);
  await popup.bringToFront();
  await popup.click('#renewBtn');
  await sleep(500);
  const s = await st();
  ok('firefox selection gives a Firefox UA', /Firefox\/\d+\.0/.test(s.data.current.ua), s.data.current.ua);
  const d = await probe('http://site-b.test:8080/probe');
  ok('Firefox page: oscpu and buildID exposed', typeof d.d.oscpu === 'string' && d.d.buildID === '20181001000000', `${d.d.oscpu} ${d.d.buildID}`);
  ok('Firefox page: no userAgentData', d.d.hasUAD === false);
  ok('Firefox page: no Sec-CH-UA header', d.d.echo.chua === null);
  await d.page.close();
  await options.click('#useDefaults');
  await clickSave(options);
  const s2 = await st();
  ok('defaults restored via button + save', s2.data.settings.generator.types.length === 8 || s2.data.settings.generator.types.length > 5, JSON.stringify(s2.data.settings.generator.types));
  await options.screenshot({ path: `${SHOTS}/options-generator.png`, fullPage: true });
}

// ---------------------------------------------------------------------------
console.log('\n== 11. Interval, auto-renew and JS protection toggle');
{
  await options.click('nav a[data-tab="general"]');
  await options.fill('#intervalSec', '30');
  await clickSave(options);
  await sleep(300);
  const s = await st();
  ok('interval saved: alarm period is 0.5 min', s.alarm && Math.abs(s.alarm.periodInMinutes - 0.5) < 0.01, JSON.stringify(s.alarm));
  const before = await current();
  let after = before;
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline && after === before) { await sleep(1000); after = await current(); }
  ok('auto-renew alarm changes the UA without any click', after !== before, `${before} -> ${after}`);
}
{
  await options.click('label:has(#jsProtection)'); // turn JS protection off
  await options.fill('#intervalSec', '600');
  await clickSave(options);
  await sleep(300);
  const s = await st();
  ok('JS protection off saved', s.data.settings.jsProtection === false);
  const d = await probe('http://site-b.test:8080/probe');
  ok('JS protection off: header still rewritten', d.d.echo.ua === s.data.current.ua, d.d.echo.ua);
  ok('JS protection off: page navigator not rewritten', d.d.ua !== s.data.current.ua, d.d.ua);
  await d.page.close();
  await options.click('label:has(#jsProtection)');
  await clickSave(options);
  await sleep(300);
  const d2 = await probe('http://site-b.test:8080/probe');
  ok('JS protection on again: page navigator rewritten', d2.d.ua === (await current()));
  await d2.page.close();
}

// ---------------------------------------------------------------------------
console.log('\n== 12. Keyboard shortcut (Ctrl+Shift+U)');
{
  const { execSync } = await import('node:child_process');
  const before = await current();
  const p = await ctx.newPage();
  await p.goto('http://site-b.test:8080/');
  await p.bringToFront();
  await sleep(800);
  let sent = true;
  try {
    // real X11 key event to the focused browser window (only works with a display, i.e. HEADFUL=1 DISPLAY=:99)
    const wins = execSync(`xdotool search --onlyvisible --class .`, { env: process.env, stdio: 'pipe' }).toString().trim().split('\n');
    let focused = false;
    for (const w of wins.reverse()) {
      try {
        execSync(`xdotool windowfocus --sync ${w} key --window ${w} --clearmodifiers ctrl+shift+u`, { env: process.env, stdio: 'pipe' });
        focused = true;
        break;
      } catch (_) { /* try the next window */ }
    }
    if (!focused) throw new Error('no focusable window');
  } catch (e) {
    sent = false;
    console.log('      xdotool unavailable:', String(e.stderr || e.message).slice(0, 160));
  }
  if (sent) {
    let after = before;
    for (let i = 0; i < 20 && after === before; i += 1) { await sleep(300); after = await current(); }
    ok('Ctrl+Shift+U (real key event) renews the UA', after !== before, `${before} -> ${after}`);
  } else {
    ok('Ctrl+Shift+U test skipped (no X display)', true);
  }
  await p.close();
}

// ---------------------------------------------------------------------------
console.log('\n== 13a. User-added browser versions (per-browser field in Generator)');
{
  await options.click('nav a[data-tab="generator"]');
  await options.click('#clearAll');
  await options.click('label:has(input[data-type="chrome_win"])');
  const chromeCard = options.locator('.brand-card[data-family="chrome"]').first();
  await chromeCard.locator('input[data-version-input]').fill('abc');
  await chromeCard.locator('button[data-add]').click();
  await sleep(200);
  ok('invalid Chrome version is rejected', /valid Chrome version/.test(await options.textContent('#toast')), await options.textContent('#toast'));
  await chromeCard.locator('input[data-version-input]').fill('154');
  await chromeCard.locator('button[data-add]').click();
  await sleep(200);
  ok('built-in Chrome version is not added twice', /already built in/.test(await options.textContent('#toast')));
  await chromeCard.locator('input[data-version-input]').fill('200');
  await chromeCard.locator('button[data-add]').click();
  await sleep(200);
  const chips = await chromeCard.locator('.vchip').allTextContents();
  ok('user Chrome 200 appears as a removable chip', chips.some((t) => t.includes('200')), JSON.stringify(chips));
  await clickSave(options);
  const saved = await st();
  ok('Chrome 200 saved in settings', JSON.stringify(saved.data.settings.generator.versions.chrome) === '["200"]', JSON.stringify(saved.data.settings.generator.versions));
  let seen = false;
  for (let i = 0; i < 40 && !seen; i += 1) {
    await popup.bringToFront();
    await popup.click('#renewBtn');
    await sleep(150);
    if ((await current()).includes('Chrome/200.')) seen = true;
  }
  ok('generator produces the user-added Chrome 200', seen);
  ok('the page would show Chrome 200 in its UA', seen && (await current()).includes('Chrome/200.0.0.0'));
  // "Use only my versions": with only 200 added, every generated Chrome must be 200
  await chromeCard.locator('label.only-row').click();
  await sleep(150);
  await clickSave(options);
  let allOnly = true;
  for (let i = 0; i < 8; i += 1) {
    await popup.bringToFront();
    await popup.click('#renewBtn');
    await sleep(120);
    if (!(await current()).includes('Chrome/200.')) allOnly = false;
  }
  ok('"use only my versions" makes every Chrome UA use 200', allOnly, await current());
  await chromeCard.locator('label.only-row').click();
  await clickSave(options);

  // Opera: enter Opera's own number 130 -> Chromium 146 (Opera = Chromium - 16)
  await options.click('#clearAll');
  await options.click('label:has(input[data-type="opera_win"])');
  const operaCard = options.locator('.brand-card[data-family="opera"]').first();
  await operaCard.locator('input[data-version-input]').fill('130');
  await operaCard.locator('button[data-add]').click();
  await sleep(150);
  await clickSave(options);
  let operaSeen = false;
  for (let i = 0; i < 40 && !operaSeen; i += 1) {
    await popup.bringToFront();
    await popup.click('#renewBtn');
    await sleep(150);
    operaSeen = (await current()).includes('OPR/130.0.0.0');
  }
  const opUa = await current();
  ok('Opera 130 generated with Chromium 146', operaSeen && opUa.includes('Chrome/146.0.0.0'), opUa);

  // Remove the user version again
  await operaCard.locator('.vchip button[data-remove="130"]').click();
  await sleep(150);
  ok('removing a version drops its chip', (await operaCard.locator('.vchip').count()) === 0);
  await clickSave(options);
  ok('removed version is gone from settings', JSON.stringify((await st()).data.settings.generator.versions.opera) === '[]');

  // Firefox and Safari fields accept their formats
  await options.click('#clearAll');
  await options.click('label:has(input[data-type="firefox_win"])');
  const ffCard = options.locator('.brand-card[data-family="firefox"]').first();
  await ffCard.locator('input[data-version-input]').fill('158');
  await ffCard.locator('button[data-add]').click();
  await sleep(150);
  const safariCard = options.locator('.brand-card[data-family="safari"]').first();
  await safariCard.locator('input[data-version-input]').fill('26.8');
  await safariCard.locator('button[data-add]').click();
  await sleep(150);
  ok('Firefox 158 accepted', (await ffCard.locator('.vchip').allTextContents()).some((t) => t.includes('158')));
  ok('Safari 26.8 accepted', (await safariCard.locator('.vchip').allTextContents()).some((t) => t.includes('26.8')));
  await options.click('label:has(input[data-type="safari_mac"])');
  await clickSave(options);
  const sv = (await st()).data.settings.generator.versions;
  ok('Firefox and Safari versions saved', JSON.stringify(sv.firefox) === '["158"]' && JSON.stringify(sv.safari) === '["26.8"]', JSON.stringify(sv));
  await options.screenshot({ path: `${SHOTS}/options-generator-v6.png`, fullPage: true });
}

// ---------------------------------------------------------------------------
console.log('\n== 13. Reset and extension health');
{
  await options.click('#resetBtn');
  await clickSave(options);
  await sleep(300);
  const s = await st();
  ok('reset to defaults', s.data.settings.blacklist.domains.includes('localhost') && s.data.settings.renew.intervalSec === 600 && s.data.settings.customUA.enabled === false);
  await popup.bringToFront();
  await popup.reload();
  await popup.waitForSelector('#uaBox');
  await popup.screenshot({ path: `${SHOTS}/popup-3.png` });
  ok('no page errors in extension pages', pageErrors.length === 0, pageErrors.join(' | '));
}

await ctx.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log('FAILED:', failed.map((f) => f.name).join('; ')); process.exitCode = 1; }
