/* ===========================================================
   flashcards.js - mobile flashcard drill with Leitner boxes
   =========================================================== */

import { BASE, mountChrome } from './app.js';
import { ready, esc, toast, shuffle, pick, renderField } from './util.js';
import * as store from './store.js';
import { getAll, LETTERS } from './data.js';
import { isLoggedIn, canAddQuestions } from './auth.js';

let deck = [];
let idx = 0;
let flipped = false;
let bank = [];

ready(async () => {
  mountChrome({ active: 'pages/flashcards.html' });
  bank = await getAll();
  const host = document.getElementById('board');

  if (!bank.length) {
    host.innerHTML = '<div class="card"><h2>No questions yet</h2>' +
      '<p class="muted">' + (canAddQuestions()
        ? 'Add a question bank from the Questions page first.'
        : 'The admin has not added a question bank yet.') + '</p>' +
      (canAddQuestions()
        ? '<a class="btn primary" href="' + BASE + 'pages/manage.html">Add questions</a>'
        : '') + '</div>';
    return;
  }
  renderPicker();
});

function renderPicker() {
  const weakMode = new URLSearchParams(location.search).get('weak') === '1';
  const subjects = Array.from(new Set(bank.map(q => q.subject))).sort();

  document.getElementById('board').innerHTML = `
    <div class="grid cols-2">
      <div class="card">
        <h3 style="margin-top:0">Choose a deck</h3>
        <label for="subject">Subject</label>
        <select id="subject">
          <option value="">All subjects (${bank.length})</option>
          ${subjects.map(s => '<option value="' + esc(s) + '">' + esc(s) + ' (' +
            bank.filter(q => q.subject === s).length + ')</option>').join('')}
        </select>
        <div class="inline" style="margin-top:10px">
          <div><label for="count">Cards in this session</label>
            <input type="number" id="count" min="5" max="200" value="20"></div>
        </div>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="weakOnly" ${weakMode ? 'checked' : ''}>
          <span>Only cards I got wrong before</span></label>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn primary" id="startDeck" type="button">Start practising</button>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Memory boxes</h3>
        <p class="small muted">Cards you mark &ldquo;Review again&rdquo; come back sooner. Cards move up a box each time you get them right.</p>
        <div id="boxStats" class="bar-list"></div>
        <div class="btn-row" style="margin-top:12px">
          <button class="btn sm ghost" id="resetBoxes" type="button">Reset my progress</button>
        </div>
      </div>
    </div>`;

  document.getElementById('startDeck').onclick = start;
  document.getElementById('resetBoxes').onclick = () => {
    if (!confirm('Reset flashcard progress?')) return;
    store.resetCards();
    toast('Flashcard progress reset');
    boxStats();
  };
  boxStats();
}

function boxStats() {
  const cards = store.getCards();
  const host = document.getElementById('boxStats');
  if (!host) return;
  const counts = [0, 0, 0, 0, 0, 0];
  Object.values(cards).forEach(c => { counts[Math.min(5, Math.max(1, c.box))]++; });
  const max = Math.max(1, Math.max.apply(null, counts));
  host.innerHTML = counts.slice(1).map((n, i) => `
    <div class="bar-item">
      <div class="bar-top"><span>Box ${i + 1}${i === 0 ? ' (needs work)' : (i === 4 ? ' (mastered)' : '')}</span>
        <span class="muted">${n} card${n === 1 ? '' : 's'}</span></div>
      <div class="bar"><i style="width:${Math.round((n / max) * 100)}%"></i></div>
    </div>`).join('');
}


function start() {
  const subject = document.getElementById('subject').value;
  const count = Math.max(1, parseInt(document.getElementById('count').value, 10) || 20);
  const weakOnly = document.getElementById('weakOnly').checked;

  let pool = subject ? bank.filter(q => q.subject === subject) : bank;
  if (weakOnly) {
    const ids = new Set(JSON.parse(sessionStorage.getItem('stp.weakIds') || '[]').map(String));
    const cards = store.getCards();
    Object.keys(cards).forEach(id => { if (cards[id].box <= 2) ids.add(String(id)); });
    const filtered = pool.filter(q => ids.has(String(q.id)));
    if (!filtered.length) toast('No weak cards stored - practising the normal deck');
    else pool = filtered;
  }

  const cards = store.getCards();
  const boxOf = q => (cards[q.id] ? cards[q.id].box : 3);
  const ordered = shuffle(pool).sort((a, b) => boxOf(a) - boxOf(b));
  deck = ordered.slice(0, Math.min(count, ordered.length));
  idx = 0; flipped = false;

  document.getElementById('board').innerHTML = '<div id="cardHost"></div>' + controls();
  wireControls();
  showCard();
}

