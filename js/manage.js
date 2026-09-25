/* ===========================================================
   manage.js - bulk import questions (Excel / CSV / JSON)

   Only an admin - or a student the admin has allowed - may add
   questions to the shared bank. Everyone can still practise and
   keep a private bank on this device.
   =========================================================== */

import { BASE, mountChrome, openAuthModal } from './app.js';
import { ready, esc, toast, download } from './util.js';
import { buildAiPrompt } from './ai-prompt.js';
import * as store from './store.js';
import { normaliseList, getAll } from './data.js';
import { parseFile, parseJsonText, parseCsvText, downloadTemplate, exportQuestionsXlsx } from './importer.js';
import { syncQuestions, checkServerStatus } from './sync.js';
import { getCurrentUser, isLoggedIn, isAdmin, canAddQuestions, listUsers, updateUserPermissions } from './auth.js';

let preview = { questions: [], errors: [], warnings: [] };
let serverStatus = { online: false, mongo: false };

ready(async () => {
  mountChrome({ active: 'pages/manage.html' });
  serverStatus = await checkServerStatus();
  await renderPage();
  // Logging in / out can unlock (or lock) the upload tools.
  window.addEventListener('stp:auth', () => renderPage());
});

async function renderPage() {
  const host = document.getElementById('manage');
  if (!host) return;
  const canEdit = canAddQuestions();

  host.innerHTML = layout(canEdit);
  wire(canEdit);
  await refreshStatus();

  if (isAdmin() && serverStatus.mongo) await renderUsersPanel();
}

/** Explains why the upload tools are locked (or nothing when the user may add questions). */
function permissionCard() {
  if (canAddQuestions()) return '';
  if (!isLoggedIn()) {
    return `
    <div class="card">
      <h2 style="margin-top:0">Adding questions needs a login</h2>
      <p class="lead">Only the admin - or students the admin allows - can add questions to the shared bank.
        You can still take tests, and keep a private question bank on this device.</p>
      <div class="btn-row"><button class="btn primary" id="manageLogin" type="button">Log in</button></div>
    </div>`;
  }
  const me = getCurrentUser();
  return `
    <div class="card">
      <h2 style="margin-top:0">Permission needed</h2>
      <p class="lead">You are signed in as <strong>${esc(me.name || 'Student')}</strong>,
        but adding questions is not allowed for your account yet.
        Ask the admin to switch on &ldquo;can add questions&rdquo; for you.</p>
    </div>`;
}

