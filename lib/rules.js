/**
 * Builds the declarativeNetRequest (DNR) dynamic rules.
 *
 *  - Header rule: replaces the User-Agent request header and the Sec-CH-UA* client hints.
 *  - Payload rule (JS protection): adds a `server-timing` response header with the spoof
 *    profile. The page-side script (content/inject.js) reads it before any page code runs.
 *  - Exception rules: decide which sites are left alone (blacklist) or which are the only
 *    ones touched (whitelist), based on domains and wildcard rules.
 */
import { buildProfile, isChromium } from './profile.js';
import { globToRegexSource, normalizeDomain } from './matching.js';

export const PAYLOAD_HEADER = 'rua-ctx';

const ALL_TYPES = [
  'main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other',
];
const FRAME_TYPES = ['main_frame', 'sub_frame'];
const SUBRESOURCE_TYPES = ALL_TYPES.filter((t) => t !== 'main_frame');

// High-entropy client hints. We strip them so the real OS/version never leaks.
const HIGH_ENTROPY_HINTS = [
  'Sec-CH-UA-Full-Version',
  'Sec-CH-UA-Full-Version-List',
  'Sec-CH-UA-Platform-Version',
  'Sec-CH-UA-Arch',
  'Sec-CH-UA-Bitness',
  'Sec-CH-UA-Model',
  'Sec-CH-UA-WoW64',
];

/** Base64url of a JSON object. Safe to put inside a quoted server-timing `desc`. */
export function encodePayload(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function requestHeaderOps(identity) {
  const ops = [{ header: 'User-Agent', operation: 'set', value: identity.ua }];
  if (isChromium(identity)) {
    const profile = buildProfile(identity).uaData;
    const brands = profile.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ');
    ops.push(
      { header: 'Sec-CH-UA', operation: 'set', value: brands },
      { header: 'Sec-CH-UA-Mobile', operation: 'set', value: identity.mobile ? '?1' : '?0' },
      { header: 'Sec-CH-UA-Platform', operation: 'set', value: `"${profile.platform}"` },
    );
  } else {
    ops.push(
      { header: 'Sec-CH-UA', operation: 'remove' },
      { header: 'Sec-CH-UA-Mobile', operation: 'remove' },
      { header: 'Sec-CH-UA-Platform', operation: 'remove' },
    );
  }
  for (const header of HIGH_ENTROPY_HINTS) ops.push({ header, operation: 'remove' });
  return ops;
}

/**
 * @param {object} args
 * @param {object} args.settings   normalised settings
 * @param {object} args.identity   the User-Agent identity to use right now
 * @returns {object[]} DNR rules (ids start at 1)
 */
export function buildRules({ settings, identity }) {
  if (!identity) return [];
  const rules = [];
  const push = (priority, action, condition) => {
    rules.push({ id: rules.length + 1, priority, action, condition });
  };

  const headerAction = { type: 'modifyHeaders', requestHeaders: requestHeaderOps(identity) };
  let payloadAction = null;
  if (settings.jsProtection) {
    const payload = encodePayload(buildProfile(identity));
    payloadAction = {
      type: 'modifyHeaders',
      responseHeaders: [{ header: 'server-timing', operation: 'set', value: `${PAYLOAD_HEADER};desc="${payload}"` }],
    };
  }

  const domains = [...new Set(settings.blacklist.domains.map(normalizeDomain).filter(Boolean))];
  const patterns = settings.blacklist.rules;

  if (settings.blacklist.mode === 'blacklist') {
    // Everything except the listed domains and wildcard rules.
    const excluded = domains.length
      ? { excludedRequestDomains: domains, excludedInitiatorDomains: domains }
      : {};
    push(1, headerAction, { resourceTypes: ALL_TYPES, ...excluded });
    if (payloadAction) push(1, payloadAction, { resourceTypes: FRAME_TYPES, ...excluded });
    // Wildcard rules: an "allow" at higher priority stops the header rules from touching them.
    for (const pattern of patterns) {
      const regexFilter = globToRegexSource(pattern);
      push(2, { type: 'allow' }, { regexFilter, resourceTypes: ALL_TYPES });
    }
  } else {
    // Only the listed domains and wildcard rules.
    if (domains.length) {
      push(1, headerAction, { requestDomains: domains, resourceTypes: ALL_TYPES });
      push(1, headerAction, { initiatorDomains: domains, resourceTypes: SUBRESOURCE_TYPES });
      if (payloadAction) {
        push(1, payloadAction, { requestDomains: domains, resourceTypes: FRAME_TYPES });
        push(1, payloadAction, { initiatorDomains: domains, resourceTypes: ['sub_frame'] });
      }
    }
    for (const pattern of patterns) {
      const regexFilter = globToRegexSource(pattern);
      push(1, headerAction, { regexFilter, resourceTypes: ALL_TYPES });
      if (payloadAction) push(1, payloadAction, { regexFilter, resourceTypes: FRAME_TYPES });
    }
  }
  return rules;
}
