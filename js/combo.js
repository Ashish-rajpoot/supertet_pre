/* ===========================================================
   combo.js - a tiny searchable dropdown (combobox), no build step.

   The Questions page uses it for the Subject and Topic boxes of the
   "Or let an AI write the questions for you" card, so the prompt can
   name a real syllabus subject/topic instead of a guess.

   Markup the page must provide (a span keeps it valid inside a label):

     <span class="combo">
       <input type="text" id="x" role="combobox" aria-expanded="false"
              aria-autocomplete="list" aria-controls="xList" autocomplete="off">
       <span class="combo-list hidden" id="xList" role="listbox"></span>
     </span>

   A choice is a plain string or { value, label, sub }: `label` is what
   the user sees, `sub` is the small grey hint (Hindi name, "already in
   your bank", ...) and `value` is what the box gets filled with.
   =========================================================== */

import { esc } from './util.js';

/** Normalise a string / { value, label, sub } choice. Returns null for an empty option. */
export function choice(opt) {
  if (opt == null) return null;
  if (typeof opt === 'string') {
    const v = opt.trim();
    return v ? { value: v, label: v, sub: '' } : null;
  }
  const value = String(opt.value == null ? opt.label || '' : opt.value).trim();
  if (!value) return null;
  return {
    value,
    label: String(opt.label == null ? value : opt.label),
    sub: String(opt.sub == null ? '' : opt.sub),
  };
}

/**
 * Choices matching what the user typed. An empty query keeps everything, in the
 * order the caller supplied. Searching also covers the hint, so a Hindi name
 * finds the English topic and the other way round.
 */
export function filterMatches(options, query, limit = 60) {
  const list = Array.isArray(options) ? options : [];
  const q = String(query == null ? '' : query).trim().toLowerCase();
  const max = Number(limit) > 0 ? Number(limit) : Infinity;
  const out = [];
  for (const opt of list) {
    const c = choice(opt);
    if (!c) continue;
    if (q && (c.label + ' ' + c.sub + ' ' + c.value).toLowerCase().indexOf(q) === -1) continue;
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Turn an input into a searchable dropdown.
 *
 * @param {HTMLInputElement} input  the text box the user types in
 * @param {HTMLElement} listEl      the (initially hidden) listbox under it
 * @param {object} [opts]
 * @param {function} opts.getOptions  returns the choices to search; called on every open
 * @param {number}  [opts.limit]      how many rows to show at most (default 60)
 * @param {string}  [opts.emptyText]  message when nothing matches
 * @param {function} [opts.onPick]    called with (value, choice) after a row is picked
 * @returns {{open, close, refresh, destroy}|null}
 */
export function attachSearch(input, listEl, { getOptions, limit = 60, emptyText = 'No match - you can still type your own value.', onPick } = {}) {
  if (!input || !listEl) return null;

  let shown = [];       // choices currently rendered
  let active = -1;      // index of the highlighted row
  let isOpen = false;
  let suppressInput = false;   // set while we fill the box ourselves, so it does not reopen

  const allOptions = () => {
    if (typeof getOptions !== 'function') return [];
    try { return getOptions() || []; } catch (_e) { return []; }
  };

  function render() {
    shown = filterMatches(allOptions(), input.value, limit);
    if (active >= shown.length) active = shown.length - 1;
    listEl.innerHTML = shown.length
      ? shown.map((c, i) =>
        '<button class="combo-opt' + (i === active ? ' active' : '') + '" type="button" role="option" data-i="' + i +
        '" aria-selected="' + (i === active) + '">' +
        esc(c.label) +
        (c.sub && c.sub !== c.label ? '<span class="combo-sub">' + esc(c.sub) + '</span>' : '') +
        '</button>').join('')
      : '<span class="combo-empty">' + esc(emptyText) + '</span>';
  }

  function open() {
    if (!isOpen) {
      isOpen = true;
      listEl.classList.remove('hidden');
      input.setAttribute('aria-expanded', 'true');
    }
    render();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    active = -1;
    shown = [];
    listEl.classList.add('hidden');
    listEl.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
  }

  /** Move the highlight `index` rows away, wrapping around both ends. */
  function highlight(index) {
    if (!shown.length) return;
    active = ((index % shown.length) + shown.length) % shown.length;
    render();
    const row = listEl.querySelector('.combo-opt.active');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  /** Fill the box with a row's value - the page's own listeners see a normal typing event. */
  function pick(i) {
    const c = shown[i];
    if (!c) return;
    suppressInput = true;
    input.value = c.value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    suppressInput = false;
    close();
    if (typeof onPick === 'function') onPick(c.value, c);
  }

  input.addEventListener('input', () => { if (!suppressInput) open(); });
  input.addEventListener('focus', open);
  input.addEventListener('click', open);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) open();
      highlight(active + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) open();
      highlight(active < 0 ? shown.length - 1 : active - 1);
    } else if (e.key === 'Enter') {
      if (isOpen && active >= 0) { e.preventDefault(); pick(active); }
    } else if (e.key === 'Escape') {
      if (isOpen) { e.preventDefault(); close(); }
    } else if (e.key === 'Tab') {
      close();
    }
  });

  // Keep the focus in the box while clicking a row, then pick it.
  listEl.addEventListener('mousedown', (e) => {
    if (e.target && e.target.closest && e.target.closest('.combo-opt')) e.preventDefault();
  });
  listEl.addEventListener('click', (e) => {
    const row = e.target && e.target.closest ? e.target.closest('.combo-opt') : null;
    if (row) pick(Number(row.getAttribute('data-i')));
  });

  // A click anywhere else closes the list. Removes itself once the page re-rendered.
  const onDocumentDown = (e) => {
    if (!input.isConnected) { document.removeEventListener('mousedown', onDocumentDown); return; }
    if (e.target === input || listEl.contains(e.target)) return;
    close();
  };
  document.addEventListener('mousedown', onDocumentDown);

  return {
    open,
    close,
    refresh: render,
    destroy() {
      close();
      document.removeEventListener('mousedown', onDocumentDown);
    },
  };
}
