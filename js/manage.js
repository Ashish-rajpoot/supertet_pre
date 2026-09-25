/* ===========================================================
   manage.js - bulk import questions (Excel / CSV / JSON)
   =========================================================== */

import { mountChrome } from './app.js';
import { ready, esc, toast, download } from './util.js';
import * as store from './store.js';
import { normaliseList, getAll } from './data.js';
import { parseFile, parseJsonText, parseCsvText, downloadTemplate, exportQuestionsXlsx } from './importer.js';

let preview = { questions: [], errors: [], warnings: [] };

ready(async () => {
  mountChrome({ active: 'pages/manage.html' });
  const host = document.getElementById('manage');
  host.innerHTML = layout();
  wire();
  await refreshStatus();
});

function layout() {
  return `
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
  </div>`;
}


function wire() {
  const drop = document.getElementById('drop');
  const fileXlsx = document.getElementById('fileXlsx');
  const fileJson = document.getElementById('fileJson');

  document.getElementById('pickXlsx').onclick = () => fileXlsx.click();
  document.getElementById('pickJson').onclick = () => fileJson.click();
  fileXlsx.onchange = () => handleFiles(fileXlsx.files);
  fileJson.onchange = () => handleFiles(fileJson.files);

  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  document.getElementById('tplBtn').onclick = () => downloadTemplate().catch(e => toast(e.message));
  document.getElementById('jsonSample').onclick = () => download('questions-sample.json', JSON.stringify(sampleJson(), null, 2));

  document.getElementById('pasteBtn').onclick = () => {
    const text = document.getElementById('paste').value.trim();
    if (!text) return toast('Paste something first');
    try {
      const rows = (text.startsWith('[') || text.startsWith('{')) ? parseJsonText(text) : parseCsvText(text);
      showPreview(rows, 'pasted text');
    } catch (e) { toast('Could not read: ' + e.message); }
  };
  document.getElementById('clearPaste').onclick = () => { document.getElementById('paste').value = ''; };

  document.getElementById('cancel').onclick = () => {
    preview = { questions: [], errors: [], warnings: [] };
    document.getElementById('review').classList.add('hidden');
  };

  document.getElementById('commit').onclick = async () => {
    if (!preview.questions.length) return toast('Nothing valid to save');
    const res = store.addQuestions(preview.questions);
    toast('Saved: ' + res.added + ' new, ' + res.updated + ' updated (bank: ' + res.total + ')');
    preview = { questions: [], errors: [], warnings: [] };
    document.getElementById('review').classList.add('hidden');
    await refreshStatus();
  };

  document.getElementById('exportJson').onclick = async () => {
    const all = await getAll();
    download('question-bank.json', JSON.stringify(all, null, 2));
    toast('Exported ' + all.length + ' questions');
  };
  document.getElementById('exportXlsx').onclick = async () => {
    const all = await getAll();
    exportQuestionsXlsx(all, 'question-bank.xlsx')
      .then(() => toast('Exported ' + all.length + ' questions'))
      .catch(e => toast(e.message));
  };
  document.getElementById('exportBackup').onclick = () => {
    download('supertet-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(store.exportAll(), null, 2));
    toast('Backup downloaded');
  };

  const restore = document.getElementById('restoreFile');
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

  document.getElementById('wipe').onclick = async () => {
    if (!confirm('Delete every question you imported? The seeded sample questions stay.')) return;
    store.clearUserQuestions();
    toast('Imported questions deleted');
    await refreshStatus();
  };
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
