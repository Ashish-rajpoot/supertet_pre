/* ===========================================================
   analytics-page.js - progress dashboard
   =========================================================== */

import { BASE, mountChrome } from './app.js';
import { ready, esc, toast, download, fmtTime, fmtDate } from './util.js';
import * as store from './store.js';
import * as stats from './analytics.js';
import { fetchRemoteAttempts, checkServerStatus, flushQueue, deleteRemoteAttempt, clearRemoteAttempts } from './sync.js';

let viewMode = 'local'; // 'local' | 'cloud'
let serverStatus = { online: false, mongo: false };

ready(async () => {
  mountChrome({ active: 'pages/analytics.html' });
  serverStatus = await checkServerStatus();
  await render();
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

async function render() {
  const host = document.getElementById('dash');
  let attempts = store.getAttempts();

  if (viewMode === 'cloud' && serverStatus.mongo) {
    const cloudAttempts = await fetchRemoteAttempts();
    if (cloudAttempts.length) {
      attempts = cloudAttempts;
    }
  }

  const s = stats.summary(attempts);

  // Status banner showing server / MongoDB status
  const statusBadge = serverStatus.mongo
    ? '<span class="pill ok">MongoDB connected</span>'
    : (serverStatus.online
      ? '<span class="pill warn">Server running (MongoDB offline)</span>'
      : '<span class="pill">Local mode (offline)</span>');

  const modeButtons = serverStatus.mongo ? `
    <div class="btn-row" style="margin-top:12px">
      <button class="btn sm ${viewMode === 'local' ? 'primary' : 'ghost'}" id="btnLocal" type="button">This device (${store.getAttempts().length})</button>
      <button class="btn sm ${viewMode === 'cloud' ? 'primary' : 'ghost'}" id="btnCloud" type="button">All students (MongoDB)</button>
      <button class="btn sm ghost" id="btnSyncNow" type="button">Sync now</button>
    </div>` : '';

  if (!attempts.length) {
    host.innerHTML = `
      <div class="card">
        <div class="qhead"><h2 style="margin:0">Progress</h2><span class="spacer"></span>${statusBadge}</div>
        <p class="muted" style="margin-top:8px">No results yet. Finish a test and your score, subject-wise accuracy and weak topics will appear here.</p>
        ${modeButtons}
        <div class="btn-row" style="margin-top:14px">
          <a class="btn primary" href="${BASE}pages/test.html">Take a test</a>
          <a class="btn" href="${BASE}pages/flashcards.html">Flashcards</a>
        </div>
      </div>`;
    wireControls();
    return;
  }

  const values = stats.trend(attempts).map(t => t.percent);
  const bd = stats.breakdown(attempts);
  const weak = stats.weakTopics(attempts, 3, 8);
  const diff = stats.byDifficulty(attempts);

  host.innerHTML = `
    <div class="card">
      <div class="qhead">
        <h2 style="margin:0">${viewMode === 'cloud' ? 'All students progress' : 'Your progress'}</h2>
        <span class="spacer"></span>
        ${statusBadge}
      </div>
      ${modeButtons}
      <div class="stat-row" style="margin-top:14px">
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
  wireControls();
}

function wireControls() {
  const bl = document.getElementById('btnLocal');
  if (bl) bl.onclick = async () => { viewMode = 'local'; await render(); };
  const bc = document.getElementById('btnCloud');
  if (bc) bc.onclick = async () => { viewMode = 'cloud'; await render(); };
  const bs = document.getElementById('btnSyncNow');
  if (bs) bs.onclick = async () => {
    const flushed = await flushQueue();
    toast(flushed ? 'Synced ' + flushed + ' result(s) to MongoDB' : 'Everything up to date');
    await render();
  };
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
  document.getElementById('clearAll').onclick = async () => {
    const isCloud = viewMode === 'cloud';
    const msg = isCloud
      ? 'Delete all results from MongoDB for all students? This cannot be undone.'
      : 'Delete all saved results on this device? This cannot be undone.';
    if (!confirm(msg)) return;

    if (isCloud) {
      const res = await clearRemoteAttempts();
      toast(res.ok ? `Cleared ${res.count} results from MongoDB` : 'Failed to clear MongoDB results');
    } else {
      store.clearAttempts();
      // Also offer to clear MongoDB if connected
      if (serverStatus.mongo && confirm('Also clear these results from MongoDB?')) {
        await clearRemoteAttempts();
      }
      toast('Results cleared');
    }
    await render();
  };
  tail.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      const id = b.getAttribute('data-del');
      if (viewMode === 'cloud') {
        const ok = await deleteRemoteAttempt(id);
        toast(ok ? 'Result deleted from MongoDB' : 'Failed to delete from MongoDB');
      } else {
        store.deleteAttempt(id);
        if (serverStatus.mongo) {
          await deleteRemoteAttempt(id);
        }
        toast('Result deleted');
      }
      await render();
    };
  });
}
