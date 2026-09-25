/* ===========================================================
   test.js - test setup + timed test runtime
   =========================================================== */

import { BASE, mountChrome } from './app.js';
import { ready, esc, toast, shuffle, pick, fmtTime, uid, renderField, langOf } from './util.js';
import * as store from './store.js';
import { getAll, mergeQuestions, LETTERS } from './data.js';
import { syncAttempt, fetchQuestions } from './sync.js';
import { canAddQuestions } from './auth.js';

const RUN_KEY = 'stp.run';
let bank = [];
let run = null;         // { questions, answers, flags, idx, endAt, minutes, label, mode }
let timerId = null;

ready(async () => {
  mountChrome({ active: 'pages/test.html' });
  bank = await getAll();

  // Questions another device pushed to the shared server bank live only there -
  // pull them in so every subject that has questions shows up here as well.
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const shared = await fetchQuestions();
    if (Array.isArray(shared) && shared.length) bank = mergeQuestions(bank, shared, store.getHidden());
  }

  if (!bank.length) {
    document.getElementById('setup').innerHTML =
      '<div class="card"><h2>No questions yet</h2><p class="muted">' +
      (canAddQuestions()
        ? 'Load a question bank from the Questions page first.'
        : 'The admin has not added a question bank yet. Tests will appear here once questions are added.') + '</p>' +
      (canAddQuestions()
        ? '<a class="btn primary" href="' + BASE + 'pages/manage.html">Add questions</a>'
        : '') + '</div>';
    return;
  }
  const saved = sessionStorage.getItem(RUN_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.questions && parsed.questions.length) {
        run = parsed;
        if ((run.endAt > Date.now()) || run.mode === 'practice') { renderRun(); startTimer(); return; }
      }
    } catch (e) { /* ignore bad state */ }
    sessionStorage.removeItem(RUN_KEY);
  }
  renderSetup(await loadSyllabusSubjectNames());
});

function saveRun() { try { sessionStorage.setItem(RUN_KEY, JSON.stringify(run)); } catch (e) { /* quota */ } }

/** Shuffle options while remembering where the correct one moved. */
function prepare(q, shufO) {
  if (!shufO) return q;
  const n = Math.max(q.options.hi.length, q.options.en.length);
  const order = shuffle([0, 1, 2, 3, 4, 5].slice(0, n));
  const hi = order.map(i => q.options.hi[i] || '');
  const en = order.map(i => q.options.en[i] || q.options.hi[i] || '');
  const ai = order.indexOf(q.answerIndex);
  return Object.assign({}, q, { options: { hi, en }, answerIndex: ai, answerLetter: LETTERS[ai] });
}

/* ---------------- setup screen ---------------- */

/**
 * Every subject in the bundled syllabus (data/subjects.json, precached by the
 * service worker) - the complete list the Test page offers, no matter how many
 * questions this device happens to have for each one.
 */
async function loadSyllabusSubjectNames() {
  try {
    const res = await fetch(BASE + 'data/subjects.json', { cache: 'no-cache' });
    const list = res.ok ? await res.json() : [];
    return Array.isArray(list)
      ? list.map(s => String((s && s.name) || '').trim()).filter(Boolean)
      : [];
  } catch (_e) {
    return [];                   // offline on a cold cache - the bank subjects still show
  }
}

