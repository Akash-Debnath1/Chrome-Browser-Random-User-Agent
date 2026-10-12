/**
 * Real-device User-Agent generator.
 *
 * Every template below copies the exact format that the real browser sends today
 * (Chrome/Edge/Opera freeze the OS version in the UA, Firefox/Safari do the same),
 * so the generated strings look like traffic from genuine devices.
 *
 * Versions reflect the stable releases available as of October 2026
 * (Chrome 154, Firefox 157, Safari 26.x, iOS 26.x). Update VERSIONS when new
 * stable releases ship.
 */

/** The 14 browser/OS combinations shown in the Generator settings. */
export const DEVICE_TYPES = Object.freeze([
  { id: 'chrome_win',      label: 'Chrome on Windows',  family: 'chrome',  os: 'windows', mobile: false, color: '#4285f4' },
  { id: 'chrome_mac',      label: 'Chrome on Mac',      family: 'chrome',  os: 'macos',   mobile: false, color: '#4285f4' },
  { id: 'chrome_linux',    label: 'Chrome on Linux',    family: 'chrome',  os: 'linux',   mobile: false, color: '#4285f4' },
  { id: 'chrome_android',  label: 'Chrome on Android',  family: 'chrome',  os: 'android', mobile: true,  color: '#4285f4' },
  { id: 'edge_win',        label: 'Edge on Windows',    family: 'edge',    os: 'windows', mobile: false, color: '#0f9ad8' },
  { id: 'edge_mac',        label: 'Edge on Mac',        family: 'edge',    os: 'macos',   mobile: false, color: '#0f9ad8' },
  { id: 'firefox_win',     label: 'Firefox on Windows', family: 'firefox', os: 'windows', mobile: false, color: '#ff7139' },
  { id: 'firefox_mac',     label: 'Firefox on Mac',     family: 'firefox', os: 'macos',   mobile: false, color: '#ff7139' },
  { id: 'firefox_linux',   label: 'Firefox on Linux',   family: 'firefox', os: 'linux',   mobile: false, color: '#ff7139' },
  { id: 'firefox_android', label: 'Firefox on Android', family: 'firefox', os: 'android', mobile: true,  color: '#ff7139' },
  { id: 'opera_win',       label: 'Opera on Windows',   family: 'opera',   os: 'windows', mobile: false, color: '#ff1b2d' },
  { id: 'opera_mac',       label: 'Opera on Mac',       family: 'opera',   os: 'macos',   mobile: false, color: '#ff1b2d' },
  { id: 'safari_iphone',   label: 'Safari on iPhone',   family: 'safari',  os: 'ios',     mobile: true,  color: '#1b8cf0' },
  { id: 'safari_mac',      label: 'Safari on Mac',      family: 'safari',  os: 'macos',   mobile: false, color: '#1b8cf0' },
]);

/** Types that are enabled out of the box. */
export const DEFAULT_TYPES = Object.freeze([
  'chrome_win', 'chrome_mac', 'chrome_linux',
  'edge_win', 'edge_mac',
  'firefox_win', 'firefox_mac', 'firefox_linux', 'firefox_android',
  'opera_win', 'opera_mac',
]);

/** Browser "chips" used by the popup. Each chip toggles a group of types. */
export const BROWSER_GROUPS = Object.freeze({
  desktop: [
    { key: 'chrome',  name: 'Chrome',  color: '#4285f4', types: ['chrome_win', 'chrome_mac', 'chrome_linux'] },
    { key: 'firefox', name: 'Firefox', color: '#ff7139', types: ['firefox_win', 'firefox_mac', 'firefox_linux'] },
    { key: 'safari',  name: 'Safari',  color: '#1b8cf0', types: ['safari_mac'] },
    { key: 'edge',    name: 'Edge',    color: '#0f9ad8', types: ['edge_win', 'edge_mac'] },
    { key: 'opera',   name: 'Opera',   color: '#ff1b2d', types: ['opera_win', 'opera_mac'] },
  ],
  mobile: [
    { key: 'chrome',  name: 'Chrome',  color: '#4285f4', types: ['chrome_android'] },
    { key: 'firefox', name: 'Firefox', color: '#ff7139', types: ['firefox_android'] },
    { key: 'safari',  name: 'Safari',  color: '#1b8cf0', types: ['safari_iphone'] },
  ],
});

/**
 * Current stable major versions, newest first. The generator picks from these,
 * so the UAs look like those of users on the latest or previous releases.
 */