function layout(canEdit) {
  // The upload / paste / preview cards only exist when the user may add questions.
  const uploadBlock = canEdit ? `
  <div class="card">
    <h2 style="margin-top:0">Add questions in bulk</h2>
    <p class="lead">Upload an Excel (<code>.xlsx</code>), CSV or JSON file. Questions are checked, previewed, then saved into this browser.</p>
    <div id="drop" class="drop">
      <strong>Drop a file here</strong> or
      <div class="btn-row" style="justify-content:center;margin-top:10px">
        <button class="btn primary" id="pickXlsx" type="button">Choose Excel / CSV</button>
        <button class="btn" id="pickJson" type="button">Choose JSON</button>
      </div>
      <input type="file" id="fileXlsx" accept=".xlsx,.xls,.xlsm,.csv,.txt" class="hidden">
      <input type="file" id="fileJson" accept=".json,.txt" class="hidden">
      <p class="help">Columns: id, subject, topic, difficulty, q_hi, q_en, opt1_hi..opt4_hi, opt1_en..opt4_en, answer, expl_hi, expl_en, tags</p>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn sm" id="tplBtn" type="button">Download Excel template</button>
      <button class="btn sm" id="jsonSample" type="button">Download JSON sample</button>
    </div>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Or let an AI write the questions for you</h3>
    <p class="lead">Fill this in, press <strong>Copy AI prompt</strong>, paste it into ChatGPT, Claude, Gemini
      or any other AI, then paste the JSON it prints into the box below. The prompt asks for the exact
      column layout this page imports.</p>
    <div class="btn-row" style="flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:4px">
      <label class="small" style="display:flex;flex-direction:column;gap:4px">How many questions
        <input type="number" id="aiCount" min="1" max="200" value="20" style="width:92px">
      </label>
      <label class="small" style="display:flex;flex-direction:column;gap:4px">Subject
        <input type="text" id="aiSubject" placeholder="e.g. GK &amp; GS" style="width:170px">
      </label>
      <label class="small" style="display:flex;flex-direction:column;gap:4px">Topic
        <input type="text" id="aiTopic" placeholder="e.g. Important Days" style="width:170px">
      </label>
      <label class="small" style="display:flex;flex-direction:column;gap:4px">Difficulty
        <select id="aiDiff" style="width:110px">
          <option value="easy">easy</option>
          <option value="medium" selected>medium</option>
          <option value="hard">hard</option>
        </select>
      </label>
      <label class="small" style="display:flex;flex-direction:column;gap:4px">Medium
        <select id="aiMedium" style="width:150px">
          <option value="Hindi" selected>Hindi (default)</option>
          <option value="English">English</option>
          <option value="Hindi + English">Hindi + English</option>
        </select>
      </label>
    </div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary" id="aiCopy" type="button">Copy AI prompt</button>
      <button class="btn sm ghost" id="aiToggle" type="button">Hide prompt</button>
      <a class="btn sm ghost" href="${BASE}AI-QUESTION-PROMPT.md">Guide (.md)</a>
    </div>
    <textarea id="aiPrompt" readonly rows="12" style="margin-top:10px;font-family:var(--mono,monospace);font-size:12px;white-space:pre"></textarea>
    <p class="help">Works with any LLM. The reply must be a bare JSON array - strip chat commentary or
      <code>&#96;&#96;&#96;json</code> fences first. <a href="${BASE}AI-QUESTION-PROMPT.md">Read the full prompt guide</a>.</p>
  </div>

  <div class="card">
    <h3 style="margin-top:0">Or paste JSON / CSV text</h3>
    <textarea id="paste" placeholder='[{"subject":"GK","topic":"Days","q_hi":"...","q_en":"...","opt1_hi":"a","opt2_hi":"b","opt3_hi":"c","opt4_hi":"d","answer":"B"}]'></textarea>
    <div class="btn-row" style="margin-top:9px">
      <button class="btn sm primary" id="pasteBtn" type="button">Load pasted text</button>
      <button class="btn sm ghost" id="clearPaste" type="button">Clear</button>
    </div>
  </div>

  <div id="review" class="hidden">
    <div class="card">
      <div class="qhead">
        <h2 style="margin:0">Preview</h2>
        <span class="spacer"></span>
        <span class="pill brand" id="okCount">0 valid</span>
        <span class="pill bad hidden" id="errCount"></span>
      </div>
      <div id="issues"></div>
      <div class="table-wrap" style="max-height:330px;overflow:auto">
        <table id="previewTable"><thead><tr>
          <th>#</th><th>Subject</th><th>Topic</th><th>Question</th><th>Answer</th>
        </tr></thead><tbody></tbody></table>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primary" id="commit" type="button">Save to question bank</button>
        <button class="btn ghost" id="cancel" type="button">Discard</button>
      </div>
    </div>
  </div>
` : '';

  return `
  ${permissionCard()}
  ${uploadBlock}
  <div class="card">
    <h2 style="margin-top:0">Question bank</h2>
    <div id="status" class="muted small">Loading&hellip;</div>
    <h3>Saved by you</h3>
    <div id="userList" class="list"></div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn sm" id="exportJson" type="button">Export bank as JSON</button>
      <button class="btn sm" id="exportXlsx" type="button">Export bank as Excel</button>
      <button class="btn sm" id="exportBackup" type="button">Download full backup</button>
      <label class="btn sm" style="margin:0">Restore backup
        <input type="file" id="restoreFile" accept=".json" class="hidden">
      </label>
      <button class="btn sm bad" id="wipe" type="button">Delete all imported questions</button>
    </div>
    <p class="help">Tip: keep a backup file. Results and questions live only in this browser.</p>
  </div>

  ${usersCard()}`;
}

/** Admin only: the panel that lets students add questions. */
function usersCard() {
  if (!isAdmin()) return '';
  return `
  <div class="card">
    <h2 style="margin-top:0">Students &amp; permissions</h2>
    <p class="lead">You are the admin, so you can add and delete any question. Switch a student on below
      to let them add questions to the shared bank too.</p>
    <div id="usersPanel" class="perm-list"><p class="muted small">Loading&hellip;</p></div>
  </div>`;
}

