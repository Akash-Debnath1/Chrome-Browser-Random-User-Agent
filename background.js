/**
 * Random User-Agent Switcher - background service worker.
 *
 * Owns all state. The popup and options page only send messages here; this file
 * stores settings, picks the next User-Agent, rewrites the DNR rules, and runs the
 * auto-renew alarm. Every operation goes through one queue so they never interleave.
 */
import { defaultSettings, normalizeSettings } from './lib/settings.js';
import { pickIdentity, isIdentityAllowed, hostOsFromPlatform } from './lib/generator.js';
import { describeIdentity } from './lib/devices.js';
import { buildRules } from './lib/rules.js';
import { isApplicable, setDomainEnabled } from './lib/matching.js';

const STORAGE_KEY = 'rua.data';
const RENEW_ALARM = 'rua-renew';
const ICON_ON = { 16: 'assets/icons/16.png', 32: 'assets/icons/32.png', 48: 'assets/icons/48.png', 128: 'assets/icons/128.png' };
const ICON_OFF = { 16: 'assets/icons/16-gray.png', 32: 'assets/icons/32-gray.png', 48: 'assets/icons/48-gray.png', 128: 'assets/icons/128-gray.png' };

// ---------------------------------------------------------------------------
// Serial queue: every read-modify-write runs one at a time.
// ---------------------------------------------------------------------------
let queue = Promise.resolve();
function exclusive(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function readData() {
  const got = await chrome.storage.local.get(STORAGE_KEY);
  const raw = got[STORAGE_KEY] || {};
  return {
    settings: normalizeSettings(raw.settings),
    paused: raw.paused === true,
    current: raw.current && typeof raw.current === 'object' ? raw.current : null,
  };
}

async function writeData(data) {
  await chrome.storage.local.set({ [STORAGE_KEY]: data });
}

async function hostOs() {
  try {
    const info = await chrome.runtime.getPlatformInfo();
    return hostOsFromPlatform(info.os);
  } catch (_) {
    return null;
  }
}

/** Applies the current state: DNR rules, renew alarm, toolbar icon and tooltip. */
async function applyState(data) {
  const active = data.settings.enabled && !data.paused && !!data.current;

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const addRules = active ? buildRules({ settings: data.settings, identity: data.current }) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules,
  });

  await chrome.alarms.clear(RENEW_ALARM);
  if (active && data.settings.renew.enabled) {
    await chrome.alarms.create(RENEW_ALARM, { periodInMinutes: Math.max(data.settings.renew.intervalSec / 60, 0.5) });
  }

  await chrome.action.setIcon({ path: active ? ICON_ON : ICON_OFF });
  const status = !data.settings.enabled ? 'Off' : data.paused ? 'Paused' : 'On';
  await chrome.action.setTitle({
    title: `Random User-Agent (${status})\n${describeIdentity(data.current)}`,
  });
}

async function renew(data) {
  data.current = pickIdentity(data.settings, {
    hostOs: await hostOs(),
    avoidUa: data.current ? data.current.ua : null,
  });
  await writeData(data);
  await applyState(data);
  return data;
}

/** Public view of the state for the UI pages. */
function publicState(data) {
  return {
    settings: data.settings,
    paused: data.paused,
    current: data.current,
    defaults: defaultSettings(),
  };
}

async function ensureInitialised() {
  const data = await readData();
  if (!data.current || !isIdentityAllowed(data.settings, data.current)) {
    return renew(data);
  }
  await writeData(data);
  await applyState(data);
  return data;
}

// ---------------------------------------------------------------------------
// Message API used by popup/options
// ---------------------------------------------------------------------------
async function handleMessage(message) {
  switch (message && message.type) {
    case 'state':
      return { ...publicState(await readData()), bypassed: (await bypassRules()).map(bypassHostOf) };

    case 'clearBypass': {
      await removeBypass(message.host);
      return { bypassed: (await bypassRules()).map(bypassHostOf) };
    }

    case 'saveSettings': {
      const data = await readData();
      const before = JSON.stringify([data.settings.generator.versions, data.settings.generator.onlyMine]);
      data.settings = normalizeSettings(message.settings);
      const versionsChanged = before !== JSON.stringify([data.settings.generator.versions, data.settings.generator.onlyMine]);
      if (versionsChanged || !isIdentityAllowed(data.settings, data.current)) {
        await renew(data);
      } else {
        await writeData(data);
        await applyState(data);
      }
      return publicState(data);
    }

    case 'renew': {
      const data = await renew(await readData());
      return publicState(data);
    }

    case 'setPaused': {
      const data = await readData();
      data.paused = message.paused === true;
      await writeData(data);
      await applyState(data);
      return publicState(data);
    }

    case 'setDomain': {
      const data = await readData();
      const result = setDomainEnabled(data.settings, message.url, message.enabled === true);
      data.settings = result.settings;
      await writeData(data);
      await applyState(data);
      return { ...publicState(data), warning: result.warning || null, applicable: isApplicable(data.settings, message.url) };
    }

    default:
      throw new Error(`Unknown message: ${message && message.type}`);
  }
}

