import { DEFAULT_TYPES, createGeneratedIdentity, identityFromUserAgent, typeById } from './devices.js';

/** Maps chrome.runtime.getPlatformInfo().os to the OS names used by the device table. */
export function hostOsFromPlatform(os) {
  switch (os) {
    case 'win': return 'windows';
    case 'mac': return 'macos';
    case 'linux': return 'linux';
    case 'android': return 'android';
    case 'cros': return 'chromeos';
    default: return null;
  }
}

/** Device types that may currently be used. Falls back to the defaults if none are left. */
export function effectiveTypes(settings) {
  const types = settings.generator.types.filter((t) => typeById(t));
  return types.length ? types : [...DEFAULT_TYPES];
}

const pickFrom = (list, rnd) => list[Math.floor(rnd() * list.length)];

/**
 * Picks the next identity. Custom User-Agents win when enabled; otherwise a random
 * enabled device type is generated. Avoids returning the same UA twice in a row.
 */
export function pickIdentity(settings, { hostOs = null, avoidUa = null, rnd = Math.random } = {}) {
  const customs = settings.customUA.enabled ? settings.customUA.list : [];
  if (customs.length) {
    const pool = customs.length > 1 ? customs.filter((ua) => ua !== avoidUa) : customs;
    return identityFromUserAgent(pickFrom(pool, rnd));
  }

  let types = effectiveTypes(settings);
  if (settings.generator.syncOsWithHost && hostOs) {
    const sameOs = types.filter((t) => typeById(t).os === hostOs);
    if (sameOs.length) types = sameOs;
  }

  let identity = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    identity = createGeneratedIdentity(pickFrom(types, rnd), rnd, { ...settings.generator.versions, only: settings.generator.onlyMine });
    if (identity.ua !== avoidUa) break;
  }
  return identity;
}

/** Is the currently-used identity still allowed under the latest settings? */
export function isIdentityAllowed(settings, identity) {
  if (!identity) return false;
  const customs = settings.customUA.enabled ? settings.customUA.list : [];
  if (identity.source === 'custom') return customs.includes(identity.ua);
  if (customs.length) return false;
  return effectiveTypes(settings).includes(identity.typeId);
}
