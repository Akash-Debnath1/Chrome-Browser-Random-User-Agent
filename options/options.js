import { DEVICE_TYPES, describeIdentity, builtinVersionLabels, parseVersionInput, VERSION_FAMILY_INFO } from '../lib/devices.js';
import { normalizeDomain } from '../lib/matching.js';
import { defaultSettings, isValidRule, isValidUserAgent, LIMITS, splitLines } from '../lib/settings.js';

const $ = (id) => document.getElementById(id);
const EXAMPLE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';

/** Browser cards on the Generator page. Each card owns its OS toggles and its version field. */
const DESKTOP_CARDS = [
  { family: 'chrome', name: 'Chrome', color: '#4285f4', types: [['chrome_win', 'Windows'], ['chrome_mac', 'macOS'], ['chrome_linux', 'Linux']] },
  { family: 'edge', name: 'Edge', color: '#0f9ad8', types: [['edge_win', 'Windows'], ['edge_mac', 'macOS']] },
  { family: 'firefox', name: 'Firefox', color: '#ff7139', types: [['firefox_win', 'Windows'], ['firefox_mac', 'macOS'], ['firefox_linux', 'Linux']] },
  { family: 'opera', name: 'Opera', color: '#ff1b2d', types: [['opera_win', 'Windows'], ['opera_mac', 'macOS']] },
  { family: 'safari', name: 'Safari', color: '#1b8cf0', types: [['safari_mac', 'macOS']] },
];
const MOBILE_CARDS = [
  { family: 'chrome', name: 'Chrome', color: '#4285f4', types: [['chrome_android', 'Android']] },
  { family: 'firefox', name: 'Firefox', color: '#ff7139', types: [['firefox_android', 'Android']] },
  { family: 'safari', name: 'Safari', color: '#1b8cf0', types: [['safari_iphone', 'iPhone']] },
];

let baseline = null;   // draft as last saved
let draft = null;      // what the form currently shows

const send = async (message) => {
  const res = await chrome.runtime.sendMessage(message);
  if (!res || !res.ok) throw new Error((res && res.error) || 'No response from the extension');
  return res.result;
};

function toast(text, isError = false) {
  const el = $('toast');
  el.textContent = text;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2800);
}

/** Converts saved settings into the editable form shape (textareas hold raw text). */
function toDraft(s) {
  return {
    enabled: s.enabled,
    renew: { ...s.renew },
    jsProtection: s.jsProtection,
    blockFallback: s.blockFallback,
    customUA: { enabled: s.customUA.enabled, text: s.customUA.list.join('\n') },
    generator: {
      types: [...s.generator.types],
      syncOsWithHost: s.generator.syncOsWithHost,
      versions: JSON.parse(JSON.stringify(s.generator.versions)),
      onlyMine: { ...s.generator.onlyMine },
    },
    blacklist: {
      mode: s.blacklist.mode,
      domains: s.blacklist.domains.join('\n'),
      rules: s.blacklist.rules.join('\n'),
    },
  };
}

/** Parses the form into settings; returns { settings } or { problems }. */
function fromDraft(d) {
  const errors = [];

  const interval = Number(d.renew.intervalSec);
  if (!Number.isInteger(interval) || interval < LIMITS.intervalMin || interval > LIMITS.intervalMax) {
    errors.push(`Interval must be a whole number of seconds between ${LIMITS.intervalMin} and ${LIMITS.intervalMax}.`);
  }

  const customLines = splitLines(d.customUA.text);
  const badUa = customLines.filter((l) => !isValidUserAgent(l));
  if (badUa.length) errors.push(`Not valid User-Agent lines: ${badUa.slice(0, 3).join(' | ')}${badUa.length > 3 ? ' …' : ''}`);
  if (customLines.length > LIMITS.customUA) errors.push(`At most ${LIMITS.customUA} custom User-Agents.`);

  const domainLines = splitLines(d.blacklist.domains);
  const domains = domainLines.map((l) => normalizeDomain(l));
  const badDomains = domainLines.filter((_, i) => !domains[i]);
  if (badDomains.length) errors.push(`Not valid domain names: ${badDomains.slice(0, 3).join(', ')}${badDomains.length > 3 ? ' …' : ''}`);
  if (domainLines.length > LIMITS.domains) errors.push(`At most ${LIMITS.domains} domains.`);

  const ruleLines = splitLines(d.blacklist.rules);
  const badRules = ruleLines.filter((l) => !isValidRule(l));
  if (badRules.length) errors.push(`Not valid rules: ${badRules.slice(0, 3).join(' | ')}`);

  if (errors.length) return { problems: errors };

  return {
    settings: {
      enabled: d.enabled,
      renew: { enabled: d.renew.enabled, intervalSec: interval, onStartup: d.renew.onStartup },
      jsProtection: d.jsProtection,
      blockFallback: d.blockFallback,
      customUA: { enabled: d.customUA.enabled, list: customLines },
      generator: {
        types: d.generator.types,
        syncOsWithHost: d.generator.syncOsWithHost,
        versions: d.generator.versions,
        onlyMine: d.generator.onlyMine,
      },
      blacklist: {
        mode: d.blacklist.mode,
        domains: [...new Set(domains.filter(Boolean))],
        rules: ruleLines,
      },
    },
  };
}