// ---------------------------------------------------------------------------
// Block-page fallback (opt-in). Some bot-protection systems answer 403/429 to a spoofed identity.
// When a main-frame 403 comes back while the switch is on for that site, that host
// gets a session-only rule that leaves its requests alone (real UA), and the tab is
// reloaded once. The rule lasts until the browser restarts or the user retries spoofing.
// ---------------------------------------------------------------------------
const BYPASS_BASE_ID = 900000;

async function bypassRules() {
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  return rules.filter((r) => r.id >= BYPASS_BASE_ID && r.action.type === 'allow');
}

function bypassHostOf(rule) {
  return rule.condition.requestDomains ? rule.condition.requestDomains[0] : '';
}

async function addBypass(host) {
  const used = new Set((await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id));
  let id = BYPASS_BASE_ID;
  while (used.has(id)) id += 1;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [{
      id,
      priority: 3,
      action: { type: 'allow' },
      condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'xmlhttprequest', 'media', 'websocket', 'other'] },
    }],
  });
}

async function removeBypass(host) {
  const hit = (await bypassRules()).filter((r) => bypassHostOf(r) === host);
  if (hit.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: hit.map((r) => r.id) });
}

// 403 = access denied, 429 = rate limited. A 503 is not used: many sites return 503 with a normal page.
const BLOCK_STATUSES = new Set([403, 429]);

chrome.webRequest.onCompleted.addListener((details) => {
  if (!BLOCK_STATUSES.has(details.statusCode)) return;
  let host;
  try { host = new URL(details.url).hostname; } catch (_) { return; }
  exclusive(async () => {
    const data = await readData();
    if (!data.settings.enabled || data.paused || !data.current || !data.settings.blockFallback) return;
    if (!isApplicable(data.settings, details.url)) return;
    if ((await bypassRules()).some((r) => bypassHostOf(r) === host)) return; // already retried: no loop
    await addBypass(host);
    await chrome.tabs.reload(details.tabId);
  });
}, { urls: ['<all_urls>'], types: ['main_frame'] });

// ---------------------------------------------------------------------------
// Event listeners (registered synchronously at top level, as MV3 requires)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  exclusive(() => handleMessage(message))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message ? err.message : err) }));
  return true; // keep the channel open for the async response
});

// Keepalive: content/keepalive.js holds a port open on web pages, which keeps this
// service worker running. The alarm below is a backup that wakes it every 30 s
// when no page is open. Both are harmless if the other is missing.
const KEEPALIVE_PORT = 'rua-keepalive';
const KEEPALIVE_ALARM = 'rua-keepalive';
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== KEEPALIVE_PORT) return;
  port.onMessage.addListener(() => {}); // heartbeat; receiving it resets the idle timer
});
chrome.alarms.get(KEEPALIVE_ALARM).then((alarm) => {
  if (!alarm) chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== RENEW_ALARM) return;
  exclusive(async () => {
    const data = await readData();
    if (data.settings.enabled && !data.paused && data.settings.renew.enabled) {
      await renew(data);
    }
  });
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'renew-useragent') {
    exclusive(async () => renew(await readData()));
  }
});

chrome.runtime.onStartup.addListener(() => {
  exclusive(async () => {
    const data = await readData();
    if (data.settings.renew.onStartup && data.settings.enabled) {
      await renew(data);
    } else {
      await ensureInitialised();
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  exclusive(ensureInitialised);
});

// Every time the worker wakes up, make sure the rules and alarm match the stored state.
exclusive(ensureInitialised);
