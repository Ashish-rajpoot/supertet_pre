/* ===========================================================
   result.js - result page: score, breakdown, full review, share
   =========================================================== */

import { BASE, mountChrome, qs } from './app.js';
import { ready, esc, toast, download, fmtTime, fmtDate, renderField, langOf, sidesOf, pct } from './util.js';
import * as store from './store.js';
import { LETTERS } from './data.js';
import { reportText } from './analytics.js';
import { fetchRemoteAttempt } from './sync.js';
import { isLoggedIn } from './auth.js';

let attempt = null;
let filter = 'all';

ready(async () => {
  mountChrome({ active: 'pages/result.html' });
  const id = qs('id');
  attempt = id ? store.getAttempt(id) : store.getAttempts().slice(-1)[0];

  // If not found in localStorage (e.g. opened a link shared by someone else), try MongoDB
  if (!attempt && id) {
    const host = document.getElementById('result');
    host.innerHTML = '<div class="card"><p class="muted">Loading result from server&hellip;</p></div>';
    attempt = await fetchRemoteAttempt(id);
    if (attempt) {
      // cache locally so it's available offline
      store.addAttempt(attempt);
    }
  }

  const host = document.getElementById('result');
  if (!attempt) {
    host.innerHTML = '<div class="card"><h2>Result not found</h2>' +
      '<p class="muted">This result is not stored on this device or the server. ' +
      (isLoggedIn() ? 'Open the Progress page to see saved tests.' : 'Log in to see your saved tests.') + '</p>' +
      (isLoggedIn()
        ? '<a class="btn primary" href="' + BASE + 'pages/analytics.html">Open Progress</a>'
        : '') + '</div>';
    return;
  }
  render();
});

function gradePhrase(p) {
  if (p >= 85) return { txt: 'Excellent', cls: 'ok' };
  if (p >= 70) return { txt: 'Good', cls: 'ok' };
  if (p >= 50) return { txt: 'Average - keep going', cls: 'warn' };
  return { txt: 'Needs revision', cls: 'bad' };
}

function render() {
  const g = gradePhrase(attempt.percent);
  const avgSec = attempt.total ? Math.round(attempt.timeTaken / attempt.total) : 0;

  const bars = (attempt.breakdown || []).map(b => `
    <div class="bar-item">
      <div class="bar-top"><span>${esc(b.subject)}</span>
        <span class="muted">${b.correct}/${b.total} &middot; ${b.accuracy}%</span></div>
      <div class="bar"><i class="${b.accuracy >= 60 ? 'ok' : 'bad'}" style="width:${b.accuracy}%"></i></div>
    </div>`).join('');

  document.getElementById('result').innerHTML = `
    <div class="card">
      <div class="qhead">
        <h2 style="margin:0">${esc(attempt.label)}</h2>
        <span class="spacer"></span>
        <span class="pill ${g.cls}">${esc(g.txt)}</span>
      </div>
      <p class="small muted" style="margin:0 0 12px">
        ${esc(fmtDate(attempt.at))} &middot; ${attempt.mode === 'practice' ? 'Practice' : 'Timed test'}
        ${attempt.negative ? ' &middot; negative marking' : ''}
      </p>

      <div class="stat-row">
        <div class="stat"><div class="k">Score</div><div class="v">${attempt.score}/${attempt.total}</div></div>
        <div class="stat"><div class="k">Percentage</div><div class="v">${attempt.percent}%</div></div>
        <div class="stat"><div class="k">Time taken</div><div class="v">${fmtTime(attempt.timeTaken)}</div></div>
        <div class="stat"><div class="k">Avg / question</div><div class="v">${avgSec}s</div></div>
      </div>

      <div class="stat-row" style="margin-top:10px">
        <div class="stat"><div class="k">Correct</div><div class="v" style="color:var(--ok)">${attempt.correct}</div></div>
        <div class="stat"><div class="k">Wrong</div><div class="v" style="color:var(--bad)">${attempt.wrong}</div></div>
        <div class="stat"><div class="k">Skipped</div><div class="v">${attempt.skipped}</div></div>
        <div class="stat"><div class="k">Accuracy</div><div class="v">${pct(attempt.correct, attempt.total)}%</div></div>
      </div>

      <div class="btn-row no-print" style="margin-top:14px">
        <button class="btn primary" id="share" type="button">Share result</button>
        <button class="btn" id="copy" type="button">Copy summary</button>
        <button class="btn" id="retry" type="button">Take another test</button>
        <button class="btn ghost" id="practiceWeak" type="button">Practise weak topics</button>
        <button class="btn ghost" id="print" type="button">Print / PDF</button>
      </div>
    </div>

    ${bars ? '<div class="card"><h3 style="margin-top:0">Subject-wise performance</h3><div class="bar-list">' + bars + '</div></div>' : ''}

    ${(attempt.weakTopics && attempt.weakTopics.length) ? `
      <div class="card">
        <h3 style="margin-top:0">Needs revision</h3>
        <div class="list">${attempt.weakTopics.map(t => `
          <div class="row"><span class="grow"><strong>${esc(t.topic)}</strong>
            <div class="muted small">${esc(t.subject)}</div></span>
            <span class="pill ${t.accuracy >= 50 ? 'warn' : 'bad'}">${t.accuracy}%</span></div>`).join('')}
        </div>
      </div>` : ''}

    <div class="card">
      <div class="qhead">
        <h3 style="margin:0">Answer review</h3>
        <span class="spacer"></span>
        <select id="filter" style="max-width:190px">
          <option value="all">All questions</option>
          <option value="wrong">Only wrong</option>
          <option value="skipped">Only skipped</option>
          <option value="correct">Only correct</option>
        </select>
      </div>
      <div id="reviewList" class="list"></div>
    </div>`;

  renderReview();
  document.getElementById('filter').onchange = e => { filter = e.target.value; renderReview(); };
  document.getElementById('print').onclick = () => window.print();
  document.getElementById('retry').onclick = () => { location.href = BASE + 'pages/test.html'; };
  document.getElementById('copy').onclick = () => copyText(reportText(attempt));
  document.getElementById('share').onclick = shareResult;
  document.getElementById('practiceWeak').onclick = () => {
    const ids = (attempt.details || []).filter(d => d.status !== 'correct').map(d => d.id).slice(0, 30);
    if (!ids.length) return toast('Nothing to revise - well done!');
    sessionStorage.setItem('stp.weakIds', JSON.stringify(ids));
    location.href = BASE + 'pages/flashcards.html?weak=1';
  };
}


