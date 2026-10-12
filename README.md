<div align="center">

<img src="assets/icons/128.png" width="96" height="96" alt="Random User-Agent logo" />

# Random User-Agent

### A glassmorphism User-Agent switcher for Chromium browsers

Switch your User-Agent to real **Chrome, Edge, Firefox, Opera and Safari** devices, on a timer, on browser start, or on demand.

<p>
  <img alt="Version" src="https://img.shields.io/badge/version-5.0.0-7c5cff?style=for-the-badge" />
  <img alt="Manifest V3" src="https://img.shields.io/badge/Manifest-V3-22d3ee?style=for-the-badge" />
  <img alt="Chromium 120+" src="https://img.shields.io/badge/Chromium-120%2B-4285f4?style=for-the-badge&logo=googlechrome&logoColor=white" />
  <img alt="No build step" src="https://img.shields.io/badge/build-none-10b981?style=for-the-badge" />
</p>

<p>
  <a href="#-quick-start"><b>Quick start</b></a> ·
  <a href="#-features"><b>Features</b></a> ·
  <a href="#-how-it-works"><b>How it works</b></a> ·
  <a href="#-tests"><b>Tests</b></a> ·
  <a href="#-বাংলায়-সংক্ষেপে"><b>বাংলায়</b></a>
</p>

</div>

---

## 🖼️ Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/settings-generator.png" alt="Generator settings with per-browser version cards" /><p align="center"><sub><b>Generator settings</b>: one glass card per browser, with OS switches and your own versions</sub></p></td>
    <td width="50%"><img src="docs/screenshots/settings-general.png" alt="General settings" /><p align="center"><sub><b>General settings</b>: timer, startup change, JavaScript protection, custom User-Agents</sub></p></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/settings-blacklist.png" alt="Blacklist and whitelist settings" /><p align="center"><sub><b>Blacklist / Whitelist</b>: choose where the switcher runs</sub></p></td>
    <td width="50%"><p><b>Popup</b>: active User-Agent with Copy, per-site toggle, device grid, Pause, Get new agent, and a <b>User-Agent test</b> button that opens whatismybrowser.com in a new tab.</p></td>
  </tr>
</table>

---

## ✨ Features

