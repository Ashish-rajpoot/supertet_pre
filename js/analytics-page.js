/* ===========================================================
   analytics-page.js - progress dashboard
   Three ways of looking at the same numbers:
     local - tests finished in this browser
     mine  - the signed-in student's own attempts in MongoDB
     all   - every student, user-wise (admin only)
   Signed-out visitors only get a login prompt - no results are shown
   until an account is signed in.
   =========================================================== */

import { BASE, mountChrome, openAuthModal } from './app.js';
import { ready, esc, toast, download, fmtTime, fmtDate } from './util.js';
import * as store from './store.js';
import * as stats from './analytics.js';
import { fetchRemoteAttempts, fetchUserAnalytics, checkServerStatus, flushQueue, deleteRemoteAttempt, clearRemoteAttempts } from './sync.js';
import { isLoggedIn, isAdmin } from './auth.js';

let scope = isLoggedIn() ? 'mine' : 'local'; // 'local' | 'mine' | 'all'
let selectedUser = '';                        // admin drill-down: whose results are shown
let serverStatus = { online: false, mongo: false };

ready(async () => {
  mountChrome({ active: 'pages/analytics.html' });
  if (isLoggedIn()) {
    serverStatus = await checkServerStatus();
    await render();
  } else {
    renderLoginGate();
  }
  // Signing in or out changes what this page is allowed to show.
  window.addEventListener('stp:auth', async () => {
    if (!isLoggedIn()) {
      renderLoginGate();
      return;
    }
    scope = 'mine';
    selectedUser = '';
    serverStatus = await checkServerStatus();
    await render();
  });
});