/** Admin only: list every account with its permission state. */
async function renderUsersPanel() {
  const host = document.getElementById('usersPanel');
  if (!host) return;

  let users = [];
  try {
    users = await listUsers();
  } catch (err) {
    host.innerHTML = '<p class="pill warn" style="display:inline-block">' + esc(err.message) + '</p>';
    return;
  }

  if (!users.length) {
    host.innerHTML = '<p class="muted small">No accounts yet.</p>';
    return;
  }

  const me = getCurrentUser();
  host.innerHTML = users.map(u => {
    const isMe = me && u.id === me.id;
    const roleTag = u.role === 'admin'
      ? '<span class="pill warn role-tag">Admin</span>'
      : (u.canAddQuestions ? '<span class="pill brand role-tag">Can add</span>' : '<span class="pill role-tag">Read only</span>');
    return `<div class="row perm-row">
      <span class="grow">
        <strong>${esc(u.name || 'Student')}${isMe ? ' (you)' : ''}</strong> ${roleTag}
        <div class="muted small truncate">${esc(u.email || u.phone || u.userId || '')}${u.verified ? '' : ' &middot; not verified'}</div>
      </span>
      <span class="perm-actions">
        <button class="btn sm ${u.canAddQuestions ? 'ghost' : 'primary'}" data-perm="${esc(u.id)}" data-value="${u.canAddQuestions ? 'false' : 'true'}" type="button">
          ${u.canAddQuestions ? 'Revoke add access' : 'Allow to add questions'}
        </button>
        ${isMe ? '' : `<button class="btn sm ghost" data-role="${esc(u.id)}" data-value="${u.role === 'admin' ? 'user' : 'admin'}" type="button">
          ${u.role === 'admin' ? 'Make student' : 'Make admin'}</button>`}
      </span>
    </div>`;
  }).join('');

  host.querySelectorAll('[data-perm]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-perm');
      const value = btn.getAttribute('data-value') === 'true';
      btn.disabled = true;
      try {
        await updateUserPermissions(id, { canAddQuestions: value });
        toast(value ? 'Permission granted' : 'Permission removed');
      } catch (err) {
        toast(err.message || 'Could not update the permission');
      }
      await renderUsersPanel();
    };
  });

  host.querySelectorAll('[data-role]').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.getAttribute('data-role');
      const role = btn.getAttribute('data-value');
      btn.disabled = true;
      try {
        await updateUserPermissions(id, { role });
        toast(role === 'admin' ? 'Promoted to admin' : 'Admin role removed');
      } catch (err) {
        toast(err.message || 'Could not change the role');
      }
      await renderPage();
    };
  });
}


/**
 * Wire the page. The upload cards only exist when `canEdit` is true, so every
 * lookup is guarded and the sharing/backup tools are wired for everybody.
 */
