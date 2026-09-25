/* ===========================================================
   analytics-page.js - progress dashboard
   =========================================================== */

import { BASE, mountChrome } from './app.js';
import { ready, esc, toast, download, fmtTime, fmtDate } from './util.js';
import * as store from './store.js';
import * as stats from './analytics.js';

ready(() => {
  mountChrome({ active: 'pages/analytics.html' });
  render();
});

function barList(rows) {
  if (!rows.length) return '<p class="muted small">Not enough data yet.</p>';
  return '<div class="bar-list">' + rows.map(r => `
    <div class="bar-item">
      <div class="bar-top"><span>${esc(r.key)}</span>
        <span class="muted">${r.correct}/${r.total} &middot; ${r.accuracy}%</span></div>
      <div class="bar"><i class="${r.accuracy >= 60 ? 'ok' : 'bad'}" style="width:${r.accuracy}%"></i></div>
    </div>`).join('') + '</div>';
}

function render() {
  const attempts = store.getAttempts();
  const s = stats.summary(attempts);
  const host = document.getElementById('dash');

  if (!attempts.length) {
    host.innerHTML = '<div class="card"><h2 style="margin-top:0">No results yet</h2>' +
      '<p class="muted">Finish a test and the score, subject-wise accuracy and weak topics will appear here.</p>' +
      '<div class="btn-row"><a class="btn primary" href="' + BASE + 'pages/test.html">Take a test</a>' +
      '<a class="btn" href="' + BASE + 'pages/flashcards.html">Flashcards</a></div></div>';
    return;
  }

  const values = stats.trend(attempts).map(t => t.percent);
  const bd = stats.breakdown(attempts);
  const weak = stats.weakTopics(attempts, 3, 8);
  const diff = stats.byDifficulty(attempts);

  host.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Your progress</h2>
      <div class="stat-row">
        <div class="stat"><div class="k">Tests</div><div class="v">${s.attempts}</div></div>
        <div class="stat"><div class="k">Average</div><div class="v">${s.avgScore}%</div></div>
        <div class="stat"><div class="k">Best</div><div class="v">${s.bestScore}%</div></div>
        <div class="stat"><div class="k">Day streak</div><div class="v">${s.streakDays}</div></div>
      </div>
      <p class="small muted" style="margin:10px 0 0">
        Overall accuracy ${s.accuracy}% across ${s.totalQ} questions &middot;
        ${Math.round(s.totalTime / 60)} minutes of practice</p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Score trend (last ${values.length} tests)</h3>
      ${stats.sparkline(values)}
    </div>

    <div class="grid cols-2">
      <div class="card"><h3 style="margin-top:0">Subject-wise accuracy</h3>${barList(bd.subjects)}</div>
      <div class="card"><h3 style="margin-top:0">Topic-wise accuracy</h3>${barList(bd.topics.slice(0, 12))}</div>
    </div>
    <div id="tail"></div>`;
  renderTail(host, attempts, weak, diff);
}


function renderTail(host, attempts, weak, diff) {
  const tail = document.getElementById('tail');
  tail.innerHTML =
    (weak.length ? '<div class="card">' +
      '<h3 style="margin-top:0">Revise these topics first</h3>' +
      '<div class="list">' + weak.map(t => `
        <div class="row"><span class="grow"><strong>${esc(t.key)}</strong>
          <div class="muted small">${t.correct}/${t.total} correct</div></span>
          <span class="pill ${t.accuracy >= 50 ? 'warn' : 'bad'}">${t.accuracy}%</span></div>`).join('') + '</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn primary" id="weakCards" type="button">Practise these as flashcards</button>' +
      '</div></div>' : '') +
    (diff.length ? '<div class="card"><h3 style="margin-top:0">By difficulty</h3>' +
      barList(diff.map(d => ({ key: d.key, correct: d.correct, total: d.total, accuracy: d.accuracy }))) + '</div>' : '') +
    '<div class="card">' +
      '<h3 style="margin-top:0">History</h3>' +
      '<div class="table-wrap"><table>' +
        '<thead><tr><th>When</th><th>Test</th><th>Score</th><th>%</th><th>Time</th><th></th></tr></thead><tbody>' +
        attempts.slice().reverse().slice(0, 60).map(a => `
          <tr>
            <td>${esc(fmtDate(a.at))}</td>
            <td class="truncate" style="max-width:190px">${esc(a.label)}</td>
            <td>${a.correct}/${a.total}</td>
            <td><span class="pill ${a.percent >= 60 ? 'ok' : 'bad'}">${a.percent}%</span></td>
            <td>${fmtTime(a.timeTaken)}</td>
            <td><a href="${BASE}pages/result.html?id=${encodeURIComponent(a.id)}">open</a>
              <button class="btn sm ghost" data-del="${esc(a.id)}">delete</button></td>
          </tr>`).join('') +
      '</tbody></table></div>' +
      '<div class="btn-row" style="margin-top:12px">' +
        '<button class="btn sm" id="exportCsv" type="button">Export history as CSV</button>' +
        '<button class="btn sm" id="exportJson" type="button">Export history as JSON</button>' +
        '<button class="btn sm bad" id="clearAll" type="button">Clear all results</button>' +
      '</div>' +
      '<p class="help">Results are stored only in this browser. Export regularly if you want a permanent record.</p>' +
    '</div>';

  const weakBtn = document.getElementById('weakCards');
  if (weakBtn) weakBtn.onclick = () => { location.href = BASE + 'pages/flashcards.html?weak=1'; };

  document.getElementById('exportCsv').onclick = () => {
    const head = 'date,test,score,total,percent,correct,wrong,skipped,seconds\n';
    const body = attempts.map(a => [fmtDate(a.at), '"' + String(a.label).replace(/"/g, '""') + '"',
      a.score, a.total, a.percent, a.correct, a.wrong, a.skipped, a.timeTaken].join(',')).join('\n');
    download('supertet-results.csv', head + body, 'text/csv');
  };
  document.getElementById('exportJson').onclick = () => {
    download('supertet-results.json', JSON.stringify(attempts, null, 2));
  };
  document.getElementById('clearAll').onclick = () => {
    if (!confirm('Delete all saved results? This cannot be undone.')) return;
    store.clearAttempts();
    toast('Results cleared');
    render();
  };
  tail.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = () => {
      store.deleteAttempt(b.getAttribute('data-del'));
      toast('Result deleted');
      render();
    };
  });
}