/** Signed-out visitors get a login prompt instead of any test results. */
function renderLoginGate() {
  const host = document.getElementById('dash');
  if (!host) return;
  host.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Log in to see your progress</h2>
      <p class="muted">Results are kept per account, so the Progress page is only shown after you sign in.
        Your test history stays private to you (admins can see it for support).</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primary" id="btnGateLogin" type="button">Log in</button>
      </div>
    </div>`;
  const btn = document.getElementById('btnGateLogin');
  if (btn) btn.onclick = () => openAuthModal('login');
}

/**
 * Load the attempts for the current scope. Never throws: when the server is
 * unreachable or the caller is not allowed, a readable notice is returned instead.
 */
async function loadAttempts() {
  if (scope === 'local') return { attempts: store.getAttempts(), notice: '' };

  if (!serverStatus.online || !serverStatus.mongo) {
    if (scope === 'mine' && isLoggedIn()) {
      return { attempts: store.getAttempts(), notice: 'Server offline - showing the results saved on this device.' };
    }
    return { attempts: [], notice: 'The shared server is offline, so student results cannot be loaded right now.' };
  }

  const remote = await fetchRemoteAttempts(scope === 'all' ? { scope: 'all' } : {});
  if (remote === null) {
    if (scope === 'mine' && isLoggedIn()) {
      return { attempts: store.getAttempts(), notice: 'Could not read your cloud results - showing this device instead.' };
    }
    return { attempts: [], notice: 'Could not load student results. Please try again.' };
  }
  return { attempts: remote, notice: '' };
}

/**
 * One row per student. The admin endpoint also lists students who never practised;
 * offline (or for a non-admin) the loaded attempts are grouped instead.
 */
async function buildRoster(allAttempts) {
  const grouped = stats.groupByStudent(allAttempts);
  const fromServer = isAdmin() ? await fetchUserAnalytics() : null;
  if (!fromServer || !fromServer.length) return grouped;
  const known = new Set(fromServer.map(r => r.userId));
  return fromServer.concat(grouped.filter(g => g.userId && !known.has(g.userId)));
}

function scopeTitle() {
  if (scope === 'all') return selectedUser ? 'Student progress' : 'All students (user-wise)';
  if (scope === 'mine') return 'Your progress';
  return 'This device';
}


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
  if (!host) return;

  if (scope !== 'local' && !isLoggedIn()) scope = 'local';

  const loaded = await loadAttempts();
  let attempts = loaded.attempts;

  // Admin view: build the user-wise roster, then narrow down to one student if asked.
  let roster = null;
  if (scope === 'all') {
    roster = await buildRoster(attempts);
    if (selectedUser) attempts = attempts.filter(a => a.userId === selectedUser);
  }

  const s = stats.summary(attempts);

  // Status banner showing server / MongoDB status
  const statusBadge = serverStatus.mongo
    ? '<span class="pill ok">MongoDB connected</span>'
    : (serverStatus.online
      ? '<span class="pill warn">Server running (MongoDB offline)</span>'
      : '<span class="pill">Local mode (offline)</span>');

  const noticeHtml = loaded.notice
    ? '<p class="pill warn" style="display:inline-block;margin-top:10px">' + esc(loaded.notice) + '</p>'
    : '';

  const viewing = selectedUser ? (roster || []).find(r => r.userId === selectedUser) : null;
  const rosterCard = scope === 'all'
    ? '<div class="card"><h3 style="margin-top:0">Students (user-wise)</h3>' +
      (selectedUser
        ? '<p class="small muted" style="margin-top:0">Showing one student. ' +
          '<button class="btn sm ghost" id="btnAllStudents" type="button">Show all students</button></p>'
        : '<p class="small muted" style="margin-top:0">Every account with its own totals. Tap "view" to see one student\'s dashboard.</p>') +
      rosterHtml(roster) + '</div>'
    : '';

  if (!attempts.length) {
    host.innerHTML = `
      <div class="card">
        <div class="qhead"><h2 style="margin:0">${esc(scopeTitle())}</h2><span class="spacer"></span>${statusBadge}</div>
        ${emptyText()}
        ${modeButtonsHtml()}
        ${noticeHtml}
        ${rosterCard}
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
        <h2 style="margin:0">${esc(scopeTitle())}${viewing ? ' &middot; ' + esc(viewing.name) : ''}</h2>
        <span class="spacer"></span>
        ${statusBadge}
      </div>
      ${modeButtonsHtml()}
      ${noticeHtml}
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

    ${rosterCard}

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

/* ---------------------------------------------------------------- controls */

function modeButtonsHtml() {
  const parts = [
    '<button class="btn sm ' + (scope === 'local' ? 'primary' : 'ghost') + '" id="btnScopeLocal" type="button">This device (' + store.getAttempts().length + ')</button>',
  ];
  if (isLoggedIn()) {
    parts.push('<button class="btn sm ' + (scope === 'mine' ? 'primary' : 'ghost') + '" id="btnScopeMine" type="button">My account</button>');
  }
  if (isAdmin()) {
    parts.push('<button class="btn sm ' + (scope === 'all' ? 'primary' : 'ghost') + '" id="btnScopeAll" type="button">All students</button>');
  }
  if (!isLoggedIn()) {
    parts.push('<button class="btn sm ghost" id="btnScopeLogin" type="button">Log in for per-account progress</button>');
  }
  if (serverStatus.mongo) {
    parts.push('<button class="btn sm ghost" id="btnSyncNow" type="button">Sync now</button>');
  }
  return '<div class="btn-row" style="margin-top:12px">' + parts.join('') + '</div>';
}

function emptyText() {
  if (scope === 'all') return '<p class="muted" style="margin-top:8px">No student has finished a test yet.</p>';
  if (scope === 'mine') return '<p class="muted" style="margin-top:8px">No results on your account yet. Finish a test while logged in and it shows up here and on every device you log in from.</p>';
  return '<p class="muted" style="margin-top:8px">No results yet. Finish a test and your score, subject-wise accuracy and weak topics will appear here.</p>';
}

/** Footnote under the history table, per scope. */
function historyHelp() {
  if (scope === 'all') return '<p class="help">Every student\'s saved result, newest first. Only an admin sees this view.</p>';
  if (scope === 'mine') return '<p class="help">Your results are stored in the shared database under your account.</p>';
  return '<p class="help">Results are stored only in this browser. Export regularly if you want a permanent record.</p>';
}

/** Admin only: one line per student (user-wise analytics). */
function rosterHtml(rows) {
  if (!rows || !rows.length) return '<p class="muted small">No students yet.</p>';
  return '<div class="table-wrap"><table><thead><tr>' +
      '<th>Student</th><th>Tests</th><th>Average</th><th>Best</th><th>Accuracy</th><th>Last attempt</th><th></th>' +
    '</tr></thead><tbody>' +
    rows.map(r => '<tr class="' + (r.userId && r.userId === selectedUser ? 'me-row' : '') + '">' +
      '<td>' + esc(r.name || 'Student') + (r.email ? '<div class="muted small">' + esc(r.email) + '</div>' : '') + '</td>' +
      '<td>' + (r.attempts || 0) + '</td>' +
      '<td>' + (r.avgPercent || 0) + '%</td>' +
      '<td>' + (r.best || 0) + '%</td>' +
      '<td>' + (r.accuracy || 0) + '%</td>' +
      '<td>' + (r.lastAt ? esc(fmtDate(r.lastAt)) : '-') + '</td>' +
      '<td>' + (r.userId
        ? '<button class="btn sm ghost" data-student="' + esc(r.userId) + '" type="button">view</button>'
        : '<span class="muted small">device only</span>') + '</td>' +
    '</tr>').join('') + '</tbody></table></div>';
}

function wireControls() {
  const go = (next) => { scope = next; render(); };

  const bl = document.getElementById('btnScopeLocal');
  if (bl) bl.onclick = () => go('local');

  const bm = document.getElementById('btnScopeMine');
  if (bm) bm.onclick = () => { selectedUser = ''; go('mine'); };

  const ba = document.getElementById('btnScopeAll');
  if (ba) ba.onclick = () => { selectedUser = ''; go('all'); };

  const ball = document.getElementById('btnAllStudents');
  if (ball) ball.onclick = () => { selectedUser = ''; go('all'); };

  document.querySelectorAll('[data-student]').forEach(b => {
    b.onclick = () => { selectedUser = b.getAttribute('data-student'); render(); };
  });

  const login = document.getElementById('btnScopeLogin');
  if (login) login.onclick = () => openAuthModal('login');

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
        '<thead><tr>' + (scope === 'all' ? '<th>Student</th>' : '') +
          '<th>When</th><th>Test</th><th>Score</th><th>%</th><th>Time</th><th></th></tr></thead><tbody>' +
        attempts.slice().reverse().slice(0, 60).map(a => `
          <tr>
            ${scope === 'all' ? '<td>' + esc(a.student || 'Anonymous') + '</td>' : ''}
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
      '<p class="help">' + historyHelp() + '</p>' +
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
    const cloud = scope !== 'local';
    const msg = cloud
      ? (scope === 'all'
        ? 'Delete every student\'s results from the shared database? This cannot be undone.'
        : 'Delete all of your saved results from the shared database? This cannot be undone.')
      : 'Delete all saved results on this device? This cannot be undone.';
    if (!confirm(msg)) return;

    if (cloud) {
      // The server clears every student for an admin and only your own rows for a student.
      const res = await clearRemoteAttempts({});
      toast(res.ok ? 'Cleared ' + res.count + ' result(s)' : 'Could not clear the results. Please log in again.');
    } else {
      store.clearAttempts();
      if (serverStatus.mongo && isLoggedIn() && confirm('Also clear your saved results from the shared database?')) {
        const res = await clearRemoteAttempts({});
        if (!res.ok) toast('Cloud clear failed - the server refused the request');
      }
      toast('Results cleared');
    }
    await render();
  };
  tail.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      const id = b.getAttribute('data-del');
      if (scope === 'local') {
        store.deleteAttempt(id);
        // Keep the account copy in step when possible; a refusal is not fatal here.
        if (serverStatus.mongo && isLoggedIn()) await deleteRemoteAttempt(id);
        toast('Result deleted');
      } else {
        const ok = await deleteRemoteAttempt(id);
        toast(ok ? 'Result deleted' : 'Could not delete this result');
      }
      await render();
    };
  });
}
