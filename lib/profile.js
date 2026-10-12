/**
 * Builds the "spoof profile" for an identity: everything the page-side script needs
 * so that navigator.* agrees with the User-Agent sent over HTTP.
 */

export const CHROMIUM_FAMILIES = new Set(['chrome', 'edge', 'opera']);

const JS_PLATFORM = {
  windows: 'Win32',
  macos: 'MacIntel',
  linux: 'Linux x86_64',
  android: 'Linux armv81',
  ios: 'iPhone',
  chromeos: 'Linux x86_64',
};

const CH_PLATFORM = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  chromeos: 'Chrome OS',
};

const CH_PLATFORM_VERSION = {
  windows: '15.0.0',
  macos: '15.7.2',
  linux: '6.8.0',
  android: '15.0.0',
  chromeos: '125.0.6422.0',
};

const FF_APP_VERSION = {
  windows: '5.0 (Windows)',
  macos: '5.0 (Macintosh)',
  linux: '5.0 (X11)',
  android: '5.0 (Android)',
};

const FF_OSCPU = {
  windows: 'Windows NT 10.0; Win64; x64',
  macos: 'Intel Mac OS X 10.15',
  linux: 'Linux x86_64',
  android: 'Linux armv8l',
};

// GREASE brands Chromium inserts into Sec-CH-UA; the value rotates per major version.
const GREASE = [
  ['Not_A Brand', '8'],
  ['Not:A-Brand', '24'],
  ['Not)A;Brand', '99'],
  ['Not A(Brand', '24'],
  ['Not?A_Brand', '99'],
  ['Not/A)Brand', '8'],
];

export const isChromium = (identity) =>
  CHROMIUM_FAMILIES.has(identity.family) && identity.chromium != null;

/** Brand list for Sec-CH-UA (major versions) or the full list (full versions). */
export function brandList(identity, full = false) {
  const [greaseBrand, greaseVersion] = GREASE[identity.chromium % GREASE.length];
  const chromiumVersion = full ? identity.full : String(identity.chromium);
  let brands;
  switch (identity.family) {
    case 'chrome':
      brands = [
        { brand: 'Google Chrome', version: chromiumVersion },
        { brand: 'Chromium', version: chromiumVersion },
      ];
      break;
    case 'edge':
      brands = [
        { brand: 'Microsoft Edge', version: full ? identity.brandFull : String(identity.brandVersion) },
        { brand: 'Chromium', version: chromiumVersion },
      ];
      break;
    case 'opera':
      brands = [
        { brand: 'Opera', version: full ? identity.brandFull : String(identity.brandVersion) },
        { brand: 'Chromium', version: chromiumVersion },
      ];
      break;
    default:
      return [];
  }
  return [{ brand: greaseBrand, version: greaseVersion }, ...brands];
}

/**
 * The payload that the background sends to the page. Keep it JSON-serialisable.
 * @returns {object}
 */
export function buildProfile(identity) {
  const chromium = isChromium(identity);
  const firefox = identity.family === 'firefox';
  const os = identity.os;

  let platform = JS_PLATFORM[os] || 'Win32';
  if (firefox && os === 'android') platform = 'Linux armv8l';

  return {
    ua: identity.ua,
    appVersion: firefox ? FF_APP_VERSION[os] || '5.0 (X11)' : identity.ua.replace(/^Mozilla\//, ''),
    platform,
    vendor: chromium ? 'Google Inc.' : identity.family === 'safari' ? 'Apple Computer, Inc.' : '',
    productSub: firefox ? '20100101' : '20030107',
    maxTouchPoints: identity.mobile ? 5 : 0,
    oscpu: firefox ? FF_OSCPU[os] || null : null,
    buildID: firefox ? '20181001000000' : null,
    uaData: chromium
      ? {
          brands: brandList(identity, false),
          mobile: !!identity.mobile,
          platform: CH_PLATFORM[os] || 'Unknown',
          high: {
            architecture: os === 'android' ? '' : 'x86',
            bitness: '64',
            model: '',
            platformVersion: CH_PLATFORM_VERSION[os] || '0.0.0',
            uaFullVersion: identity.brandFull || identity.full,
            fullVersionList: brandList(identity, true),
            wow64: false,
          },
        }
      : null,
  };
}
