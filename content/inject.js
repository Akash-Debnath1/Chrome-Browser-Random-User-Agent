/*
 * Page-side spoofing. Runs in the page's own JavaScript world ("MAIN") at document_start,
 * before any page script, so navigator.* already reports the active identity.
 *
 * The profile arrives in two ways:
 *  1. Own navigation: a `server-timing` entry (rua-ctx) added by the background to the
 *     HTML response. Readable synchronously from performance.getEntriesByType('navigation').
 *  2. Inherited: about:blank / srcdoc frames have no response of their own, so they copy
 *     the profile from their parent frame's (already-spoofed) navigator.
 * If neither is present the switcher is off for this page and nothing is changed.
 */
(() => {
  'use strict';

  const PAYLOAD_NAME = 'rua-ctx';

  // ---------------------------------------------------------------------------
  // Make overridden functions look native: Function.prototype.toString reports
  // "function get userAgent() { [native code] }" for our replacements.
  // ---------------------------------------------------------------------------
  const nativeText = new WeakMap();
  const nativeToString = Function.prototype.toString;
  const patchedToString = new Proxy(nativeToString, {
    apply(target, thisArg, args) {
      if (typeof thisArg === 'function' && nativeText.has(thisArg)) return nativeText.get(thisArg);
      return Reflect.apply(target, thisArg, args);
    },
  });
  nativeText.set(patchedToString, 'function toString() { [native code] }');
  try {
    Object.defineProperty(Function.prototype, 'toString', {
      value: patchedToString, writable: true, configurable: true, enumerable: false,
    });
  } catch (_) { /* ignore */ }

  const defineGetter = (target, prop, read) => {
    const holder = { get [prop]() { return read(); } };
    const getter = Object.getOwnPropertyDescriptor(holder, prop).get;
    nativeText.set(getter, `function get ${prop}() { [native code] }`);
    Object.defineProperty(target, prop, { get: getter, set: undefined, enumerable: true, configurable: true });
  };

  const defineMethod = (target, name, impl) => {
    const holder = { [name](...args) { return impl.apply(this, args); } };
    const fn = holder[name];
    nativeText.set(fn, `function ${name}() { [native code] }`);
    Object.defineProperty(target, name, { value: fn, writable: true, enumerable: true, configurable: true });
  };

  const removeProp = (target, prop) => {
    try { delete target[prop]; } catch (_) { /* ignore */ }
  };

  // ---------------------------------------------------------------------------
  // navigator.userAgentData (Chromium-based identities only)
  // ---------------------------------------------------------------------------
  const buildUaData = (d) => {
    const base = (typeof NavigatorUAData !== 'undefined' && NavigatorUAData.prototype) || Object.prototype;
    const brands = Object.freeze(d.brands.map((b) => Object.freeze({ brand: b.brand, version: b.version })));
    const uad = Object.create(base);
    defineGetter(uad, 'brands', () => brands);
    defineGetter(uad, 'mobile', () => d.mobile);
    defineGetter(uad, 'platform', () => d.platform);
    defineMethod(uad, 'toJSON', () => ({ brands, mobile: d.mobile, platform: d.platform }));
    defineMethod(uad, 'getHighEntropyValues', (hints) => {
      if (d.delegate) return d.delegate.getHighEntropyValues(hints);
      return new Promise((resolve) => {
        const result = { brands, mobile: d.mobile, platform: d.platform };
        const high = d.high || {};
        for (const hint of Array.isArray(hints) ? hints : []) {
          if (Object.prototype.hasOwnProperty.call(high, hint)) result[hint] = high[hint];
        }
        resolve(result);
      });
    });
    return uad;
  };

  // ---------------------------------------------------------------------------
  // Apply a profile to the navigator of this frame
  // ---------------------------------------------------------------------------
  const applyProfile = (p) => {
    const NP = Navigator.prototype;
    defineGetter(NP, 'userAgent', () => p.ua);
    defineGetter(NP, 'appVersion', () => p.appVersion);
    defineGetter(NP, 'platform', () => p.platform);
    defineGetter(NP, 'vendor', () => p.vendor);
    defineGetter(NP, 'productSub', () => p.productSub);
    defineGetter(NP, 'maxTouchPoints', () => p.maxTouchPoints);

    if (p.oscpu) defineGetter(NP, 'oscpu', () => p.oscpu); else removeProp(NP, 'oscpu');
    if (p.buildID) defineGetter(NP, 'buildID', () => p.buildID); else removeProp(NP, 'buildID');

    if (p.uaData) {
      const uad = buildUaData(p.uaData);
      defineGetter(NP, 'userAgentData', () => uad);
    } else {
      // Firefox and Safari have no userAgentData, so it must not exist either.
      removeProp(NP, 'userAgentData');
    }
  };

  // ---------------------------------------------------------------------------
  // Reading the profile
  // ---------------------------------------------------------------------------
  const decodePayload = (text) => {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  };

  const readOwnPayload = () => {
    const entry = performance.getEntriesByType('navigation')[0];
    const timing = entry && entry.serverTiming;
    if (!timing) return null;
    for (const item of timing) {
      if (item.name === PAYLOAD_NAME && item.description) return decodePayload(item.description);
    }
    return null;
  };

  const readInherited = () => {
    try {
      const parent = window.parent;
      if (!parent || parent === window) return null;
      const pn = parent.navigator;
      if (!pn || pn.userAgent === navigator.userAgent) return null;
      const puad = pn.userAgentData;
      return {
        ua: pn.userAgent,
        appVersion: pn.appVersion,
        platform: pn.platform,
        vendor: pn.vendor,
        productSub: pn.productSub,
        maxTouchPoints: pn.maxTouchPoints,
        oscpu: pn.oscpu || null,
        buildID: pn.buildID || null,
        uaData: puad
          ? {
              brands: [...puad.brands].map((b) => ({ brand: b.brand, version: b.version })),
              mobile: puad.mobile,
              platform: puad.platform,
              delegate: puad,
            }
          : null,
      };
    } catch (_) {
      return null; // cross-origin parent
    }
  };

  try {
    const profile = readOwnPayload() || readInherited();
    if (profile) applyProfile(profile);
  } catch (err) {
    console.warn('[Random User-Agent] could not apply the profile', err);
  }
})();