const isDirty = () => JSON.stringify(draft) !== JSON.stringify(baseline);

/* ---------- generator cards ---------- */

function buildCards(container, cards) {
  for (const card of cards) {
    const el = document.createElement('article');
    el.className = 'glass brand-card';
    el.style.setProperty('--c', card.color);
    el.dataset.family = card.family;

    const head = document.createElement('header');
    head.innerHTML = '<span class="dot"></span><h3></h3><span class="count"></span>';
    head.querySelector('h3').textContent = card.name;

    const list = document.createElement('div');
    list.className = 'os-list';
    for (const [typeId, label] of card.types) {
      const row = document.createElement('label');
      row.className = 'os-row';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = label;
      const sw = document.createElement('span');
      sw.className = 'switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.type = typeId;
      const track = document.createElement('span');
      track.className = 'track';
      sw.append(input, track);
      row.append(name, sw);
      list.append(row);
    }

    const versions = document.createElement('div');
    versions.className = 'versions';
    const info = VERSION_FAMILY_INFO[card.family];
    versions.innerHTML = `
      <div class="versions-head"><span class="label">Versions</span><span class="built-in"></span></div>
      <label class="only-row">
        <span><span class="name">Use only my versions</span><span class="only-hint">Built-in versions are skipped</span></span>
        <span class="switch"><input type="checkbox" data-only="${card.family}" /><span class="track"></span></span>
      </label>
      <div class="vchips"></div>
      <form class="version-add">
        <input type="text" inputmode="numeric" autocomplete="off" spellcheck="false" maxlength="5"
               data-version-input="${card.family}" aria-label="Add a ${info.name} version" />
        <button type="submit" class="btn small primary" data-add="${card.family}">Add version</button>
      </form>`;
    versions.querySelector('.built-in').textContent = `Built-in: ${builtinVersionLabels(card.family).join(', ')}`;
    versions.querySelector('input').placeholder = info.hint;

    el.append(head, list, versions);
    container.append(el);
  }
}

function renderGenerator() {
  for (const el of document.querySelectorAll('.brand-card')) {
    const family = el.dataset.family;
    const inputs = [...el.querySelectorAll('input[data-type]')];
    let on = 0;
    for (const input of inputs) {
      const checked = draft.generator.types.includes(input.dataset.type);
      input.checked = checked;
      input.closest('.os-row').classList.toggle('off', !checked);
      if (checked) on += 1;
    }
    el.querySelector('.count').textContent = `${on}/${inputs.length} on`;
    const only = el.querySelector('input[data-only]');
    only.checked = draft.generator.onlyMine[family] === true;
    only.closest('.only-row').classList.toggle('active', only.checked);

    const chips = el.querySelector('.vchips');
    chips.replaceChildren(...draft.generator.versions[family].map((v) => {
      const chip = document.createElement('span');
      chip.className = 'vchip';
      chip.append(v);
      const x = document.createElement('button');
      x.type = 'button';
      x.dataset.remove = v;
      x.setAttribute('aria-label', `Remove ${v}`);
      x.textContent = '×';
      chip.append(x);
      return chip;
    }));
  }
}