function controls() {
  return `
    <div class="card">
      <div class="qhead">
        <span class="pill brand" id="pos">1 / 1</span>
        <span class="spacer"></span>
        <span class="pill" id="boxPill">box 1</span>
      </div>
      <div class="progress" style="margin:8px 0 0"><i id="deckBar"></i></div>
    </div>
    <div class="btn-row" style="margin-bottom:14px">
      <button class="btn bad" id="again" type="button">Review again</button>
      <button class="btn primary" id="flip" type="button">Show answer</button>
      <button class="btn ok" id="got" type="button">I knew this</button>
    </div>
    <div class="card">
      <p class="small muted" style="margin:0">Swipe right = I knew this, swipe left = review again.
      On a keyboard: <kbd>Space</kbd> flips, <kbd>&rarr;</kbd> knew it, <kbd>&larr;</kbd> revise.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn sm ghost" id="newDeck" type="button">Change deck</button>
        <a class="btn sm ghost" href="${BASE}pages/test.html">Take a test instead</a>
      </div>
    </div>`;
}

function wireControls() {
  document.getElementById('flip').onclick = toggleFlip;
  document.getElementById('got').onclick = () => rate(true);
  document.getElementById('again').onclick = () => rate(false);
  document.getElementById('newDeck').onclick = () => { location.href = BASE + 'pages/flashcards.html'; };

  const card = document.getElementById('cardHost');
  let x0 = null, y0 = null;
  card.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  card.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) rate(dx > 0);
  });

  document.onkeydown = e => {
    if (e.code === 'Space') { e.preventDefault(); toggleFlip(); }
    if (e.code === 'ArrowRight') rate(true);
    if (e.code === 'ArrowLeft') rate(false);
  };
}


function showCard() {
  if (idx >= deck.length) return finishDeck();
  const q = deck[idx];
  const cards = store.getCards();
  const box = cards[q.id] ? cards[q.id].box : 1;
  const count = Math.max(q.options.hi.length, q.options.en.length);
  const opts = [];
  for (let i = 0; i < count; i++) {
    const hi = q.options.hi[i] || q.options.en[i] || '';
    const en = q.options.en[i] || '';
    opts.push('<div class="opt' + (i === q.answerIndex ? ' right' : '') + '" style="cursor:default">' +
      '<span class="key">' + LETTERS[i] + '</span><span class="otext">' +
      renderField({ hi, en }, { cls: '', enCls: 'en' }) + '</span></div>');
  }
  const explH = q.explanation.hi, explE = q.explanation.en;
  const expl = (explH && explE && explH !== explE)
    ? esc(explH) + '<div class="muted small">' + esc(explE) + '</div>' : esc(explH || explE || '');

  document.getElementById('cardHost').innerHTML = `
    <div class="flashcard ${flipped ? 'flipped' : ''}" id="fc">
      <div class="flashcard-inner">
        <div class="flashcard-face front">
          <span class="pill">${esc(q.subject)} &middot; ${esc(q.topic)}</span>
          ${renderField(q.question)}
          <p class="flashcard-tap">Tap the card (or press Space) to see the answer</p>
        </div>
        <div class="flashcard-face back">
          ${renderField(q.question)}
          <div class="options">${opts.join('')}</div>
          ${expl ? '<div class="explain">' + expl + '</div>' : ''}
        </div>
      </div>
    </div>`;

  document.getElementById('fc').addEventListener('click', ev => {
    if (ev.target.closest('.opt')) return;
    toggleFlip();
  });
  document.getElementById('pos').textContent = (idx + 1) + ' / ' + deck.length;
  document.getElementById('boxPill').textContent = 'box ' + box;
  document.getElementById('deckBar').style.width = Math.round((idx / deck.length) * 100) + '%';
  document.getElementById('flip').textContent = flipped ? 'Hide answer' : 'Show answer';
}

function toggleFlip() {
  flipped = !flipped;
  const fc = document.getElementById('fc');
  if (fc) fc.classList.toggle('flipped', flipped);
  const btn = document.getElementById('flip');
  if (btn) btn.textContent = flipped ? 'Hide answer' : 'Show answer';
}

function rate(knew) {
  const q = deck[idx];
  const cards = store.getCards();
  const box = cards[q.id] ? cards[q.id].box : 1;
  store.setCard(q.id, knew ? box + 1 : 1);
  idx++; flipped = false;
  showCard();
}

function finishDeck() {
  document.getElementById('cardHost').innerHTML = `
    <div class="card center">
      <h2>Session complete</h2>
      <p class="muted">You went through ${deck.length} card${deck.length === 1 ? '' : 's'}.</p>
      <div class="btn-row" style="justify-content:center">
        <button class="btn primary" id="againDeck" type="button">Another round</button>
        <a class="btn" href="${BASE}pages/test.html">Take a test</a>
        ${isLoggedIn() ? `<a class="btn ghost" href="${BASE}pages/analytics.html">See progress</a>` : ''}
      </div>
    </div>`;
  const b = document.getElementById('againDeck');
  if (b) b.onclick = () => { location.href = BASE + 'pages/flashcards.html'; };
}
