/* ===========================================================
   subjects.js - admin page for the syllabus: subjects + topics.

   Only an admin may change it (the API enforces that as well).
   When the server / MongoDB is offline the bundled
   data/subjects.json is shown read-only, so the page still has
   something useful to show without a backend.
   =========================================================== */

import { BASE, mountChrome, openAuthModal } from './app.js';
import { ready, esc, toast } from './util.js';
import {
  checkServerStatus, fetchSubjects, saveSubject, updateSubject, deleteSubject,
  addTopic, updateTopic, deleteTopic,
} from './sync.js';
import { getCurrentUser, isLoggedIn, isAdmin } from './auth.js';

/** Working copy of the syllabus plus the tiny bit of UI state. */
const state = {
  subjects: [],
  source: 'file',     // 'server' once the list came from MongoDB, otherwise 'file'
  query: '',
  busy: false,
  editSubject: null,  // id of the subject being renamed
  editTopic: null,    // { subjectId, topicId } of the topic being renamed
};

ready(async () => {
  mountChrome({ active: 'pages/subjects.html' });
  await render();
  // Logging in or out must unlock (or lock) the editor straight away.
  window.addEventListener('stp:auth', () => render());
});

/** Load the syllabus from the API; fall back to the bundled JSON file. */
async function load() {
  const status = await checkServerStatus();
  const remote = status.mongo ? await fetchSubjects() : null;
  // null = could not ask the server. An empty array is a real answer.
  if (remote !== null) {
    state.subjects = remote;
    state.source = 'server';
    return;
  }
  try {
    const res = await fetch(BASE + 'data/subjects.json', { cache: 'no-cache' });
    state.subjects = res.ok ? await res.json() : [];
  } catch (_e) {
    state.subjects = [];
  }
  state.source = 'file';
}

async function render() {
  const host = document.getElementById('subjects');
  if (!host) return;
  await load();
  host.innerHTML = layout();
  wire(host);
}

/** Editing needs both an admin account and a reachable database. */
const canEdit = () => isAdmin() && state.source === 'server';

const topicCount = (list) => (list || []).reduce((n, s) => n + (s.topics || []).length, 0);

/** Subjects matching the search box (a subject matches as a whole, or by topic). */
function visibleSubjects() {
  const q = state.query.trim().toLowerCase();
  if (!q) return state.subjects;
  return state.subjects
    .map((s) => {
      const inSubject = (s.name + ' ' + (s.nameHi || '')).toLowerCase().indexOf(q) >= 0;
      if (inSubject) return s;
      const topics = (s.topics || []).filter(t =>
        (t.name + ' ' + (t.nameHi || '')).toLowerCase().indexOf(q) >= 0);
      return topics.length ? Object.assign({}, s, { topics }) : null;
    })
    .filter(Boolean);
}

/* ---------------- markup ---------------- */

function layout() {
  return [
    statusCard(),
    isLoggedIn() ? '' : loginCard(),
    (isLoggedIn() && !isAdmin()) ? permissionCard() : '',
    canEdit() ? addSubjectCard() : '',
    state.subjects.length ? searchRow() : '',
    '<div class="list">' + (visibleSubjects().map(subjectCard).join('') || emptyCard()) + '</div>',
  ].join('');
}

function statusCard() {
  const onServer = state.source === 'server';
  const total = topicCount(state.subjects);
  return `
  <div class="card">
    <div class="stat-row">
      <div class="stat"><div class="k">Subjects</div><div class="v">${state.subjects.length}</div></div>
      <div class="stat"><div class="k">Topics</div><div class="v">${total}</div></div>
    </div>
    <p class="small muted" style="margin:10px 0 0">
      <span class="pill ${onServer ? 'ok' : 'warn'}">${onServer ? 'Saved on the server' : 'Bundled file'}</span>
      ${onServer
        ? 'Changes are stored in MongoDB and shared with every device.'
        : 'The server is offline, so this is a read-only view of data/subjects.json. Start the backend to add or edit subjects.'}
    </p>
    ${canEdit()
      ? `<div class="btn-row" style="margin-top:10px">
           <button class="btn sm" id="importSyllabus" type="button">Import bundled syllabus</button>
           <span class="help" style="align-self:center">Adds every subject from data/subjects.json that is not here yet.</span>
         </div>`
      : ''}
  </div>`;
}