function wire(canEdit) {
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };

  // ---------- export / backup / restore work without any permission ----------
  on('exportJson', async () => {
    const all = await getAll();
    download('question-bank.json', JSON.stringify(all, null, 2));
    toast('Exported ' + all.length + ' questions');
  });
  on('exportXlsx', async () => {
    const all = await getAll();
    exportQuestionsXlsx(all, 'question-bank.xlsx')
      .then(() => toast('Exported ' + all.length + ' questions'))
      .catch(e => toast(e.message));
  });
  on('exportBackup', () => {
    download('supertet-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(store.exportAll(), null, 2));
    toast('Backup downloaded');
  });
  on('wipe', async () => {
    if (!confirm('Delete every question you imported? The seeded sample questions stay.')) return;
    store.clearUserQuestions();
    toast('Imported questions deleted');
    await refreshStatus();
  });

  const restore = document.getElementById('restoreFile');
  if (restore) {
    restore.onchange = async () => {
      const f = restore.files[0];
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        const r = store.importAll(obj);
        if (obj.settings) store.saveSettings(obj.settings);
        if (Array.isArray(obj.attempts)) obj.attempts.forEach(a => store.addAttempt(a));
        toast('Restored ' + r.added + ' new, ' + r.updated + ' updated');
        await refreshStatus();
      } catch (e) { toast('Restore failed: ' + e.message); }
      restore.value = '';
    };
  }

  const loginBtn = document.getElementById('manageLogin');
  if (loginBtn) loginBtn.onclick = () => openAuthModal('login');

  // Everything below needs the upload cards, which only exist for permitted users.
  if (!canEdit) return;

  const drop = document.getElementById('drop');
  const fileXlsx = document.getElementById('fileXlsx');
  const fileJson = document.getElementById('fileJson');

  on('pickXlsx', () => fileXlsx.click());
  on('pickJson', () => fileJson.click());
  if (fileXlsx) fileXlsx.onchange = () => handleFiles(fileXlsx.files);
  if (fileJson) fileJson.onchange = () => handleFiles(fileJson.files);

  if (drop) {
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.add('over');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
      e.preventDefault(); drop.classList.remove('over');
    }));
    drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
  }

  on('tplBtn', () => downloadTemplate().catch(e => toast(e.message)));
  on('jsonSample', () => download('questions-sample.json', JSON.stringify(sampleJson(), null, 2)));

  on('pasteBtn', () => {
    const text = document.getElementById('paste').value.trim();
    if (!text) return toast('Paste something first');
    try {
      const rows = (text.startsWith('[') || text.startsWith('{')) ? parseJsonText(text) : parseCsvText(text);
      showPreview(rows, 'pasted text');
    } catch (e) { toast('Could not read: ' + e.message); }
  });
  on('clearPaste', () => { document.getElementById('paste').value = ''; });

  // ---------- AI prompt helper (shared text lives in ai-prompt.js) ----------
  // The prompt is shown straight on this page, right under the bulk-upload card.
  const aiPromptBox = document.getElementById('aiPrompt');
  const aiToggleBtn = document.getElementById('aiToggle');
  const buildPrompt = () => buildAiPrompt({
    count: document.getElementById('aiCount').value,
    subject: document.getElementById('aiSubject').value,
    topic: document.getElementById('aiTopic').value,
    difficulty: (document.getElementById('aiDiff') || {}).value,
    medium: (document.getElementById('aiMedium') || {}).value,
  });
  if (aiPromptBox) aiPromptBox.value = buildPrompt();

  // Keep the shown prompt in sync while the fields change.
  ['aiCount', 'aiSubject', 'aiTopic', 'aiDiff', 'aiMedium'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (aiPromptBox) aiPromptBox.value = buildPrompt();
    });
  });

  on('aiToggle', () => {
    if (!aiPromptBox) return;
    const hidden = aiPromptBox.classList.toggle('hidden');
    if (aiToggleBtn) aiToggleBtn.textContent = hidden ? 'Show prompt' : 'Hide prompt';
    if (!hidden) {
      aiPromptBox.value = buildPrompt();
      aiPromptBox.focus();
      aiPromptBox.select();
    }
  });
  on('aiCopy', async () => {
    const text = buildPrompt();
    if (aiPromptBox) {
      aiPromptBox.classList.remove('hidden');
      aiPromptBox.value = text;
      if (aiToggleBtn) aiToggleBtn.textContent = 'Hide prompt';
    }
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (_e) { /* clipboard blocked (e.g. http origin) - fall back to select */ }
    if (!copied && aiPromptBox) {
      aiPromptBox.focus();
      aiPromptBox.select();
      try { copied = document.execCommand('copy'); } catch (_e) { copied = false; }
    }
    toast(copied
      ? 'Prompt copied - paste it into ChatGPT, Claude, Gemini...'
      : 'Could not copy automatically - the prompt is selected, press Ctrl+C');
  });

  on('cancel', () => {
    preview = { questions: [], errors: [], warnings: [] };
    const review = document.getElementById('review');
    if (review) review.classList.add('hidden');
  });

  on('commit', async () => {
    if (!preview.questions.length) return toast('Nothing valid to save');
    const validQuestions = preview.questions.slice();
    const res = store.addQuestions(validQuestions);
    toast('Saved locally: ' + res.added + ' new, ' + res.updated + ' updated');

    // Share with everybody else when the server is up and this account may add questions.
    try {
      const status = serverStatus.mongo ? serverStatus : await checkServerStatus();
      if (status.mongo) {
        const out = await syncQuestions(validQuestions);
        toast('Shared ' + (out.total || validQuestions.length) + ' question(s) with the server');
        if (out.skipped && out.skipped.length) {
          toast(out.skipped.length + ' question(s) belong to another user and were left untouched');
        }
      }
    } catch (e) {
      // 401/403 = this account may not write to the shared bank; the local copy is already saved.
      toast(e.status === 401 || e.status === 403
        ? 'Saved on this device only - ' + e.message
        : 'Server sync skipped: ' + e.message);
    }

    preview = { questions: [], errors: [], warnings: [] };
    const review = document.getElementById('review');
    if (review) review.classList.add('hidden');
    await refreshStatus();
  });
}

async function handleFiles(files) {
  if (!files || !files.length) return;
  let rows = [];
  const problems = [];
  for (const f of files) {
    try {
      const parsed = await parseFile(f);
      rows = rows.concat(parsed);
    } catch (e) { problems.push(f.name + ': ' + e.message); }
  }
  if (!rows.length && problems.length) return toast(problems.join(' | '));
  showPreview(rows, files.length + ' file(s)');
  if (problems.length) toast(problems.join(' | '));
}


