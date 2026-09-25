/* ===========================================================
   app.js - shared shell: base path, nav, theme, settings, toast
   =========================================================== */

import { BASE, $, $$, esc, toast, getLang, setLang, ready } from './util.js';
import { getSettings, saveSettings } from './store.js';

export { BASE, $, $$, esc, toast, ready };

const LANG_LABELS = [
  ['both', 'हिंदी + English'],
  ['hi', 'हिंदी'],
  ['en', 'English'],
];

/** Links shown in the top nav. */
export const NAV = [
  { href: 'index.html', label: 'Home' },
  { href: 'pages/flashcards.html', label: 'Flashcards' },
  { href: 'pages/test.html', label: 'Test' },
  { href: 'pages/analytics.html', label: 'Analytics' },
  { href: 'pages/manage.html', label: 'Questions' },
];

/** Apply the saved theme (auto follows the device). */
export function applyTheme() {
  const s = getSettings();
  const mode = s.theme || 'auto';
  let dark = false;
  if (mode === 'dark') dark = true;
  else if (mode === 'auto' && window.matchMedia) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function cycleTheme() {
  const s = getSettings();
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(s.theme || 'auto') + 1) % order.length];
  saveSettings({ theme: next });
  applyTheme();
  const btn = $('#themeBtn');
  if (btn) btn.textContent = next === 'auto' ? 'Auto' : (next === 'light' ? 'Light' : 'Dark');
  toast('Theme: ' + next);
}

/** Build the sticky top bar + footer into <header id="top"> and <footer id="foot">. */
export function mountChrome({ title = 'SuperTET Prep', active = 'index.html' } = {}) {
  const top = $('#top');
  if (top) {
    const links = NAV.map(n => {
      const isActive = active === n.href || (active.startsWith('pages/') && n.href === active);
      return '<a href="' + BASE + n.href + '" class="' + (isActive ? 'active' : '') + '">' + esc(n.label) + '</a>';
    }).join('');
    const langOpts = LANG_LABELS.map(([v, label]) =>
      '<option value="' + v + '"' + (getLang() === v ? ' selected' : '') + '>' + label + '</option>').join('');
    top.className = 'topbar';
    top.innerHTML =
      '<div class="topbar-inner">' +
        '<a class="brand" href="' + BASE + 'index.html">Super<span>TET</span> Prep</a>' +
        '<span class="spacer"></span>' +
        '<select id="langSel" title="Language" style="max-width:150px">' + langOpts + '</select>' +
        '<button id="themeBtn" class="btn sm ghost" type="button" title="Switch theme">Auto</button>' +
        '<nav class="nav">' + links + '</nav>' +
      '</div>';
    $('#themeBtn').addEventListener('click', cycleTheme);
    $('#langSel').addEventListener('change', e => {
      setLang(e.target.value);
      // questions are rendered by each page; reload keeps things simple and consistent
      location.reload();
    });
  }
  const foot = $('#foot');
  if (foot) {
    foot.className = 'footer';
    foot.innerHTML = '<span>' + esc(title) + ' &middot; works offline &middot; your data stays on this device</span>';
  }
  applyTheme();
}

/** Register the service worker so the site works offline (needs http/https). */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(e => console.warn('SW failed', e));
  });
}

/** Small helper: read ?id= from the URL. */
export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Render an error box inside a container. */
export function errorBox(host, err) {
  if (!host) return;
  host.innerHTML = '<div class="card"><h3>Something went wrong</h3><p class="muted small">' +
    esc(err && err.message ? err.message : err) + '</p></div>';
}

/** Render a list of {label, value} as simple rows. */
export function rowsHtml(rows) {
  return rows.map(r => '<div class="row"><span class="grow">' + esc(r.label) + '</span>' +
    '<span class="pill">' + esc(r.value) + '</span></div>').join('');
}

/* Register the offline worker once per page load. */
registerSW();