function loginCard() {
  return `
  <div class="card">
    <h2 style="margin-top:0">Managing subjects needs a login</h2>
    <p class="lead">The syllabus is maintained by the site admin. Everyone can still read it while
      practising, taking tests or using flashcards.</p>
    <div class="btn-row"><button class="btn primary" id="subjLogin" type="button">Log in</button></div>
  </div>`;
}

function permissionCard() {
  const me = getCurrentUser() || {};
  return `
  <div class="card">
    <h2 style="margin-top:0">Admin only</h2>
    <p class="lead">You are signed in as <strong>${esc(me.name || 'Student')}</strong>, but only the
      site admin can add or change subjects and topics. Ask the admin if you need access.</p>
  </div>`;
}
function addSubjectCard() {
  return `
  <div class="card">
    <h2 style="margin-top:0">Add a subject <span class="muted small">विषय जोड़ें</span></h2>
    <form id="subjectForm" class="inline">
      <label class="small" for="subjName">English name
        <input id="subjName" placeholder="e.g. Mathematics" required maxlength="120">
      </label>
      <label class="small" for="subjNameHi">हिंदी नाम
        <input id="subjNameHi" placeholder="जैसे: गणित" maxlength="120">
      </label>
      <span style="flex:0 0 auto"><button class="btn primary" type="submit">Add subject</button></span>
    </form>
    <p class="help">Topics are added inside the subject card below.</p>
  </div>`;
}

function searchRow() {
  return `
  <div class="card" style="padding:10px 15px;margin-bottom:12px">
    <input id="subjSearch" type="search" style="width:100%"
      placeholder="Search subjects or topics... खोजें" value="${esc(state.query)}">
  </div>`;
}

function subjectCard(s) {
  const topics = s.topics || [];
  const editing = state.editSubject === s.id;

  const header = editing
    ? `<form class="inline" data-subject-edit="${esc(s.id)}">
        <label class="small">English name
          <input data-f="name" value="${esc(s.name)}" required maxlength="120">
        </label>
        <label class="small">हिंदी नाम
          <input data-f="nameHi" value="${esc(s.nameHi || '')}" maxlength="120">
        </label>
        <span class="btn-row" style="flex:0 0 auto">
          <button class="btn sm primary" type="submit">Save</button>
          <button class="btn sm ghost" type="button" data-cancel>Cancel</button>
        </span>
      </form>`
    : `<div class="row" style="align-items:flex-start">
        <span class="grow">
          <strong>${esc(s.name)}</strong>${s.nameHi ? ' <span class="muted">' + esc(s.nameHi) + '</span>' : ''}
          <div class="muted small">${topics.length} topic${topics.length === 1 ? '' : 's'}</div>
        </span>
        ${canEdit()
          ? `<span class="btn-row" style="flex:0 0 auto">
              <button class="btn sm ghost" type="button" data-rename="${esc(s.id)}">Rename</button>
              <button class="btn sm bad" type="button" data-del-subject="${esc(s.id)}">Delete</button>
            </span>`
          : ''}
      </div>`;

  const chips = topics.length
    ? '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:10px">' +
        topics.map(t => topicChip(s, t)).join('') + '</div>'
    : '<p class="small muted" style="margin:10px 0 0">No topics yet.</p>';

  const adder = canEdit()
    ? `<form class="inline" data-topic-form="${esc(s.id)}" style="margin-top:10px">
        <label class="small">New topic (English)
          <input data-f="name" placeholder="e.g. Percentage" required maxlength="160">
        </label>
        <label class="small">विषय-वस्तु (हिंदी)
          <input data-f="nameHi" placeholder="जैसे: प्रतिशत" maxlength="160">
        </label>
        <span style="flex:0 0 auto"><button class="btn sm primary" type="submit">Add topic</button></span>
      </form>`
    : '';

  return `<div class="card">${header}${chips}${adder}</div>`;
}