function addVersion(family, cardEl) {
  const info = VERSION_FAMILY_INFO[family];
  const input = cardEl.querySelector('input[data-version-input]');
  const parsed = parseVersionInput(family, input.value);
  if (!parsed) {
    toast(`Enter a valid ${info.name} version (${info.hint.replace('e.g. ', '')}).`, true);
    return;
  }
  if (builtinVersionLabels(family).includes(parsed)) {
    toast(`${info.name} ${parsed} is already built in.`, true);
    return;
  }
  const list = draft.generator.versions[family];
  if (list.includes(parsed)) {
    toast(`${info.name} ${parsed} is already added.`, true);
    return;
  }
  if (list.length >= LIMITS.versions) {
    toast(`At most ${LIMITS.versions} extra versions per browser.`, true);
    return;
  }
  draft.generator.versions[family] = [...list, parsed];
  input.value = '';
  renderForm();
  toast(`${info.name} ${parsed} added. Press Save changes to use it.`);
}

/* ---------- form ---------- */

function renderForm() {
  $('enabled').checked = draft.enabled;
  $('renewEnabled').checked = draft.renew.enabled;
  $('intervalSec').value = draft.renew.intervalSec;
  $('intervalSec').disabled = !draft.renew.enabled;
  $('onStartup').checked = draft.renew.onStartup;
  $('jsProtection').checked = draft.jsProtection;
  $('blockFallback').checked = draft.blockFallback;

  $('customEnabled').checked = draft.customUA.enabled;
  $('customList').value = draft.customUA.text;
  const customCount = splitLines(draft.customUA.text).length;
  $('customCount').textContent = `${customCount} User-Agent${customCount === 1 ? '' : 's'}${draft.customUA.enabled && customCount === 0 ? ' – none yet, generated ones are used' : ''}`;

  $('syncOs').checked = draft.generator.syncOsWithHost;
  renderGenerator();

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.checked = radio.value === draft.blacklist.mode;
  }
  $('modeHint').textContent = draft.blacklist.mode === 'blacklist'
    ? 'Blacklist mode: the switcher is ON everywhere, except the domains and rules listed below.'
    : 'Whitelist mode: the switcher is OFF everywhere, except the domains and rules listed below.';
  $('domains').value = draft.blacklist.domains;
  $('rules').value = draft.blacklist.rules;

  const dirty = isDirty();
  $('saveBtn').disabled = !dirty;
  $('savebar').classList.toggle('dirty', dirty);
  $('dirtyText').textContent = dirty ? 'You have unsaved changes' : 'All changes saved';
}