function renderSetup(syllabusNames = []) {
  const s = store.getSettings();
  const preSubject = new URLSearchParams(location.search).get('subject');
  const map = new Map();
  bank.forEach(q => {
    if (!map.has(q.subject)) map.set(q.subject, { subject: q.subject, count: 0 });
    map.get(q.subject).count++;
  });
  // Every syllabus subject is listed too - one this device has no questions for
  // yet is shown greyed out instead of being left out entirely.
  const known = new Set(Array.from(map.keys()).map(k => String(k).toLowerCase()));
  (syllabusNames || []).forEach(name => {
    const key = String(name).toLowerCase();
    if (known.has(key)) return;
    known.add(key);
    map.set(name, { subject: name, count: 0 });
  });
  const subjects = Array.from(map.values()).sort((a, b) => a.subject.localeCompare(b.subject));

  document.getElementById('setup').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">Start a test</h2>
      <p class="lead">${bank.length} questions available. Pick what to practise &mdash; the timer starts when you press Start.</p>

      <label>Subjects</label>
      <div class="list" id="subjList">
        ${subjects.map(x => `
          <label class="check"><input type="checkbox" class="subj" value="${esc(x.subject)}"
            ${x.count && (!preSubject || preSubject === x.subject) ? 'checked' : ''}${x.count ? '' : ' disabled'}>
            <span>${esc(x.subject)} <span class="muted small">${x.count ? '(' + x.count + ')' : '(no questions yet)'}</span></span></label>`).join('')}
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn sm ghost" id="allSubj" type="button">Select all</button>
        <button class="btn sm ghost" id="noSubj" type="button">Clear</button>
      </div>

      <div class="inline" style="margin-top:14px">
        <div><label for="cnt">Number of questions</label>
          <input type="number" id="cnt" min="1" max="200" value="${s.defaultCount}"></div>
        <div><label for="min">Time limit (minutes)</label>
          <input type="number" id="min" min="1" max="300" value="${s.defaultMinutes}"></div>
      </div>

      <label class="check" style="margin-top:12px"><input type="checkbox" id="shufQ" checked>
        <span>Shuffle question order</span></label>
      <label class="check"><input type="checkbox" id="shufO" ${s.shuffleOptions ? 'checked' : ''}>
        <span>Shuffle the options</span></label>
      <label class="check"><input type="checkbox" id="negative" ${s.negativeMarking ? 'checked' : ''}>
        <span>Negative marking (&minus;1 for each wrong answer)</span></label>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn primary" id="start" type="button">Start test</button>
        <button class="btn" id="practice" type="button">Practice mode (instant answers)</button>
      </div>
      <p class="help">Practice mode shows the correct answer straight away and has no timer. Test mode reveals everything at the end.</p>
    </div>`;

  document.getElementById('allSubj').onclick = () => document.querySelectorAll('.subj:not(:disabled)').forEach(c => { c.checked = true; });
  document.getElementById('noSubj').onclick = () => document.querySelectorAll('.subj:not(:disabled)').forEach(c => { c.checked = false; });
  document.getElementById('start').onclick = () => begin(false);
  document.getElementById('practice').onclick = () => begin(true);
}

function begin(practiceMode) {
  const subjects = Array.from(document.querySelectorAll('.subj:checked')).map(c => c.value);
  const cnt = Math.max(1, parseInt(document.getElementById('cnt').value, 10) || 20);
  const minutes = Math.max(1, parseInt(document.getElementById('min').value, 10) || 20);
  const shufQ = document.getElementById('shufQ').checked;
  const shufO = document.getElementById('shufO').checked;
  const negative = document.getElementById('negative').checked ? 1 : 0;

  const pool = subjects.length ? bank.filter(q => subjects.includes(q.subject)) : bank;
  if (!pool.length) return toast('Select at least one subject');
  const selected = shufQ ? pick(pool, Math.min(cnt, pool.length)) : pool.slice(0, Math.min(cnt, pool.length));

  run = {
    id: uid('t'),
    at: Date.now(),
    mode: practiceMode ? 'practice' : 'test',
    label: practiceMode ? 'Practice' : (subjects.length ? subjects.join(', ') : 'All subjects'),
    subjects,
    questions: selected.map(q => prepare(q, shufO)),
    answers: selected.map(() => null),
    flags: selected.map(() => false),
    idx: 0,
    minutes,
    endAt: practiceMode ? 0 : Date.now() + minutes * 60000,
    negative,
  };
  saveRun();
  renderRun();
  if (!practiceMode) startTimer();
}

/* ---------------- runtime ---------------- */

function startTimer() {
  clearInterval(timerId);
  const tick = () => {
    if (!run) return;
    const left = Math.max(0, Math.round((run.endAt - Date.now()) / 1000));
    const el = document.getElementById('timeLeft');
    if (el) { el.textContent = fmtTime(left); el.classList.toggle('low', left <= 60); }
    const bar = document.getElementById('progressBar');
    if (bar && run.endAt > run.at) {
      const done = (Date.now() - run.at) / (run.endAt - run.at);
      bar.style.width = Math.min(100, Math.max(0, done * 100)) + '%';
    }
    if (left <= 0) { clearInterval(timerId); toast('Time up - submitting'); finish(); }
  };
  tick();
  timerId = setInterval(tick, 1000);
}

function renderRun() {
  const q = run.questions[run.idx];
  const answered = run.answers[run.idx];
  const isPractice = run.mode === 'practice';
  const count = Math.max(q.options.hi.length, q.options.en.length);
  const left = !isPractice ? Math.max(0, Math.round((run.endAt - Date.now()) / 1000)) : 0;

  document.getElementById('setup').innerHTML = `
    <div class="card">
      <div class="qhead">
        <span class="pill brand">Question ${run.idx + 1} / ${run.questions.length}</span>
        <span class="spacer"></span>
        ${isPractice ? '<span class="pill">Practice</span>'
          : '<span class="timer' + (left <= 60 ? ' low' : '') + '" id="timeLeft">' + fmtTime(left) + '</span>'}
        <button class="btn sm ghost" id="flagBtn" type="button">${run.flags[run.idx] ? 'Unflag' : 'Flag'}</button>
      </div>
      <div class="progress" style="margin:6px 0 12px"><i id="progressBar"></i></div>

      ${renderField(q.question)}
      <div class="options" id="opts"></div>
      <div id="feedback"></div>

      <div class="btn-row" style="margin-top:14px">
        <button class="btn" id="prev" type="button" ${run.idx === 0 ? 'disabled' : ''}>&larr; Previous</button>
        ${run.idx < run.questions.length - 1
          ? '<button class="btn primary" id="next" type="button">Next &rarr;</button>'
          : '<button class="btn ok" id="submit" type="button">Finish &amp; see result</button>'}
        <button class="btn ghost" id="quit" type="button">Quit</button>
      </div>

      <h3>Jump to a question</h3>
      <div class="palette" id="palette"></div>
      <p class="help">Blue = answered, orange outline = flagged.</p>
    </div>`;

  const opts = document.getElementById('opts');
  for (let i = 0; i < count; i++) {
    const hi = q.options.hi[i] || q.options.en[i] || '';
    const en = q.options.en[i] || '';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt' + (answered === i ? ' sel' : '');
    b.innerHTML = '<span class="key">' + LETTERS[i] + '</span><span class="otext">' +
      renderField({ hi, en }, { cls: '', enCls: 'en' }) + '</span>';
    b.onclick = () => choose(i);
    opts.appendChild(b);
  }

  document.getElementById('prev').onclick = () => { run.idx--; saveRun(); renderRun(); };
  const next = document.getElementById('next');
  if (next) next.onclick = () => { run.idx++; saveRun(); renderRun(); };
  const submit = document.getElementById('submit');
  if (submit) submit.onclick = () => confirmFinish();
  document.getElementById('quit').onclick = () => {
    if (confirm('Quit this test? Your answers will be lost.')) {
      sessionStorage.removeItem(RUN_KEY);
      location.href = BASE + 'pages/test.html';
    }
  };
  document.getElementById('flagBtn').onclick = () => {
    run.flags[run.idx] = !run.flags[run.idx];
    saveRun(); renderRun();
  };

  const palette = document.getElementById('palette');
  run.questions.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = i + 1;
    if (run.answers[i] != null) b.classList.add('answered');
    if (run.flags[i]) b.classList.add('flagged');
    if (i === run.idx) b.classList.add('current');
    b.onclick = () => { run.idx = i; saveRun(); renderRun(); };
    palette.appendChild(b);
  });

  if (isPractice && answered != null) showPracticeFeedback(q, answered);
  if (!isPractice) startTimer();
}

function choose(i) {
  run.answers[run.idx] = i;
  saveRun();
  document.querySelectorAll('#opts .opt').forEach((b, k) => b.classList.toggle('sel', k === i));
  const palette = document.getElementById('palette');
  if (palette && palette.children[run.idx]) palette.children[run.idx].classList.add('answered');
  if (run.mode === 'practice') showPracticeFeedback(run.questions[run.idx], i);
}

function showPracticeFeedback(q, chosen) {
  const host = document.getElementById('feedback');
  document.querySelectorAll('#opts .opt').forEach((b, k) => {
    b.classList.remove('right', 'wrong');
    if (k === q.answerIndex) b.classList.add('right');
    else if (k === chosen) b.classList.add('wrong');
  });
  const correctText = langOf({ hi: q.options.hi[q.answerIndex] || '', en: q.options.en[q.answerIndex] || '' });
  const explH = q.explanation.hi, explE = q.explanation.en;
  const expl = explH && explE && explH !== explE
    ? esc(explH) + '<div class="muted small">' + esc(explE) + '</div>'
    : esc(explH || explE);
  host.innerHTML = '<div class="explain"><strong>' +
    (chosen === q.answerIndex ? 'Correct!' : 'Correct answer: ' + LETTERS[q.answerIndex] + '. ' + esc(correctText)) +
    '</strong>' + (expl ? '<p style="margin:6px 0 0">' + expl + '</p>' : '') + '</div>';
}

/* ---------------- scoring + save ---------------- */

function finish() {
  clearInterval(timerId);
  const now = Date.now();
  const timeTaken = Math.round((now - run.at) / 1000);
  const penalty = run.negative ? 1 : 0;
  let correct = 0, wrong = 0, skipped = 0, score = 0;

  const details = run.questions.map((q, i) => {
    const a = run.answers[i];
    let status = 'skipped';
    if (a == null) skipped++;
    else if (a === q.answerIndex) { status = 'correct'; correct++; score++; }
    else { status = 'wrong'; wrong++; score -= penalty; }
    return {
      id: q.id, subject: q.subject, topic: q.topic, difficulty: q.difficulty,
      question: q.question, options: q.options, answerIndex: q.answerIndex,
      chosenIndex: a, status, explanation: q.explanation,
    };
  });

  const total = run.questions.length;
  const percent = Math.max(0, Math.round((score / total) * 100));

  const subjectMap = new Map();
  details.forEach(d => {
    if (!subjectMap.has(d.subject)) subjectMap.set(d.subject, { subject: d.subject, total: 0, correct: 0 });
    const s = subjectMap.get(d.subject); s.total++; if (d.status === 'correct') s.correct++;
  });
  const breakdown = Array.from(subjectMap.values())
    .map(s => Object.assign(s, { accuracy: s.total ? Math.round((s.correct / s.total) * 100) : 0 }))
    .sort((a, b) => a.accuracy - b.accuracy);

  const topicMap = new Map();
  details.forEach(d => {
    const key = d.topic || 'General';
    if (!topicMap.has(key)) topicMap.set(key, { subject: d.subject, topic: key, total: 0, correct: 0 });
    const t = topicMap.get(key); t.total++; if (d.status === 'correct') t.correct++;
  });
  const weakTopics = Array.from(topicMap.values())
    .map(t => Object.assign(t, { accuracy: t.total ? Math.round((t.correct / t.total) * 100) : 0 }))
    .filter(t => t.total >= 2 && t.accuracy < 70)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 6);

  const attempt = {
    id: run.id, at: run.at, finishedAt: now, mode: run.mode, label: run.label,
    subjects: run.subjects, total, correct, wrong, skipped,
    score: Math.max(0, score), percent, timeTaken,
    minutes: run.minutes, negative: run.negative,
    breakdown, weakTopics, details,
  };

  store.addAttempt(attempt);
  syncAttempt(attempt); // async fire-and-forget sync to MongoDB (queued offline if unreachable)
  sessionStorage.removeItem(RUN_KEY);
  location.href = BASE + 'pages/result.html?id=' + encodeURIComponent(attempt.id);
}


function confirmFinish() {
  const left = run.questions.length - run.answers.filter(a => a != null).length;
  if (left > 0 && !confirm(left + ' question(s) not answered. Submit anyway?')) return;
  finish();
}