function topicChip(s, t) {
  const editing = state.editTopic && state.editTopic.subjectId === s.id &&
    state.editTopic.topicId === t.id;

  if (editing) {
    return `<form class="inline" data-topic-edit="${esc(s.id)}|${esc(t.id)}" style="flex:1 1 100%">
        <label class="small">English
          <input data-f="name" value="${esc(t.name)}" required maxlength="160">
        </label>
        <label class="small">हिंदी
          <input data-f="nameHi" value="${esc(t.nameHi || '')}" maxlength="160">
        </label>
        <span class="btn-row" style="flex:0 0 auto">
          <button class="btn sm primary" type="submit">Save</button>
          <button class="btn sm ghost" type="button" data-cancel>Cancel</button>
        </span>
      </form>`;
  }

  const label = esc(t.name) + (t.nameHi ? ' <span class="muted">' + esc(t.nameHi) + '</span>' : '');
  if (!canEdit()) return `<span class="pill">${label}</span>`;

  return `<span class="pill" style="display:inline-flex;align-items:center;gap:5px">
      <span>${label}</span>
      <button class="btn sm ghost" type="button" data-edit-topic="${esc(s.id)}|${esc(t.id)}"
        style="padding:0 5px;font-size:14px;line-height:1.4" title="Edit topic" aria-label="Edit topic">&#9998;</button>
      <button class="btn sm ghost" type="button" data-del-topic="${esc(s.id)}|${esc(t.id)}"
        style="padding:0 5px;font-size:15px;line-height:1.4" title="Delete topic" aria-label="Delete topic">&times;</button>
    </span>`;
}

function emptyCard() {
  const msg = state.subjects.length
    ? 'Nothing matches "' + state.query + '".'
    : (canEdit()
        ? 'No subjects yet. Add one above, or import the bundled syllabus.'
        : 'The syllabus has not been published yet.');
  return `<div class="card"><p class="muted">${esc(msg)}</p></div>`;
}
/* ---------------- wiring ---------------- */

function wire(host) {
  const loginBtn = host.querySelector('#subjLogin');
  if (loginBtn) loginBtn.onclick = () => openAuthModal('login');

  const importBtn = host.querySelector('#importSyllabus');
  if (importBtn) importBtn.onclick = () => run(importBundled);

  const form = host.querySelector('#subjectForm');
  if (form) form.onsubmit = e => { e.preventDefault(); run(() => onSubmitSubject(form)); };

  const search = host.querySelector('#subjSearch');
  if (search) {
    search.oninput = () => {
      state.query = search.value;
      const list = host.querySelector('.list');
      if (list) list.innerHTML = visibleSubjects().map(subjectCard).join('') || emptyCard();
      bindList(host);
    };
  }
  bindList(host);
}

/** Bind every control inside the subject list (re-run after each partial redraw). */
function bindList(host) {
  const list = host.querySelector('.list');
  if (!list) return;

  list.querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.onclick = () => { state.editSubject = null; state.editTopic = null; render(); };
  });
  list.querySelectorAll('[data-rename]').forEach((btn) => {
    btn.onclick = () => {
      state.editSubject = btn.getAttribute('data-rename');
      state.editTopic = null;
      render();
    };
  });
  list.querySelectorAll('[data-edit-topic]').forEach((btn) => {
    btn.onclick = () => {
      const parts = btn.getAttribute('data-edit-topic').split('|');
      state.editTopic = { subjectId: parts[0], topicId: parts[1] };
      state.editSubject = null;
      render();
    };
  });
  list.querySelectorAll('[data-del-subject]').forEach((btn) => {
    btn.onclick = () => run(() => removeSubject(btn.getAttribute('data-del-subject')));
  });
  list.querySelectorAll('[data-del-topic]').forEach((btn) => {
    btn.onclick = () => {
      const parts = btn.getAttribute('data-del-topic').split('|');
      run(() => removeTopic(parts[0], parts[1]));
    };
  });
  list.querySelectorAll('[data-subject-edit]').forEach((f) => {
    f.onsubmit = (e) => { e.preventDefault(); run(() => onSubmitSubjectEdit(f)); };
  });
  list.querySelectorAll('[data-topic-form]').forEach((f) => {
    f.onsubmit = (e) => { e.preventDefault(); run(() => onSubmitTopic(f)); };
  });
  list.querySelectorAll('[data-topic-edit]').forEach((f) => {
    f.onsubmit = (e) => { e.preventDefault(); run(() => onSubmitTopicEdit(f)); };
  });
}