function bindForm() {
  $('enabled').addEventListener('change', (e) => { draft.enabled = e.target.checked; renderForm(); });
  $('renewEnabled').addEventListener('change', (e) => { draft.renew.enabled = e.target.checked; renderForm(); });
  $('intervalSec').addEventListener('input', (e) => { draft.renew.intervalSec = e.target.value; renderForm(); });
  for (const btn of document.querySelectorAll('[data-interval]')) {
    btn.addEventListener('click', () => { draft.renew.intervalSec = Number(btn.dataset.interval); renderForm(); });
  }
  $('onStartup').addEventListener('change', (e) => { draft.renew.onStartup = e.target.checked; renderForm(); });
  $('jsProtection').addEventListener('change', (e) => { draft.jsProtection = e.target.checked; renderForm(); });
  $('blockFallback').addEventListener('change', (e) => { draft.blockFallback = e.target.checked; renderForm(); });

  $('customEnabled').addEventListener('change', (e) => { draft.customUA.enabled = e.target.checked; renderForm(); });
  $('customList').addEventListener('input', (e) => { draft.customUA.text = e.target.value; renderForm(); });
  $('customPasteExample').addEventListener('click', () => {
    draft.customUA.text = [draft.customUA.text.trimEnd(), EXAMPLE_UA].filter(Boolean).join('\n');
    renderForm();
  });
  $('customClear').addEventListener('click', () => { draft.customUA.text = ''; renderForm(); });

  $('syncOs').addEventListener('change', (e) => { draft.generator.syncOsWithHost = e.target.checked; renderForm(); });
  $('selectAll').addEventListener('click', () => { draft.generator.types = DEVICE_TYPES.map((t) => t.id); renderForm(); });
  $('clearAll').addEventListener('click', () => { draft.generator.types = []; renderForm(); });
  $('useDefaults').addEventListener('click', () => { draft.generator.types = toDraft(defaultSettings()).generator.types; renderForm(); });

  // delegated handlers for the browser cards
  for (const container of [$('desktopTypes'), $('mobileTypes')]) {
    container.addEventListener('change', (e) => {
      const input = e.target;
      if (input.matches('input[data-only]')) {
        draft.generator.onlyMine[input.dataset.only] = input.checked;
        renderForm();
        return;
      }
      if (!input.matches('input[data-type]')) return;
      const set = new Set(draft.generator.types);
      if (input.checked) set.add(input.dataset.type); else set.delete(input.dataset.type);
      draft.generator.types = [...set];
      renderForm();
    });
    container.addEventListener('submit', (e) => {
      const form = e.target;
      if (!form.matches('.version-add')) return;
      e.preventDefault();
      const card = form.closest('.brand-card');
      addVersion(card.dataset.family, card);
    });
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const card = btn.closest('.brand-card');
      const family = card.dataset.family;
      draft.generator.versions[family] = draft.generator.versions[family].filter((v) => v !== btn.dataset.remove);
      renderForm();
    });
  }

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', () => { if (radio.checked) { draft.blacklist.mode = radio.value; renderForm(); } });
  }
  $('domains').addEventListener('input', (e) => { draft.blacklist.domains = e.target.value; renderForm(); });
  $('enableAllSites').addEventListener('click', () => {
    draft.blacklist.mode = 'blacklist';
    draft.blacklist.domains = 'localhost\n127.0.0.1';
    draft.blacklist.rules = 'chrome://*\nfile://*';
    renderForm();
    toast('Blacklist mode with no site rules. Click Save changes.');
  });
  $('rules').addEventListener('input', (e) => { draft.blacklist.rules = e.target.value; renderForm(); });

  $('saveBtn').addEventListener('click', async () => {
    const result = fromDraft(draft);
    if (result.problems) { toast(result.problems.join(' '), true); return; }
    try {
      const saved = await send({ type: 'saveSettings', settings: result.settings });
      baseline = toDraft(saved.settings);
      draft = JSON.parse(JSON.stringify(baseline));
      renderForm();
      renderCurrent(saved.current);
      toast('Settings saved.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('resetBtn').addEventListener('click', () => {
    draft = toDraft(defaultSettings());
    renderForm();
    toast('Defaults restored – press Save changes to keep them.');
  });

  $('renewBtn').addEventListener('click', async () => {
    try {
      const saved = await send({ type: 'renew' });
      renderCurrent(saved.current);
      toast('New User-Agent generated.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
  });
}

function renderCurrent(identity) {
  $('currentUa').textContent = identity
    ? `${identity.ua}\n\n${describeIdentity(identity)}`
    : 'None yet';
}

/** Sidebar navigation between the three sections, driven by the URL hash. */
function bindTabs() {
  const show = () => {
    const name = (location.hash || '#general').slice(1);
    const tab = ['general', 'generator', 'blacklist'].includes(name) ? name : 'general';
    for (const section of document.querySelectorAll('.tab')) {
      section.hidden = section.dataset.section !== tab;
    }
    for (const link of document.querySelectorAll('nav a')) {
      link.classList.toggle('active', link.dataset.tab === tab);
    }
  };
  window.addEventListener('hashchange', show);
  show();
}

async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  buildCards($('desktopTypes'), DESKTOP_CARDS);
  buildCards($('mobileTypes'), MOBILE_CARDS);
  bindTabs();
  bindForm();

  const state = await send({ type: 'state' });
  baseline = toDraft(state.settings);
  draft = JSON.parse(JSON.stringify(baseline));
  renderForm();
  renderCurrent(state.current);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes['rua.data']) return;
    send({ type: 'state' }).then((s) => renderCurrent(s.current)).catch(() => {});
  });
}

init().catch((err) => toast(err.message || String(err), true));
