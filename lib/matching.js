/**
 * Domain / wildcard-rule matching shared by the background worker and the UI pages.
 */

const HOST_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/;

/**
 * Accepts "example.com", "*.example.com", "https://example.com/path", "127.0.0.1", "localhost".
 * Returns the bare lowercase host, or null when the input can't be a host name.
 */
export function normalizeDomain(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/^\*\./, '');
  s = s.split(/[/?#]/)[0];
  s = s.replace(/\.$/, '');
  s = s.replace(/:\d+$/, '');
  if (!HOST_RE.test(s)) return null;
  if (s.split('.').some((label) => label.startsWith('-') || label.endsWith('-'))) return null;
  return s;
}

/** true when host is the domain itself or one of its subdomains. */
export const hostMatchesDomain = (host, domain) => host === domain || host.endsWith(`.${domain}`);

/**
 * Converts a glob ("*" = any run of characters, "?" = one character) into an
 * anchored regular-expression source. Used both for JS checks and for DNR regexFilter
 * (RE2 syntax, so only the characters escaped below are special).
 */
export function globToRegexSource(glob) {
  let out = '^';
  for (const ch of glob) {
    if (ch === '*') out += '.*';
    else if (ch === '?') out += '.';
    else out += ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
  }
  return `${out}$`;
}

export const globToRegExp = (glob) => new RegExp(globToRegexSource(glob), 'i');

/** Parses a URL and returns it only when it is a normal web page (http/https). */
export function parseHttpUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u;
  } catch (_) { /* not a URL */ }
  return null;
}

/** Does the blacklist (domains + wildcard rules) cover this URL? */
export function listCovers(blacklist, url, host) {
  if (blacklist.domains.some((d) => hostMatchesDomain(host, d))) return true;
  return blacklist.rules.some((rule) => globToRegExp(rule).test(url));
}

/**
 * Should the switcher run on this URL?
 * Blacklist mode: everywhere except what is listed. Whitelist mode: only what is listed.
 */
export function isApplicable(settings, url) {
  const u = parseHttpUrl(url);
  if (!u) return false;
  const covered = listCovers(settings.blacklist, url, u.hostname);
  return settings.blacklist.mode === 'blacklist' ? !covered : covered;
}

/**
 * Turns the "Enabled on this domain" switch on or off for a URL.
 * Returns a new settings object plus a warning when the outcome is not what was asked
 * (e.g. the host is covered by a broader entry such as "example.com" for "a.example.com").
 */
export function setDomainEnabled(settings, url, enabled) {
  const u = parseHttpUrl(url);
  const host = u && normalizeDomain(u.hostname);
  if (!u || !host) return { settings, warning: 'This page cannot be changed.' };

  const isBlacklist = settings.blacklist.mode === 'blacklist';
  // Blacklist: an entry means "off". Whitelist: an entry means "on".
  const addEntry = isBlacklist ? !enabled : enabled;
  let domains = settings.blacklist.domains.filter((d) => d !== host);
  if (addEntry) domains = [...domains, host];

  const next = { ...settings, blacklist: { ...settings.blacklist, domains } };
  let warning = null;
  if (isApplicable(next, url) !== enabled) {
    warning = 'This site is covered by a broader rule in Blacklist settings.';
  }
  return { settings: next, warning };
}