/* ---------------- actions ---------------- */

/** Read one trimmed field of a form. */
function field(form, name) {
  const el = form.querySelector('[data-f="' + name + '"]');
  return el ? el.value.trim() : '';
}

/** Run one async action, ignoring clicks that arrive while it is still busy. */
async function run(fn) {
  if (state.busy || typeof fn !== 'function') return;
  state.busy = true;
  try {
    await fn();
  } catch (err) {
    toast(err && err.message ? err.message : 'Something went wrong');
  } finally {
    state.busy = false;
  }
}

async function onSubmitSubject(form) {
  const name = field(form, 'name');
  const nameHi = field(form, 'nameHi');
  if (!name) return;
  await saveSubject({ name, nameHi });
  toast('Subject added: ' + name);
  await render();
}

async function onSubmitSubjectEdit(form) {
  const id = form.getAttribute('data-subject-edit');
  const name = field(form, 'name');
  const nameHi = field(form, 'nameHi');
  if (!name) return;
  await updateSubject(id, { name, nameHi });
  state.editSubject = null;
  toast('Subject updated');
  await render();
}

async function onSubmitTopic(form) {
  const subjectId = form.getAttribute('data-topic-form');
  const name = field(form, 'name');
  const nameHi = field(form, 'nameHi');
  if (!name) return;
  await addTopic(subjectId, { name, nameHi });
  toast('Topic added: ' + name);
  await render();
}

async function onSubmitTopicEdit(form) {
  const parts = form.getAttribute('data-topic-edit').split('|');
  const name = field(form, 'name');
  const nameHi = field(form, 'nameHi');
  if (!name) return;
  await updateTopic(parts[0], parts[1], { name, nameHi });
  state.editTopic = null;
  toast('Topic updated');
  await render();
}

async function removeSubject(id) {
  const s = state.subjects.find(x => x.id === id);
  if (!s) return;
  const n = (s.topics || []).length;
  if (!confirm('Delete "' + s.name + '"' + (n ? ' and its ' + n + ' topic(s)' : '') + '? This cannot be undone.')) return;
  await deleteSubject(id);
  state.editSubject = null;
  toast('Subject deleted');
  await render();
}

async function removeTopic(subjectId, topicId) {
  const s = state.subjects.find(x => x.id === subjectId);
  const t = s && (s.topics || []).find(x => x.id === topicId);
  if (!t) return;
  if (!confirm('Delete the topic "' + t.name + '"?')) return;
  await deleteTopic(subjectId, topicId);
  state.editTopic = null;
  toast('Topic deleted');
  await render();
}

/** Pull data/subjects.json into the server, skipping subjects that exist. */
async function importBundled() {
  const res = await fetch(BASE + 'data/subjects.json', { cache: 'no-cache' });
  const list = res.ok ? await res.json() : [];
  if (!Array.isArray(list) || !list.length) throw new Error('No bundled syllabus found');
  let added = 0;
  let skipped = 0;
  for (const s of list) {
    try {
      await saveSubject({ name: s.name, nameHi: s.nameHi, topics: s.topics });
      added++;
    } catch (err) {
      if (err && err.status === 409) { skipped++; continue; }
      throw err;
    }
  }
  toast('Imported ' + added + ' subject(s)' + (skipped ? ', ' + skipped + ' already existed' : ''));
  await render();
}