export const VERSIONS = Object.freeze({
  chrome: [154, 153, 152, 151],           // Chromium / Chrome major
  firefox: [157, 156, 155, 154],
  safariMac: ['26.7', '26.6', '26.5', '26.4'],
  iosBuilds: Object.freeze([
    { os: '26_7_1', safari: '26.7' },
    { os: '26_7', safari: '26.7' },
    { os: '26_6_1', safari: '26.6' },
    { os: '26_6', safari: '26.6' },
    { os: '26_5', safari: '26.5' },
  ]),
  androidForFirefox: [13, 14, 15, 16],    // Firefox for Android reports the real Android version
});

/** Opera's major is Chromium's major minus this offset (Opera 128 = Chromium 144). */
export const OPERA_OFFSET = 16;

const TYPE_BY_ID = new Map(DEVICE_TYPES.map((t) => [t.id, t]));
export const isKnownType = (id) => TYPE_BY_ID.has(id);
export const typeById = (id) => TYPE_BY_ID.get(id);

const pick = (arr, rnd) => arr[Math.floor(rnd() * arr.length)];
const randInt = (min, max, rnd) => min + Math.floor(rnd() * (max - min + 1));
const unique = (list) => [...new Set(list)];

/** Browser families that accept user-added versions. */
export const VERSION_FAMILIES = Object.freeze(['chrome', 'edge', 'opera', 'firefox', 'safari']);

/** Human names and the placeholder shown in the version input. */
export const VERSION_FAMILY_INFO = Object.freeze({
  chrome: { name: 'Chrome', hint: 'e.g. 155' },
  edge: { name: 'Edge', hint: 'e.g. 155' },
  opera: { name: 'Opera', hint: 'e.g. 130' },
  firefox: { name: 'Firefox', hint: 'e.g. 158' },
  safari: { name: 'Safari', hint: 'e.g. 26.8' },
});

/**
 * Validates one version typed by the user. Returns the normalised string, or null.
 *  - Chrome, Edge, Firefox, Opera: a whole number from 50 to 999 (Opera uses Opera's own numbering).
 *  - Safari: 10–40, optionally with a minor part ("26" -> "26.0", "26.8" -> "26.8").
 */