function showPreview(rows, sourceLabel) {
  const res = normaliseList(rows);
  preview = { questions: res.questions, errors: res.errors, warnings: res.warnings };
  document.getElementById('review').classList.remove('hidden');

  document.getElementById('okCount').textContent = res.questions.length + ' valid';
  const errPill = document.getElementById('errCount');
  if (res.errors.length) { errPill.textContent = res.errors.length + ' problem(s)'; errPill.classList.remove('hidden'); }
  else errPill.classList.add('hidden');

  const issues = [];
  if (res.errors.length) {
    issues.push('<div class="explain" style="border-left-color:var(--bad)"><strong>Rows needing a fix (' + res.errors.length + ')</strong><ul style="margin:6px 0 0;padding-left:18px">' +
      res.errors.slice(0, 12).map(e => '<li>' + esc(e) + '</li>').join('') +
      (res.errors.length > 12 ? '<li class="muted">&hellip; ' + (res.errors.length - 12) + ' more</li>' : '') + '</ul></div>');
  }
  if (res.warnings.length) {
    issues.push('<div class="explain" style="border-left-color:var(--warn)"><strong>Skipped duplicates (' + res.warnings.length + ')</strong><ul style="margin:6px 0 0;padding-left:18px">' +
      res.warnings.slice(0, 8).map(w => '<li>' + esc(w) + '</li>').join('') + '</ul></div>');
  }
  issues.push('<p class="help">Read ' + rows.length + ' row(s) from ' + esc(sourceLabel) + '.</p>');
  document.getElementById('issues').innerHTML = issues.join('');

  const tbody = document.querySelector('#previewTable tbody');
  tbody.innerHTML = res.questions.slice(0, 60).map((q, i) =>
    '<tr><td>' + (i + 1) + '</td><td>' + esc(q.subject) + '</td><td>' + esc(q.topic) + '</td>' +
    '<td style="white-space:normal;max-width:340px">' + esc(q.question.hi || q.question.en) + '</td>' +
    '<td><span class="pill ok">' + esc(q.answerLetter) + '</span></td></tr>').join('') ||
    '<tr><td colspan="5" class="muted">No valid rows.</td></tr>';
}

function sampleJson() {
  return [
    {
      id: 'sample-1', subject: 'GK & GS', topic: 'Important Days', difficulty: 'easy',
      question: { hi: 'राष्ट्रीय युवा दिवस कब मनाया जाता है?', en: 'When is National Youth Day celebrated?' },
      options: { hi: ['10 जनवरी', '12 जनवरी', '15 जनवरी', '24 जनवरी'], en: ['10 January', '12 January', '15 January', '24 January'] },
      answer: 'B', explanation: { hi: '', en: '' }, tags: ['days'],
    },
    {
      id: 'sample-2', subject: 'Science', topic: 'Human Body',
      question: { hi: 'मानव शरीर में कुल कितनी हड्डियाँ होती हैं?', en: 'How many bones are there in the human body?' },
      options: { hi: ['206', '208', '204', '210'], en: ['206', '208', '204', '210'] },
      answer: 'A',
    },
  ];
}

async function refreshStatus() {
  const allBank = await getAll();
  const user = store.getQuestions();
  const subjects = new Set(allBank.map(q => q.subject));
  document.getElementById('status').innerHTML =
    '<strong>' + allBank.length + '</strong> questions ready to practise across <strong>' + subjects.size +
    '</strong> subject(s) &middot; <strong>' + user.length + '</strong> imported by you &middot; about ' +
    Math.round(store.usageBytes() / 1024) + ' KB of storage used.';

  const list = document.getElementById('userList');
  if (!user.length) {
    list.innerHTML = '<p class="muted small">Nothing imported yet. The seeded sample questions are shown on the home page.</p>';
    return;
  }
  list.innerHTML = user.slice().reverse().slice(0, 200).map(q =>
    '<div class="row"><span class="grow truncate"><strong>' + esc(q.subject) + '</strong> &middot; ' +
    '<span class="muted">' + esc(q.topic) + '</span><div class="small truncate">' + esc(q.question.hi || q.question.en) + '</div></span>' +
    '<button class="btn sm ghost" data-del="' + esc(q.id) + '">Delete</button></div>').join('');
  list.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      store.removeQuestion(b.getAttribute('data-del'));
      toast('Question deleted');
      await refreshStatus();
    };
  });
}
