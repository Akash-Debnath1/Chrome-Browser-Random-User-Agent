import { BROWSER_GROUPS, describeIdentity } from '../lib/devices.js';
import { isApplicable, parseHttpUrl } from '../lib/matching.js';

const $ = (id) => document.getElementById(id);
let state = null;
let tab = null;

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
  toast.timer = setTimeout(() => { el.hidden = true; }, 2200);
}

async function loadTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = active || null;
}

/** Whether the switcher is actually changing requests for the active tab. */
function siteState(s) {
  const url = tab && tab.url;
  if (!parseHttpUrl(url || '')) return { applicable: false, reason: 'This page cannot be changed.' };
  return { applicable: isApplicable(s.settings, url), reason: null };
}

function statusOf(s) {
  if (!s.settings.enabled) return { key: 'off', badge: 'OFF', text: 'Switcher is off' };
  if (s.paused) return { key: 'paused', badge: 'PAUSED', text: 'Paused – using your real User-Agent' };
  if (!parseHttpUrl((tab && tab.url) || '')) return { key: 'on', badge: 'ACTIVE', text: 'Switching User-Agent on websites' };
  if (!siteState(s).applicable) return { key: 'site-off', badge: 'SITE OFF', text: 'Off on this site – your real User-Agent is used here' };
  return { key: 'on', badge: 'ACTIVE', text: 'Switching User-Agent' };
}

function render() {
  const s = state;
  const status = statusOf(s);

  $('masterToggle').checked = s.settings.enabled;
  $('statusLine').textContent = status.text;

  const badge = $('activeBadge');
  badge.className = `badge ${status.key === 'on' ? 'on' : status.key === 'paused' ? 'paused' : 'off'}`;
  badge.textContent = status.badge;

  const notApplied = status.key !== 'on' || !parseHttpUrl((tab && tab.url) || '');
  $('uaBox').textContent = s.current ? s.current.ua : 'No User-Agent yet – click "Get new agent".';
  $('uaBox').classList.toggle('inactive', notApplied);
  $('uaMeta').textContent = (s.current ? describeIdentity(s.current) : '')
    + (s.current && s.current.source === 'custom' ? ' · custom' : '')
    + (notApplied && s.current ? ' · not applied here' : '');

  const parsed = parseHttpUrl((tab && tab.url) || '');
  const toggle = $('domainToggle');
  if (parsed) {
    toggle.disabled = false;
    toggle.checked = siteState(s).applicable;
    $('domainText').textContent = parsed.hostname;
  } else {
    // Not a website (chrome://, extension pages, new tab): nothing to switch per site,
    // so keep the default ON state visible instead of showing a misleading OFF.
    toggle.disabled = true;
    toggle.checked = true;
    $('domainText').textContent = 'Default ON · open a website to change it';
  }

  $('pauseBtn').textContent = s.paused ? 'Resume switcher' : 'Pause switcher';
  $('renewBtn').disabled = !s.settings.enabled;
  renderChips();
}

function renderChips() {
  const enabled = new Set(state.settings.generator.types);
  for (const [containerId, groups] of [['desktopChips', BROWSER_GROUPS.desktop], ['mobileChips', BROWSER_GROUPS.mobile]]) {
    const box = $(containerId);
    box.replaceChildren();
    for (const group of groups) {
      const on = group.types.some((t) => enabled.has(t));
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = `chip${on ? ' on' : ''}`;
      chip.style.setProperty('--c', group.color);
      chip.title = `${on ? 'Disable' : 'Enable'} ${group.name} User-Agents`;
      chip.innerHTML = '<span class="dot"></span>';
      chip.append(group.name);
      chip.addEventListener('click', () => toggleGroup(group));
      box.append(chip);
    }
  }
}

async function run(task) {
  try {
    await task();
  } catch (err) {
    toast(err.message || String(err), true);
  }
}

async function saveSettings(settings) {
  state = await send({ type: 'saveSettings', settings });
  render();
}

async function toggleGroup(group) {
  const types = new Set(state.settings.generator.types);
  const on = group.types.some((t) => types.has(t));
  if (on) group.types.forEach((t) => types.delete(t));
  else group.types.forEach((t) => types.add(t));
  if (types.size === 0) {
    toast('Keep at least one browser enabled.', true);
    return;
  }
  await saveSettings({ ...state.settings, generator: { ...state.settings.generator, types: [...types] } });
}

async function reloadActiveTab() {
  if (tab && parseHttpUrl(tab.url || '')) {
    await chrome.tabs.reload(tab.id);
  }
}

function bind() {
  $('masterToggle').addEventListener('change', (e) => run(async () => {
    await saveSettings({ ...state.settings, enabled: e.target.checked });
    await reloadActiveTab();
  }));

  $('domainToggle').addEventListener('change', (e) => run(async () => {
    const res = await send({ type: 'setDomain', url: tab.url, enabled: e.target.checked });
    state = { ...state, ...res };
    render();
    if (res.warning) toast(res.warning, true);
    await reloadActiveTab();
    if (!res.warning) toast(e.target.checked ? 'On for this site – page reloaded.' : 'Off for this site – page reloaded.');
  }));

  $('pauseBtn').addEventListener('click', () => run(async () => {
    state = await send({ type: 'setPaused', paused: !state.paused });
    render();
    await reloadActiveTab();
  }));

  $('renewBtn').addEventListener('click', () => run(async () => {
    state = await send({ type: 'renew' });
    render();
    await reloadActiveTab();
    toast('New User-Agent applied.');
  }));

  $('copyBtn').addEventListener('click', () => run(async () => {
    if (!state.current) return;
    await navigator.clipboard.writeText(state.current.ua);
    toast('User-Agent copied.');
  }));

  $('testBtn').addEventListener('click', () => chrome.tabs.create({ url: 'https://www.whatismybrowser.com/detect/what-is-my-user-agent/' }));
  $('settingsBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['rua.data']) {
      run(async () => {
        state = await send({ type: 'state' });
        render();
      });
    }
  });
}

async function init() {
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
  bind();
  await loadTab();
  state = await send({ type: 'state' });
  render();
}

init().catch((err) => {
  $('statusLine').textContent = 'Could not reach the extension';
  toast(err.message || String(err), true);
});