| | Feature | What it does |
|:-:|---|---|
| 🎯 | **Popup** | Active User-Agent with **Copy**, per-site toggle, device grid, **Pause**, **Get new agent**, and **Open settings** |
| 🔍 | **User-Agent test** | One click opens [whatismybrowser.com](https://www.whatismybrowser.com/detect/what-is-my-user-agent/) in a new tab. The extension is ON there by default, so you can see the new User-Agent immediately |
| 🧬 | **Real device identities** | Built-in Chrome, Edge, Firefox, Opera and Safari UAs for Windows, macOS, Linux, Android and iPhone |
| 🔢 | **Your own versions** | Add a version under any browser card (for example Chrome `200`). Built-in versions are included by default |
| 🎚️ | **"Use only my versions"** | Per-browser switch. When on, only your versions are used for that browser |
| ⏱️ | **Auto-change timer** | Renew every N seconds (default 600 s, minimum 30 s) |
| 🚀 | **Change on start** | Pick a new identity each time the browser starts |
| ⌨️ | **Keyboard shortcut** | `Ctrl+Shift+U` (`Cmd+Shift+U` on macOS) renews the User-Agent |
| 🛡️ | **JavaScript protection** | Makes `navigator` values (`userAgent`, `userAgentData`, `platform`, `vendor`, `maxTouchPoints`) match the chosen identity |
| 🚫 | **Blacklist / Whitelist** | Blacklist mode (everywhere except listed sites) or whitelist mode (only listed sites). Supports subdomains and wildcard URL rules |
| 📝 | **Custom User-Agents** | Add your own strings, one per line. Must be printable ASCII, 10–1000 characters, with a `Product/Version` token |
| 🪟 | **Glassmorphism UI** | Modern glass cards, gradients and soft glow across the popup and settings page |

### Generator settings

Each browser has its own card. Turn OS targets on or off, and add versions:

| Browser | Version you can add | Example |
|---|---|---|
| Chrome, Edge, Firefox | 50–999 | `200` |
| Opera | Opera's own number (Chromium − 16) | `130` |
| Safari | 10–40, as `x` or `x.y` | `26.8` |

---

## 🚀 Quick start

1. Download the zip, or clone this repository.
2. Open `chrome://extensions` (or `edge://extensions`, `opera://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.
5. Open the popup, click **User-Agent test**, and check the User-Agent on whatismybrowser.com.

Requires **Chromium 120+**.

---

## ⚙️ How it works

```
 Browser request ──► declarativeNetRequest ──► User-Agent + Sec-CH-UA* rewritten
                                               (per identity, per site rules)
 Page script     ──► content/inject.js (MAIN world) ──► navigator.* matches identity
 Timer / start / ──► background.js (service worker) ──► picks a new identity
 shortcut
```

- **Headers**: `User-Agent` and `Sec-CH-UA*` headers are rewritten with `declarativeNetRequest` dynamic rules. Client Hints such as full version, platform version, architecture and model are removed where they would reveal the real browser.
- **JavaScript**: Chromium-family identities also get matching `navigator.userAgentData`. Firefox and Safari identities remove it, as those browsers do.
- **Frames**: header and `navigator` changes also apply to iframes and `about:blank` frames.
- **Storage**: all settings live in `chrome.storage.local`. Nothing is sent to a server.

> [!NOTE]
> UA spoofing can't make Chromium indistinguishable from Firefox or Safari under deep fingerprinting. Rendering, JavaScript engine and font behaviour still reveal the real engine. Web Workers also still report the real `navigator.userAgent`, because extension content scripts don't run inside workers.

---

## 🗂️ Project layout

```
manifest.json, background.js     service worker: state, rules, alarm, messages
lib/devices.js                   built-in real device UAs, version pools, custom UA parsing
lib/profile.js                   navigator / userAgentData profile per identity
lib/rules.js                     declarativeNetRequest rule builder
lib/matching.js                  domain and wildcard matching
lib/generator.js                 random pick from enabled types and versions
lib/settings.js                  defaults, normalisation, validation
content/inject.js                MAIN-world navigator patch
popup/  options/  shared/        UI (glass theme in shared/ui.css)
assets/icons/                    toolbar icons (on / gray)
docs/screenshots/                images used in this README
tests/unit.mjs                   unit tests
tests/e2e/                       end-to-end tests (Playwright + Chromium)
```

---

## 🧪 Tests

**Unit tests** (no dependencies):

```bash
node tests/unit.mjs
```

**End-to-end tests** (Playwright + Chromium):

```bash
npm i playwright
npx playwright install chromium
node tests/e2e/server.mjs          # serves 127.0.0.1:8080
node tests/e2e/e2e.mjs             # headless
HEADFUL=1 DISPLAY=:99 node tests/e2e/e2e.mjs   # headful, also checks Ctrl+Shift+U
```

The e2e test maps `*.test` hosts to `127.0.0.1:8080` with `--host-resolver-rules`.

---

## 🔐 Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest` | Rewrite request headers (User-Agent, Client Hints) |
| `storage` | Save your settings locally |
| `alarms` | Run the auto-change timer |
| `<all_urls>` (host) | Apply the User-Agent on every site |

---

<details>
<summary><h2>🇧🇩 বাংলায় সংক্ষেপে</h2></summary>

**Random User-Agent** একটি Chromium এক্সটেনশন। এটি আপনার ব্রাউজারের User-Agent বাস্তব Chrome, Edge, Firefox, Opera ও Safari ডিভাইসের মতো করে বদলায়।

- **User-Agent test** বাটনে ক্লিক করলে whatismybrowser.com নতুন ট্যাবে খোলে। সেখানে এক্সটেনশন ডিফল্টভাবে ON থাকে, তাই আপনি সরাসরি বদলানো User-Agent দেখতে পারবেন।
- **Generator settings**-এ প্রতিটি ব্রাউজারের কার্ডে নিজের ভার্সন যোগ করা যায়, যেমন Chrome-এর জন্য `200`।
- **"Use only my versions"** চালু করলে ওই ব্রাউজারের জন্য শুধু আপনার যোগ করা ভার্সন ব্যবহৃত হয়।
- `Ctrl+Shift+U` দিলে নতুন User-Agent নেওয়া হয়।
- সব সেটিংস শুধু আপনার ব্রাউজারে (`chrome.storage.local`) থাকে, কোথাও পাঠানো হয় না।

**সীমাবদ্ধতা:** গভীর fingerprinting-এ Chromium-কে Firefox বা Safari-র মতো হুবহু দেখানো সম্ভব নয়। Web Worker-এর `navigator.userAgent` এখনো আসল UA দেখায়।

</details>

---

<div align="center">

Made with ❤️ Engr.Akash Debnath · Plain JavaScript and CSS, no build step

</div>
