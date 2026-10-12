// Unit tests for the pure logic. Run: node tests/unit.mjs
import assert from 'node:assert/strict';
import { DEVICE_TYPES, createGeneratedIdentity, identityFromUserAgent, describeIdentity } from '../lib/devices.js';
import { buildProfile, brandList } from '../lib/profile.js';
import { normalizeDomain, globToRegexSource, globToRegExp, isApplicable, setDomainEnabled, hostMatchesDomain, parseHttpUrl } from '../lib/matching.js';
import { normalizeSettings, defaultSettings, splitLines, isValidUserAgent } from '../lib/settings.js';
import { pickIdentity, isIdentityAllowed, effectiveTypes } from '../lib/generator.js';
import { buildRules, encodePayload } from '../lib/rules.js';
import { parseVersionInput, versionPool, builtinVersionLabels, VERSIONS } from '../lib/devices.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log('  ok  ', name); };

// ---- UA generation: every type produces a realistic, self-consistent identity
test('every device type generates a UA with the right family/OS markers', () => {
  for (const t of DEVICE_TYPES) {
    for (let i = 0; i < 40; i += 1) {
      const id = createGeneratedIdentity(t.id);
      assert.equal(id.family, t.family, t.id);
      assert.equal(id.mobile, t.mobile, t.id);
      assert.match(id.ua, /^Mozilla\/5\.0 \(/, t.id);
      if (t.family === 'firefox') assert.match(id.ua, /Firefox\/\d+\.0$/, t.id);
      if (t.family === 'edge') assert.match(id.ua, /Edg\/\d+\.0\.0\.0$/, t.id);
      if (t.family === 'opera') assert.match(id.ua, /OPR\/\d+\.0\.0\.0$/, t.id);
      if (t.family === 'safari') assert.match(id.ua, /Version\/\d+\.\d+.* Safari\/(605\.1\.15|604\.1)$/, t.id);
      if (t.os === 'windows') assert.match(id.ua, /Windows NT 10\.0/, t.id);
      if (t.os === 'macos' && t.family !== 'firefox') assert.match(id.ua, /Mac OS X 10[_.]15[_.]7|Mac OS X 10\.15/, t.id);
      if (t.os === 'android') assert.match(id.ua, /Android/, t.id);
      if (t.os === 'ios') assert.match(id.ua, /iPhone; CPU iPhone OS 26_/, t.id);
    }
  }
});

test('Chromium-based UAs carry the same Chromium major as the Client Hints', () => {
  for (const t of DEVICE_TYPES.filter((x) => ['chrome', 'edge', 'opera'].includes(x.family))) {
    for (let i = 0; i < 30; i += 1) {
      const id = createGeneratedIdentity(t.id);
      const m = id.ua.match(/Chrome\/(\d+)\.0\.0\.0/);
      assert.ok(m, t.id);
      assert.equal(Number(m[1]), id.chromium, t.id);
      const profile = buildProfile(id);
      assert.ok(profile.uaData, t.id);
      const chromiumBrand = profile.uaData.brands.find((b) => b.brand === 'Chromium');
      assert.equal(chromiumBrand.version, String(id.chromium), t.id);
      if (t.family === 'opera') {
        const opera = profile.uaData.brands.find((b) => b.brand === 'Opera');
        assert.equal(opera.version, String(id.brandVersion));
        assert.match(id.ua, new RegExp(`OPR/${opera.version}\\.0\\.0\\.0`));
      }
      if (t.family === 'edge') {
        const edge = profile.uaData.brands.find((b) => b.brand === 'Microsoft Edge');
        assert.match(id.ua, new RegExp(`Edg/${edge.version}\\.0\\.0\\.0`));
      }
      assert.equal(profile.uaData.mobile, t.mobile);
    }
  }
});

test('non-Chromium UAs get no userAgentData and no Client Hints brands', () => {
  for (const t of DEVICE_TYPES.filter((x) => ['firefox', 'safari'].includes(x.family))) {
    const id = createGeneratedIdentity(t.id);
    assert.equal(buildProfile(id).uaData, null, t.id);
    assert.deepEqual(brandList(id), [], t.id);
  }
});

test('Firefox profile exposes oscpu/buildID; Chrome profile does not', () => {
  const ff = buildProfile(createGeneratedIdentity('firefox_win'));
  assert.equal(ff.oscpu, 'Windows NT 10.0; Win64; x64');
  assert.equal(ff.buildID, '20181001000000');
  assert.equal(ff.vendor, '');
  const ch = buildProfile(createGeneratedIdentity('chrome_win'));
  assert.equal(ch.oscpu, null);
  assert.equal(ch.platform, 'Win32');
  assert.equal(ch.vendor, 'Google Inc.');
});

test('mobile profiles report touch points and mobile platforms', () => {
  assert.equal(buildProfile(createGeneratedIdentity('chrome_android')).maxTouchPoints, 5);
  assert.equal(buildProfile(createGeneratedIdentity('chrome_android')).uaData.platform, 'Android');
  assert.equal(buildProfile(createGeneratedIdentity('safari_iphone')).platform, 'iPhone');
  assert.equal(buildProfile(createGeneratedIdentity('chrome_win')).maxTouchPoints, 0);
});

test('describeIdentity gives a short label', () => {
  const id = createGeneratedIdentity('chrome_win');
  assert.match(describeIdentity(id), /^Chrome \d+ · Windows$/);
  assert.equal(describeIdentity(null), 'No User-Agent yet');
});

// ---- Custom UA parsing
test('custom UA validation rejects non-UA lines', () => {
  assert.equal(isValidUserAgent('garbage line'), false);
  assert.equal(isValidUserAgent('x'), false);
  assert.equal(isValidUserAgent('Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/150.0'), true);
  assert.equal(isValidUserAgent('curl/8.5.0'), true);
  assert.equal(isValidUserAgent('Mozilla/5.0 \u00e9t\u00e9 Chrome/1'), false);
});

test('custom UA parsing detects family, OS and Chromium version', () => {
  const chrome = identityFromUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7000.12 Safari/537.36');
  assert.equal(chrome.family, 'chrome');
  assert.equal(chrome.os, 'windows');
  assert.equal(chrome.chromium, 150);
  assert.equal(chrome.full, '150.0.7000.12');
  const edge = identityFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.2000.5');
  assert.equal(edge.family, 'edge');
  assert.equal(edge.os, 'macos');
  assert.equal(edge.brandVersion, 150);
  const opera = identityFromUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0');
  assert.equal(opera.family, 'opera');
  assert.equal(opera.brandVersion, 124);
  const ff = identityFromUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0');
  assert.equal(ff.family, 'firefox');
  const sf = identityFromUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
  assert.equal(sf.family, 'safari');
  assert.equal(sf.mobile, true);
  assert.equal(sf.os, 'ios');
  const android = identityFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36');
  assert.equal(android.family, 'chrome');
  assert.equal(android.mobile, true);
  assert.equal(identityFromUserAgent('curl/8.5.0').family, 'other');
  const webview = identityFromUserAgent('Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.0.0 Mobile Safari/537.36');
  assert.equal(webview.family, 'other');
});

test('custom UA profile keeps the exact UA string', () => {
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';
  assert.equal(buildProfile(identityFromUserAgent(ua)).ua, ua);
});

// ---- Domains and wildcards
test('normalizeDomain accepts hosts and URLs, rejects junk', () => {
  assert.equal(normalizeDomain('Example.COM'), 'example.com');
  assert.equal(normalizeDomain('https://www.example.com/path?x=1'), 'www.example.com');
  assert.equal(normalizeDomain('*.example.com'), 'example.com');
  assert.equal(normalizeDomain('localhost'), 'localhost');
  assert.equal(normalizeDomain('127.0.0.1'), '127.0.0.1');
  assert.equal(normalizeDomain('example.com:8080'), 'example.com');
  assert.equal(normalizeDomain('chrome://*'), null);
  assert.equal(normalizeDomain('bad_domain!'), null);
  assert.equal(normalizeDomain('-bad.com'), null);
  assert.equal(normalizeDomain(''), null);
});

test('hostMatchesDomain includes subdomains but not look-alikes', () => {
  assert.ok(hostMatchesDomain('a.b.example.com', 'example.com'));
  assert.ok(hostMatchesDomain('example.com', 'example.com'));
  assert.ok(!hostMatchesDomain('notexample.com', 'example.com'));
  assert.ok(!hostMatchesDomain('example.com.evil.net', 'example.com'));
});

test('glob to regex: * and ? behave as documented', () => {
  const re = globToRegExp('*google.com/*');
  assert.ok(re.test('https://mail.google.com/inbox'));
  assert.ok(!re.test('https://google.org/'));
  assert.ok(globToRegExp('https://www.?oogle.com/*').test('https://www.google.com/x'));
  assert.ok(!globToRegExp('https://www.?oogle.com/*').test('https://www.gooogle.com/x'));
  assert.ok(globToRegExp('chrome://*').test('chrome://settings'));
  // regex specials in the pattern are literal
  assert.ok(globToRegExp('https://a.b(c)+/*').test('https://a.b(c)+/x'));
  assert.equal(globToRegexSource('a.b'), '^a\\.b$');
});

test('isApplicable in blacklist and whitelist modes', () => {
  const bl = normalizeSettings({ blacklist: { mode: 'blacklist', domains: ['bank.com'], rules: ['*://intranet.*/*'] } });
  assert.equal(isApplicable(bl, 'https://news.com/a'), true);
  assert.equal(isApplicable(bl, 'https://www.bank.com/login'), false);
  assert.equal(isApplicable(bl, 'https://intranet.corp/home'), false);
  assert.equal(isApplicable(bl, 'chrome://settings'), false);
  assert.equal(isApplicable(bl, 'file:///tmp/x.html'), false);
  const wl = normalizeSettings({ blacklist: { mode: 'whitelist', domains: ['shop.com'], rules: ['https://docs.org/*'] } });
  assert.equal(isApplicable(wl, 'https://shop.com/cart'), true);
  assert.equal(isApplicable(wl, 'https://docs.org/page'), true);
  assert.equal(isApplicable(wl, 'https://news.com/'), false);
});

test('setDomainEnabled toggles the list entry for the page host', () => {
  const s = normalizeSettings({ blacklist: { mode: 'blacklist', domains: [], rules: [] } });
  const off = setDomainEnabled(s, 'https://site.com/x', false);
  assert.deepEqual(off.settings.blacklist.domains, ['site.com']);
  assert.equal(isApplicable(off.settings, 'https://site.com/x'), false);
  const on = setDomainEnabled(off.settings, 'https://site.com/x', true);
  assert.deepEqual(on.settings.blacklist.domains, []);
  assert.equal(isApplicable(on.settings, 'https://site.com/x'), true);

  const wl = normalizeSettings({ blacklist: { mode: 'whitelist', domains: [], rules: [] } });
  const wOn = setDomainEnabled(wl, 'https://site.com/x', true);
  assert.deepEqual(wOn.settings.blacklist.domains, ['site.com']);
  assert.equal(isApplicable(wOn.settings, 'https://site.com/x'), true);
  const wOff = setDomainEnabled(wOn.settings, 'https://site.com/x', false);
  assert.equal(isApplicable(wOff.settings, 'https://site.com/x'), false);
});

test('setDomainEnabled warns when a broader entry still covers the host', () => {
  const s = normalizeSettings({ blacklist: { mode: 'blacklist', domains: ['example.com'], rules: [] } });
  const res = setDomainEnabled(s, 'https://app.example.com/', true);
  assert.ok(res.warning);
  assert.equal(setDomainEnabled(s, 'https://other.net/', false).warning, null);
  assert.equal(parseHttpUrl('chrome://extensions'), null);
  assert.equal(setDomainEnabled(s, 'chrome://extensions', true).warning, 'This page cannot be changed.');
});

// ---- Settings normalisation
test('normalizeSettings repairs bad input and never throws', () => {
  const s = normalizeSettings({
    enabled: 'yes',
    renew: { intervalSec: 5 },
    customUA: { enabled: true, list: ['Mozilla/5.0 (Windows NT 10.0) Chrome/150.0.0.0 Safari/537.36', 'x', 'Mozilla/5.0 (Windows NT 10.0) Chrome/150.0.0.0 Safari/537.36'] },
    generator: { types: ['chrome_win', 'nope', 'chrome_win'] },
    blacklist: { mode: 'weird', domains: ['good.com', 'bad!!', 'https://x.org/a'], rules: ['', 'chrome://*'] },
  });
  assert.equal(s.enabled, true);
  assert.equal(s.renew.intervalSec, 30);
  assert.equal(s.customUA.list.length, 1);
  assert.deepEqual(s.generator.types, ['chrome_win']);
  assert.equal(s.blacklist.mode, 'blacklist');
  assert.deepEqual(s.blacklist.domains, ['good.com', 'x.org']);
  assert.deepEqual(s.blacklist.rules, ['chrome://*']);
  const empty = normalizeSettings(undefined);
  assert.deepEqual(empty, defaultSettings());
  assert.deepEqual(splitLines('a\n\n a \na'), ['a']);
});

// ---- Generator selection
test('pickIdentity only uses enabled types and never repeats the same UA', () => {
  const s = normalizeSettings({ generator: { types: ['firefox_linux', 'safari_iphone'] } });
  let last = null;
  for (let i = 0; i < 60; i += 1) {
    const id = pickIdentity(s, { avoidUa: last });
    assert.ok(['firefox', 'safari'].includes(id.family));
    assert.notEqual(id.ua, last);
    assert.ok(isIdentityAllowed(s, id));
    last = id.ua;
  }
});

test('syncOsWithHost restricts generation to the host OS when possible', () => {
  const s = normalizeSettings({ generator: { types: DEVICE_TYPES.map((t) => t.id), syncOsWithHost: true } });
  for (let i = 0; i < 40; i += 1) assert.equal(pickIdentity(s, { hostOs: 'linux' }).os, 'linux');
});

test('custom UAs override generation and are picked from the list', () => {
  const list = ['Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0.0.0 Safari/537.36', 'Mozilla/5.0 (Windows NT 10.0) Firefox/150.0'];
  const s = normalizeSettings({ customUA: { enabled: true, list } });
  for (let i = 0; i < 20; i += 1) {
    const id = pickIdentity(s);
    assert.equal(id.source, 'custom');
    assert.ok(list.includes(id.ua));
  }
  assert.equal(isIdentityAllowed(s, identityFromUserAgent(list[0])), true);
  assert.equal(isIdentityAllowed(s, createGeneratedIdentity('chrome_win')), false);
});

test('effectiveTypes falls back to defaults when the list is empty', () => {
  assert.ok(effectiveTypes(normalizeSettings({ generator: { types: [] } })).length > 0);
});

// ---- DNR rule construction
const idChrome = createGeneratedIdentity('chrome_win');
test('blacklist mode builds one header rule with exclusions and allow rules for patterns', () => {
  const s = normalizeSettings({ blacklist: { mode: 'blacklist', domains: ['localhost', 'bank.com'], rules: ['chrome://*'] } });
  const rules = buildRules({ settings: s, identity: idChrome });
  const header = rules.find((r) => r.action.type === 'modifyHeaders' && r.action.requestHeaders);
  assert.equal(header.priority, 1);
  assert.deepEqual(header.condition.excludedRequestDomains, ['localhost', 'bank.com']);
  assert.deepEqual(header.condition.excludedInitiatorDomains, ['localhost', 'bank.com']);
  assert.ok(header.condition.resourceTypes.includes('main_frame'));
  const ua = header.action.requestHeaders.find((h) => h.header === 'User-Agent');
  assert.equal(ua.value, idChrome.ua);
  const allow = rules.find((r) => r.action.type === 'allow');
  assert.equal(allow.priority, 2);
  assert.equal(allow.condition.regexFilter, '^chrome://.*$');
  const payload = rules.find((r) => r.action.responseHeaders);
  assert.equal(payload.action.responseHeaders[0].header, 'server-timing');
  assert.deepEqual(payload.condition.resourceTypes, ['main_frame', 'sub_frame']);
  // ids are unique
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
});

test('jsProtection off removes the payload rule', () => {
  const s = normalizeSettings({ jsProtection: false, blacklist: { mode: 'blacklist', domains: [], rules: [] } });
  const rules = buildRules({ settings: s, identity: idChrome });
  assert.equal(rules.filter((r) => r.action.responseHeaders).length, 0);
});

test('whitelist mode only builds rules for listed domains and patterns', () => {
  const s = normalizeSettings({ blacklist: { mode: 'whitelist', domains: ['shop.com'], rules: ['https://docs.org/*'] } });
  const rules = buildRules({ settings: s, identity: idChrome });
  assert.ok(rules.every((r) => r.action.type !== 'allow'));
  assert.ok(rules.some((r) => r.condition.requestDomains && r.condition.requestDomains[0] === 'shop.com'));
  assert.ok(rules.some((r) => r.condition.initiatorDomains && r.condition.initiatorDomains[0] === 'shop.com'));
  assert.ok(rules.some((r) => r.condition.regexFilter === '^https://docs\\.org/.*$'));
  const empty = normalizeSettings({ blacklist: { mode: 'whitelist', domains: [], rules: [] } });
  assert.equal(buildRules({ settings: empty, identity: idChrome }).length, 0);
});

test('Chromium identity sends Sec-CH-UA; Firefox identity removes them', () => {
  const s = normalizeSettings({ blacklist: { mode: 'blacklist', domains: [], rules: [] } });
  const chromeRule = buildRules({ settings: s, identity: idChrome })[0];
  assert.ok(chromeRule.action.requestHeaders.some((h) => h.header === 'Sec-CH-UA' && h.operation === 'set'));
  const ff = buildRules({ settings: s, identity: createGeneratedIdentity('firefox_win') })[0];
  const sec = ff.action.requestHeaders.find((h) => h.header === 'Sec-CH-UA');
  assert.equal(sec.operation, 'remove');
  assert.ok(ff.action.requestHeaders.some((h) => h.header === 'Sec-CH-UA-Full-Version-List' && h.operation === 'remove'));
});

test('payload is base64url and round-trips', () => {
  const profile = buildProfile(idChrome);
  const enc = encodePayload(profile);
  assert.match(enc, /^[A-Za-z0-9_-]+$/);
  const b64 = enc.replace(/-/g, '+').replace(/_/g, '/');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  assert.deepEqual(JSON.parse(json), JSON.parse(JSON.stringify(profile)));
});

// ---- user-added browser versions
test('parseVersionInput accepts valid versions and rejects junk', () => {
  assert.equal(parseVersionInput('chrome', '155'), '155');
  assert.equal(parseVersionInput('chrome', ' 155 '), '155');
  assert.equal(parseVersionInput('chrome', '49'), null);
  assert.equal(parseVersionInput('chrome', '1000'), null);
  assert.equal(parseVersionInput('chrome', '155.0'), null);
  assert.equal(parseVersionInput('chrome', 'abc'), null);
  assert.equal(parseVersionInput('firefox', '158'), '158');
  assert.equal(parseVersionInput('edge', '150'), '150');
  assert.equal(parseVersionInput('opera', '130'), '130');
  assert.equal(parseVersionInput('safari', '26'), '26.0');
  assert.equal(parseVersionInput('safari', '26.8'), '26.8');
  assert.equal(parseVersionInput('safari', '9.1'), null);
  assert.equal(parseVersionInput('safari', '26.8.1'), null);
  assert.equal(parseVersionInput('nope', '150'), null);
});

test('user versions join the pool and duplicates are removed', () => {
  const pool = versionPool('chrome', { chrome: ['155', '154', '155'] });
  assert.ok(pool.includes(155));
  assert.equal(pool.filter((v) => v === 154).length, 1);
  assert.ok(versionPool('firefox', { firefox: ['158'] }).includes(158));
  assert.ok(versionPool('safari', { safari: ['26.8'] }).includes('26.8'));
});

test('Opera user versions are Opera numbers and map to Chromium + 16', () => {
  const pool = versionPool('opera', { opera: ['130'] });
  assert.ok(pool.includes(146), 'Opera 130 = Chromium 146');
  assert.deepEqual(builtinVersionLabels('opera').slice(0, 1), [String(VERSIONS.chrome[0] - 16)]);
  for (let i = 0; i < 20; i += 1) {
    const id = createGeneratedIdentity('opera_win', Math.random, { opera: ['130'] });
    assert.match(id.ua, /OPR\/(\d+)\.0\.0\.0/);
    if (id.brandVersion === 130) assert.equal(id.chromium, 146);
  }
});

test('generator uses a user-added version when it is the only option', () => {
  const extras = { chrome: ['200'], edge: ['201'], firefox: ['202'], safari: ['27.1'] };
  const chrome = createGeneratedIdentity('chrome_win', Math.random, extras);
  // the pool is built-in + user, so a user version is reachable; check across many picks
  const seen = new Set();
  for (let i = 0; i < 400; i += 1) seen.add(createGeneratedIdentity('chrome_win', Math.random, extras).chromium);
  assert.ok(seen.has(200), 'Chrome 200 should appear');
  assert.ok(chrome.ua.includes('Chrome/'));
  const ffSeen = new Set();
  for (let i = 0; i < 400; i += 1) ffSeen.add(createGeneratedIdentity('firefox_win', Math.random, extras).brandVersion);
  assert.ok(ffSeen.has(202));
  const edgeSeen = new Set();
  for (let i = 0; i < 400; i += 1) edgeSeen.add(createGeneratedIdentity('edge_win', Math.random, extras).brandVersion);
  assert.ok(edgeSeen.has(201));
  const saSeen = new Set();
  for (let i = 0; i < 400; i += 1) saSeen.add(createGeneratedIdentity('safari_mac', Math.random, extras).brandVersion);
  assert.ok(saSeen.has('27.1'));
  const iosSeen = new Set();
  for (let i = 0; i < 400; i += 1) iosSeen.add(createGeneratedIdentity('safari_iphone', Math.random, extras).ua);
  assert.ok([...iosSeen].some((ua) => ua.includes('OS 27_1 like') && ua.includes('Version/27.1')));
});

test('settings normalisation keeps only valid per-browser versions', () => {
  const s = normalizeSettings({ generator: { versions: { chrome: ['155', '155', 'x', '40'], safari: ['26', '26.8', 'bad'], unknown: ['1'] } } });
  assert.deepEqual(s.generator.versions.chrome, ['155']);
  assert.deepEqual(s.generator.versions.safari, ['26.0', '26.8']);
  assert.deepEqual(s.generator.versions.firefox, []);
  assert.equal(s.generator.versions.unknown, undefined);
  assert.deepEqual(defaultSettings().generator.versions.edge, []);
});

test('"use only my versions" skips built-in versions, and falls back when the list is empty', () => {
  assert.deepEqual(versionPool('chrome', { chrome: ['230'], only: { chrome: true } }), [230]);
  assert.deepEqual(versionPool('opera', { opera: ['130'], only: { opera: true } }), [146]);
  assert.deepEqual(versionPool('chrome', { chrome: [], only: { chrome: true } }).length, VERSIONS.chrome.length);
  const seen = new Set();
  for (let i = 0; i < 60; i += 1) seen.add(createGeneratedIdentity('chrome_win', Math.random, { chrome: ['230'], only: { chrome: true } }).chromium);
  assert.deepEqual([...seen], [230]);
  const s2 = normalizeSettings({ generator: { onlyMine: { chrome: true, nope: true } } });
  assert.equal(s2.generator.onlyMine.chrome, true);
  assert.equal(s2.generator.onlyMine.firefox, false);
  assert.equal(s2.generator.onlyMine.nope, undefined);
});

console.log(`\n${passed} unit tests passed`);