function renderReview() {
  const list = document.getElementById('reviewList');
  const details = (attempt.details || []).filter(d => filter === 'all' || d.status === filter);
  if (!details.length) {
    list.innerHTML = '<p class="muted small">Nothing here.</p>';
    return;
  }
  list.innerHTML = details.map((d, i) => {
    const badge = d.status === 'correct' ? '<span class="pill ok">Correct</span>'
      : d.status === 'wrong' ? '<span class="pill bad">Wrong</span>' : '<span class="pill warn">Skipped</span>';
    const count = Math.max(d.options.hi.length, d.options.en.length);
    const opts = [];
    for (let k = 0; k < count; k++) {
      let cls = 'opt';
      if (k === d.answerIndex) cls += ' right';
      else if (k === d.chosenIndex && d.status === 'wrong') cls += ' wrong';
      const hi = d.options.hi[k] || d.options.en[k] || '';
      const en = d.options.en[k] || '';
      opts.push('<div class="' + cls + '" style="cursor:default"><span class="key">' + LETTERS[k] + '</span>' +
        '<span class="otext">' + renderField({ hi, en }, { cls: '', enCls: 'en' }) + '</span></div>');
    }
    const explH = d.explanation && d.explanation.hi, explE = d.explanation && d.explanation.en;
    const expl = (explH && explE && explH !== explE)
      ? esc(explH) + '<div class="muted small">' + esc(explE) + '</div>' : esc(explH || explE || '');
    return '<div class="card" style="margin:0">' +
      '<div class="qhead"><span class="pill">Q' + (i + 1) + '</span>' +
        '<span class="small muted">' + esc(d.subject) + ' &middot; ' + esc(d.topic) + '</span>' +
        '<span class="spacer"></span>' + badge + '</div>' +
      renderField(d.question) +
      '<div class="options">' + opts.join('') + '</div>' +
      (expl ? '<div class="explain">' + expl + '</div>' : '') +
    '</div>';
  }).join('');
  document.getElementById('filter').value = filter;
}

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast('Copied - paste it in WhatsApp'), () => fallbackCopy(text));
  } else fallbackCopy(text);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Copied'); }
  catch (e) { toast('Copy failed - downloading instead'); download('result.txt', text, 'text/plain'); }
  ta.remove();
}

function shareResult() {
  const text = reportText(attempt);
  const url = location.href;
  if (navigator.share) {
    navigator.share({ title: attempt.label + ' - SuperTET Prep result', text: text, url: url })
      .catch(() => copyText(text + '\n' + url));
  } else {
    copyText(text + '\n' + url);
  }
}
