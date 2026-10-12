import { DEFAULT_TYPES, isKnownType, parseVersionInput, VERSION_FAMILIES } from './devices.js';
import { normalizeDomain } from './matching.js';

export const LIMITS = Object.freeze({
  intervalMin: 30,            // seconds (Chrome alarms can't fire faster than this)
  intervalMax: 7 * 24 * 3600,
  customUA: 300,
  versions: 30,               // user-added versions per browser
  domains: 500,
  rules: 200,
});

export function defaultSettings() {
  return {
    enabled: true,
    renew: { enabled: true, intervalSec: 600, onStartup: true },
    jsProtection: true,
    customUA: { enabled: false, list: [] },
    generator: { types: [...DEFAULT_TYPES], syncOsWithHost: false, versions: emptyVersions(), onlyMine: emptyFlags() },
    blacklist: {
      mode: 'blacklist',
      domains: ['localhost', '127.0.0.1'],
      rules: ['chrome://*', 'file://*'],
    },
  };
}

const isPrintableAscii = (s) => /^[\x20-\x7e]+$/.test(s);
/** A User-Agent must be printable ASCII, 10–1000 chars, and contain at least one Product/Version token. */
export const isValidUserAgent = (s) => s.length >= 10 && s.length <= 1000 && isPrintableAscii(s) && /\S\/\S/.test(s);
export const isValidRule = (s) => s.length > 0 && s.length <= 300 && isPrintableAscii(s);

/** Splits a textarea value into trimmed, non-empty, de-duplicated lines. */
export function splitLines(value) {
  const lines = Array.isArray(value) ? value : String(value ?? '').split(/\r?\n/);
  return [...new Set(lines.map((l) => String(l).trim()).filter(Boolean))];
}

/** One empty list per browser family. */
function emptyVersions() {
  return Object.fromEntries(VERSION_FAMILIES.map((f) => [f, []]));
}

/** One false flag per browser family. */
function emptyFlags() {
  return Object.fromEntries(VERSION_FAMILIES.map((f) => [f, false]));
}

function normalizeFlags(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(VERSION_FAMILIES.map((f) => [f, src[f] === true]));
}

/** Keeps only valid, de-duplicated user versions for each family. */
function normalizeVersions(raw) {
  const out = emptyVersions();
  const src = raw && typeof raw === 'object' ? raw : {};
  for (const family of VERSION_FAMILIES) {
    const list = Array.isArray(src[family]) ? src[family] : [];
    out[family] = [...new Set(list.map((v) => parseVersionInput(family, v)).filter(Boolean))].slice(0, LIMITS.versions);
  }
  return out;
}

const toBool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

function toInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Validates and fills in any setting that is missing or malformed. Never throws,
 * so a corrupted storage entry can't break the extension.
 */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  const r = raw && typeof raw === 'object' ? raw : {};
  const renew = r.renew && typeof r.renew === 'object' ? r.renew : {};
  const custom = r.customUA && typeof r.customUA === 'object' ? r.customUA : {};
  const gen = r.generator && typeof r.generator === 'object' ? r.generator : {};
  const bl = r.blacklist && typeof r.blacklist === 'object' ? r.blacklist : {};

  const types = Array.isArray(gen.types) ? gen.types.filter(isKnownType) : d.generator.types;
  const domainsRaw = Array.isArray(bl.domains) ? bl.domains : d.blacklist.domains;
  const rulesRaw = Array.isArray(bl.rules) ? bl.rules : d.blacklist.rules;
  const customList = Array.isArray(custom.list) ? custom.list : [];

  return {
    enabled: toBool(r.enabled, d.enabled),
    renew: {
      enabled: toBool(renew.enabled, d.renew.enabled),
      intervalSec: toInt(renew.intervalSec, LIMITS.intervalMin, LIMITS.intervalMax, d.renew.intervalSec),
      onStartup: toBool(renew.onStartup, d.renew.onStartup),
    },
    jsProtection: toBool(r.jsProtection, d.jsProtection),
    customUA: {
      enabled: toBool(custom.enabled, false),
      list: splitLines(customList).filter(isValidUserAgent).slice(0, LIMITS.customUA),
    },
    generator: {
      types: [...new Set(types)],
      syncOsWithHost: toBool(gen.syncOsWithHost, false),
      versions: normalizeVersions(gen.versions),
      onlyMine: normalizeFlags(gen.onlyMine),
    },
    blacklist: {
      mode: bl.mode === 'whitelist' ? 'whitelist' : 'blacklist',
      domains: [...new Set(domainsRaw.map(normalizeDomain).filter(Boolean))].slice(0, LIMITS.domains),
      rules: splitLines(rulesRaw).filter(isValidRule).slice(0, LIMITS.rules),
    },
  };
}