export function parseVersionInput(family, text) {
  const v = String(text ?? '').trim();
  if (family === 'safari') {
    const m = v.match(/^(\d{2})(?:\.(\d{1,2}))?$/);
    if (!m) return null;
    const major = Number(m[1]);
    if (major < 10 || major > 40) return null;
    return `${major}.${m[2] === undefined ? 0 : Number(m[2])}`;
  }
  if (!VERSION_FAMILY_INFO[family] || !/^\d{2,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= 50 && n <= 999 ? String(n) : null;
}

/** Built-in versions as shown to the user (Opera uses Opera's own numbering). */
export function builtinVersionLabels(family) {
  if (family === 'opera') return VERSIONS.chrome.map((c) => String(c - OPERA_OFFSET));
  if (family === 'chrome' || family === 'edge') return VERSIONS.chrome.map(String);
  if (family === 'firefox') return VERSIONS.firefox.map(String);
  if (family === 'safari') return VERSIONS.safariMac.slice();
  return [];
}

/** Turns a Safari "26.8" into an iOS build entry { os: '26_8', safari: '26.8' }. */
const iosBuildFrom = (safari) => {
  const [maj, min] = safari.split('.');
  return { os: `${maj}_${min}`, safari };
};

/**
 * The pool of values the generator picks from for one family. User versions are
 * added to the built-in ones; duplicates are removed.
 *   chrome/edge/firefox -> majors (numbers)
 *   opera               -> Chromium majors (Opera number + 16), so the UA can be built directly
 *   safari              -> Safari version strings ("26.7")
 */
export function versionPool(family, extras = {}) {
  const user = Array.isArray(extras[family]) ? extras[family] : [];
  const nums = user.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  const safariUser = user.filter((v) => /^\d+\.\d+$/.test(v));
  // "only my versions" uses just the user's list (falls back to built-in if the list is empty)
  const onlyMine = !!(extras.only && extras.only[family]) && user.length > 0;
  switch (family) {
    case 'chrome':
    case 'edge':
      return onlyMine ? unique(nums) : unique([...VERSIONS.chrome, ...nums]);
    case 'opera': {
      const mine = nums.map((n) => n + OPERA_OFFSET);
      return onlyMine ? unique(mine) : unique([...VERSIONS.chrome, ...mine]);
    }
    case 'firefox':
      return onlyMine ? unique(nums) : unique([...VERSIONS.firefox, ...nums]);
    case 'safari':
      return onlyMine && safariUser.length ? unique(safariUser) : unique([...VERSIONS.safariMac, ...safariUser]);
    default:
      return [];
  }
}

/** iOS builds: the built-in list plus one build per user-added Safari version. */
function iosBuildPool(extras = {}) {
  const user = (Array.isArray(extras.safari) ? extras.safari : []).filter((v) => /^\d+\.\d+$/.test(v));
  const onlyMine = !!(extras.only && extras.only.safari) && user.length > 0;
  const seen = new Set();
  return [...(onlyMine ? [] : VERSIONS.iosBuilds), ...user.map(iosBuildFrom)].filter((b) => {
    if (seen.has(b.os)) return false;
    seen.add(b.os);
    return true;
  });
}

const CHROME_OS = {
  windows: 'Windows NT 10.0; Win64; x64',
  macos: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
};
const FIREFOX_OS = {
  windows: 'Windows NT 10.0; Win64; x64',
  macos: 'Macintosh; Intel Mac OS X 10.15',
  linux: 'X11; Linux x86_64',
};

const chromiumUa = (os, major, suffix = '') =>
  `Mozilla/5.0 (${CHROME_OS[os]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36${suffix}`;

/**
 * Build a fresh identity for one of the 14 device types.
 * @param {string} typeId      one of DEVICE_TYPES
 * @param {Function} rnd       random source in [0, 1)
 * @param {object} extras      user-added versions per family, e.g. { chrome: ['155'] }
 * @returns {object} identity
 */
export function createGeneratedIdentity(typeId, rnd = Math.random, extras = {}) {
  const type = typeById(typeId);
  if (!type) throw new Error(`Unknown device type: ${typeId}`);

  const identity = {
    source: 'generated',
    typeId,
    family: type.family,
    os: type.os,
    mobile: type.mobile,
    ua: '',
    chromium: null,      // Chromium major (Chromium-based browsers only)
    full: null,          // Chromium full version, e.g. 154.0.8037.92
    brandVersion: null,  // version shown in the browser brand, e.g. Opera 138
    brandFull: null,
  };

  const chromeFull = (major) => `${major}.0.${randInt(6500, 8100, rnd)}.${randInt(20, 220, rnd)}`;

  switch (type.family) {
    case 'chrome': {
      const major = pick(versionPool('chrome', extras), rnd);
      identity.ua = type.os === 'android'
        ? `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Mobile Safari/537.36`
        : chromiumUa(type.os, major);
      identity.chromium = major;
      identity.full = chromeFull(major);
      identity.brandVersion = major;
      identity.brandFull = identity.full;
      break;
    }
    case 'edge': {
      const major = pick(versionPool('edge', extras), rnd);
      identity.ua = chromiumUa(type.os, major, ` Edg/${major}.0.0.0`);
      identity.chromium = major;
      identity.full = chromeFull(major);
      identity.brandVersion = major;
      identity.brandFull = `${major}.0.${randInt(2500, 3800, rnd)}.${randInt(20, 220, rnd)}`;
      break;
    }
    case 'opera': {
      const chromeMajor = pick(versionPool('opera', extras), rnd);
      const operaMajor = chromeMajor - OPERA_OFFSET;
      identity.ua = chromiumUa(type.os, chromeMajor, ` OPR/${operaMajor}.0.0.0`);
      identity.chromium = chromeMajor;
      identity.full = chromeFull(chromeMajor);
      identity.brandVersion = operaMajor;
      identity.brandFull = `${operaMajor}.0.${randInt(5000, 6200, rnd)}.${randInt(10, 99, rnd)}`;
      break;
    }
    case 'firefox': {
      const v = pick(versionPool('firefox', extras), rnd);
      identity.ua = type.os === 'android'
        ? `Mozilla/5.0 (Android ${pick(VERSIONS.androidForFirefox, rnd)}; Mobile; rv:${v}.0) Gecko/${v}.0 Firefox/${v}.0`
        : `Mozilla/5.0 (${FIREFOX_OS[type.os]}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`;
      identity.brandVersion = v;
      break;
    }
    case 'safari': {
      if (type.os === 'ios') {
        const build = pick(iosBuildPool(extras), rnd);
        identity.ua = `Mozilla/5.0 (iPhone; CPU iPhone OS ${build.os} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${build.safari} Mobile/15E148 Safari/604.1`;
        identity.brandVersion = build.safari;
      } else {
        const s = pick(versionPool('safari', extras), rnd);
        identity.ua = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${s} Safari/605.1.15`;
        identity.brandVersion = s;
      }
      break;
    }
    default:
      throw new Error(`Unsupported family: ${type.family}`);
  }
  return identity;
}

const OS_LABEL = {
  windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android',
  ios: 'iOS', chromeos: 'Chrome OS', unknown: 'Unknown OS',
};
const FAMILY_LABEL = {
  chrome: 'Chrome', edge: 'Edge', opera: 'Opera', firefox: 'Firefox', safari: 'Safari', other: 'Browser',
};

/** Short human label, e.g. "Chrome 154 · Windows". */
export function describeIdentity(identity) {
  if (!identity) return 'No User-Agent yet';
  const name = FAMILY_LABEL[identity.family] || 'Browser';
  const ver = identity.brandVersion ? ` ${String(identity.brandVersion).split('.')[0]}` : '';
  const os = OS_LABEL[identity.os] || OS_LABEL.unknown;
  return `${name}${ver} · ${os}`;
}

/* ---------- parsing a user-supplied (custom) User-Agent ---------- */

const detectOs = (s) => {
  if (/Windows/i.test(s)) return 'windows';
  if (/iPhone|iPad|iPod/i.test(s)) return 'ios';
  if (/Android/i.test(s)) return 'android';
  if (/CrOS/.test(s)) return 'chromeos';
  if (/Macintosh|Mac OS X/i.test(s)) return 'macos';
  if (/Linux|X11/i.test(s)) return 'linux';
  return 'unknown';
};

/** Pad a dotted version to four components ("154" -> "154.0.0.0"). */
const fourParts = (v) => {
  const parts = String(v).split('.').slice(0, 4);
  while (parts.length < 4) parts.push('0');
  return parts.join('.');
};

/**
 * Work out what a free-form User-Agent claims to be, so the Client Hints
 * (Sec-CH-UA*) and navigator.userAgentData can be kept consistent with it.
 */
export function identityFromUserAgent(raw) {
  const s = String(raw).trim();
  const os = detectOs(s);
  const mobile = /Mobi|iPhone|iPad|iPod/i.test(s) || (/Android/i.test(s) && /Mobile/i.test(s));
  const grab = (re) => {
    const m = s.match(re);
    return m ? m[1] : null;
  };
  const major = (v) => (v ? parseInt(v.split('.')[0], 10) : null);

  const identity = {
    source: 'custom', typeId: null, family: 'other', os, mobile, ua: s,
    chromium: null, full: null, brandVersion: null, brandFull: null,
  };

  const chromeVer = grab(/Chrome\/(\d+(?:\.\d+){0,3})/);
  const isWebView = /;\s*wv\)/.test(s) || /SamsungBrowser/.test(s);

  if (os === 'ios') {
    const safariVer = grab(/Version\/(\d+(?:\.\d+)*)/);
    if (safariVer && /Safari\//.test(s)) {
      identity.family = 'safari';
      identity.brandVersion = safariVer;
    }
    return identity;
  }

  if (/Edg(?:e|A|iOS)?\/(\d+(?:\.\d+){0,3})/.test(s) && chromeVer && !isWebView) {
    const edge = grab(/Edg(?:e|A)?\/(\d+(?:\.\d+){0,3})/);
    identity.family = 'edge';
    identity.chromium = major(chromeVer);
    identity.full = fourParts(chromeVer);
    identity.brandVersion = major(edge);
    identity.brandFull = edge;
  } else if (/OPR\/(\d+(?:\.\d+){0,3})/.test(s) && chromeVer) {
    const opr = grab(/OPR\/(\d+(?:\.\d+){0,3})/);
    identity.family = 'opera';
    identity.chromium = major(chromeVer);
    identity.full = chromeVer;
    identity.brandVersion = major(opr);
    identity.brandFull = opr;
  } else if (/Firefox\/(\d+(?:\.\d+)*)/.test(s) && !/Seamonkey/i.test(s)) {
    identity.family = 'firefox';
    identity.brandVersion = major(grab(/Firefox\/(\d+(?:\.\d+)*)/));
  } else if (chromeVer && !isWebView) {
    identity.family = 'chrome';
    identity.chromium = major(chromeVer);
    identity.full = chromeVer;
    identity.brandVersion = major(chromeVer);
  } else if (/Version\/(\d+(?:\.\d+)*)/.test(s) && /Safari\//.test(s) && !isWebView) {
    identity.family = 'safari';
    identity.brandVersion = grab(/Version\/(\d+(?:\.\d+)*)/);
  }

  if (identity.full) identity.full = fourParts(identity.full);
  if (identity.brandFull) identity.brandFull = fourParts(identity.brandFull);
  if (identity.family === 'chrome') identity.brandFull = identity.full;
  return identity;
}
