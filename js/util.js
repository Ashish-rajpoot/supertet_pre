/* ===========================================================
   util.js - tiny helpers, base-path detection, lang UI, toast
   =========================================================== */

/** Repo root for this app, e.g. "/" or "/supertet_pre/". Handles any sub-path depth and repo name. */
export const BASE = (() => {
  if (typeof location === 'undefined') return '/';
  const p = location.pathname;
  const idx = p.indexOf('/pages/');
  if (idx >= 0) return p.slice(0, idx + 1);
  return p.endsWith('/') ? p : p.slice(0, p.lastIndexOf('/') + 1);
})();

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Escape text before injecting into HTML. */
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function toast(msg, ms = 2400) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick(arr, n) {
  return shuffle(arr).slice(0, n);
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);

export function uid(prefix = 'q') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function readFileText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsText(file, 'utf-8');
  });
}

export function readFileArrayBuffer(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsArrayBuffer(file);
  });
}

/** Run a callback once the DOM is ready (or immediately if it already is). */
export function ready(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
  else fn();
}

/* ---------------- language preference (hi | en | both) ---------------- */
const LANG_KEY = 'stp.lang';

export function getLang() {
  return localStorage.getItem(LANG_KEY) || 'both';
}
export function setLang(v) {
  localStorage.setItem(LANG_KEY, v);
  document.documentElement.setAttribute('data-lang', v);
  window.dispatchEvent(new CustomEvent('stp:lang', { detail: v }));
}

/** Read one side of a {hi, en} field respecting the language mode. */
export function langOf(obj) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  const l = getLang();
  const hi = (obj.hi || '').trim();
  const en = (obj.en || '').trim();
  if (l === 'hi') return hi || en;
  if (l === 'en') return en || hi;
  return hi || en;
}

/** Both sides, for bilingual display. Returns {hi, en}. */
export function sidesOf(obj) {
  if (obj == null) return { hi: '', en: '' };
  if (typeof obj === 'string') return { hi: obj, en: '' };
  return { hi: (obj.hi || '').trim(), en: (obj.en || '').trim() };
}

/** Render a question field honouring the language mode. */
export function renderField(obj, { cls = 'qtext', enCls = 'qtext en' } = {}) {
  const l = getLang();
  const { hi, en } = sidesOf(obj);
  if (l === 'hi') return `<div class="${cls}">${esc(hi || en)}</div>`;
  if (l === 'en') return `<div class="${cls}">${esc(en || hi)}</div>`;
  if (hi && en && hi !== en) {
    return `<div class="${cls}">${esc(hi)}</div><div class="${enCls}">${esc(en)}</div>`;
  }
  return `<div class="${cls}">${esc(hi || en)}</div>`;
}

/** Build the language switcher into a host element. */
export function mountLangBar(host, { onChange } = {}) {
  if (!host) return;
  const cur = getLang();
  host.innerHTML = `
    <div class="inline" style="justify-content:flex-end">
      <label class="small muted" for="langSel" style="margin:0">Language</label>
      <select id="langSel" style="max-width:170px">
        <option value="both">Hindi + English</option>
        <option value="hi">हिंदी only</option>
        <option value="en">English only</option>
      </select>
    </div>`;
  const sel = host.querySelector('#langSel');
  sel.value = cur;
  sel.addEventListener('change', () => {
    setLang(sel.value);
    if (onChange) onChange(sel.value);
  });
  document.documentElement.setAttribute('data-lang', cur);
}
