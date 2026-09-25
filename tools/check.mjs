/* ===========================================================
   check.mjs - offline self-test for the data layer.

   Run:  node tools/check.mjs
   (Node 18+). It stubs the browser globals the modules need, then
   exercises the schema, storage and analytics code against the real
   data/*.json files. Exits with code 1 if anything is broken.
   =========================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const BASE = '/supertet-prep/';

/* ---------- browser stubs ---------- */
globalThis.location = { pathname: BASE + 'index.html', protocol: 'http:', href: 'http://localhost' + BASE };
const mem = new Map();
globalThis.localStorage = {
  getItem: k => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
  clear: () => mem.clear(),
};
globalThis.window = { addEventListener() {}, dispatchEvent() {}, matchMedia: () => ({ matches: false }) };
globalThis.document = { documentElement: { setAttribute() {} }, querySelector: () => null, createElement: () => ({}) };
globalThis.fetch = async (url) => {
  const rel = String(url).replace(BASE, '').replace(/^\/+/, '');
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return { json: async () => { throw new Error('not found: ' + rel); } };
  return { json: async () => JSON.parse(fs.readFileSync(file, 'utf8')) };
};

const data = await import(pathToFileURL(path.join(ROOT, 'js/data.js')).href);
const store = await import(pathToFileURL(path.join(ROOT, 'js/store.js')).href);
const stats = await import(pathToFileURL(path.join(ROOT, 'js/analytics.js')).href);
const importer = await import(pathToFileURL(path.join(ROOT, 'js/importer.js')).href);

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.error('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
};

/* ---------- 1. answer parsing ---------- */
console.log('\n1) Answer parsing');
ok('letter B -> index 1', data.answerIndex('B', 4) === 1);
ok('lowercase c -> index 2', data.answerIndex('c', 4) === 2);
ok('number 3 -> index 2', data.answerIndex(3, 4) === 2);
ok('number "1" -> index 0', data.answerIndex('1', 4) === 0);
ok('out of range F rejected', data.answerIndex('F', 4) === -1);
ok('empty answer rejected', data.answerIndex('', 4) === -1);

/* ---------- 2. normalisation of a spreadsheet row ---------- */
console.log('\n2) Spreadsheet row -> canonical question');
const flat = {
  Subject: 'GK & GS', Topic: 'Days', Difficulty: 'Hard',
  Q_hi: 'राष्ट्रीय युवा दिवस कब?', Q_en: 'When is National Youth Day?',
  opt1_hi: '10 जनवरी', opt2_hi: '12 जनवरी', opt3_hi: '15 जनवरी', opt4_hi: '24 जनवरी',
  opt1_en: '10 January', opt2_en: '12 January', opt3_en: '15 January', opt4_en: '24 January',
  answer: 'b', expl_en: '12 January', tags: 'days, national',
};
const { q: fq, errors: ferr } = data.normaliseRow(flat, 2);
ok('no validation errors', ferr.length === 0, ferr.join('; '));
ok('subject kept', fq.subject === 'GK & GS');
ok('difficulty lowercased', fq.difficulty === 'hard');
ok('4 hindi options', fq.options.hi.length === 4, JSON.stringify(fq.options.hi));
ok('answer index from "b"', fq.answerIndex === 1);
ok('answer letter set', fq.answerLetter === 'B');
ok('tags split', fq.tags.length === 2 && fq.tags[1] === 'national', JSON.stringify(fq.tags));
ok('id auto generated', !!fq.id);

const enOnly = data.normaliseRow({ q_en: 'Capital of India?', opt1_en: 'Delhi', opt2_en: 'Mumbai', answer: 'A' }, 3);
ok('english-only row valid', enOnly.errors.length === 0, enOnly.errors.join('; '));
ok('english options copied to hindi slot', enOnly.q.options.hi.length === 2);

const bad = data.normaliseRow({ q_hi: 'no options here', answer: 'A' }, 4);
ok('missing options flagged', bad.errors.length > 0, bad.errors.join('; '));

/* ---------- 3. list normalisation + duplicate detection ---------- */
console.log('\n3) Bulk list handling');
const list = data.normaliseList([flat, flat, { q_hi: 'x' }, flat]);
ok('1 valid question kept', list.questions.length === 1, String(list.questions.length));
ok('2 duplicates reported', list.warnings.length === 2, String(list.warnings.length));
ok('broken row reported with all problems', list.errors.length === 3, list.errors.join(' | '));


/* ---------- 4. seed data files ---------- */
console.log('\n4) Seed data files');
const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
ok('index lists files', Array.isArray(index.files) && index.files.length > 0);
let total = 0;
for (const file of index.files) {
  const p = path.join(ROOT, 'data', file);
  ok('exists: ' + file, fs.existsSync(p));
  if (!fs.existsSync(p)) continue;
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  const res = data.normaliseList(rows);
  ok(file + ' -> valid questions: ' + res.questions.length,
    res.questions.length > 0 && res.errors.length === 0, res.errors.slice(0, 3).join('; '));
  ok(file + ' -> every question has an answer', res.questions.every(q => q.answerIndex >= 0));
  total += res.questions.length;
}
console.log('  total seeded questions: ' + total);

/* ---------- 5. storage round trip ---------- */
console.log('\n5) Storage');
store.clearUserQuestions();
const added = store.addQuestions(list.questions);
ok('question stored', added.added === 1 && store.getQuestions().length === 1);
const again = store.addQuestions(list.questions);
ok('re-import updates, does not duplicate', again.updated === 1 && again.total === 1);
store.removeQuestion(list.questions[0].id);
ok('question removed', store.getQuestions().length === 0);

/* ---------- 6. attempts + analytics ---------- */
console.log('\n6) Attempts and analytics');
const mk = (percent, statuses) => {
  const details = statuses.map((s, i) => ({
    id: 'q' + i, subject: 'GK & GS', topic: i % 2 ? 'Days' : 'Awards', difficulty: 'easy',
    status: s, answerIndex: 0, chosenIndex: s === 'correct' ? 0 : 1, question: { hi: 'q', en: '' },
    options: { hi: ['a', 'b'], en: ['a', 'b'] }, explanation: { hi: '', en: '' },
  }));
  return {
    id: 'a' + percent, at: Date.now(), label: 'Test ' + percent, total: details.length,
    correct: details.filter(d => d.status === 'correct').length,
    wrong: details.filter(d => d.status === 'wrong').length,
    skipped: details.filter(d => d.status === 'skipped').length,
    score: details.filter(d => d.status === 'correct').length,
    percent, timeTaken: 300,
    breakdown: [{ subject: 'GK & GS', total: details.length, correct: 1, accuracy: percent }],
    weakTopics: [{ subject: 'GK & GS', topic: 'Days', total: 2, correct: 0, accuracy: percent }],
    details,
  };
};
store.clearAttempts();
store.addAttempt(mk(50, ['correct', 'wrong', 'skipped', 'correct']));
store.addAttempt(mk(100, ['correct', 'correct']));
const s = stats.summary();
ok('2 attempts counted', s.attempts === 2, String(s.attempts));
ok('average score', s.avgScore === 75, String(s.avgScore));
ok('best score', s.bestScore === 100, String(s.bestScore));
ok('accuracy computed', s.accuracy === 67, String(s.accuracy));
const bd = stats.breakdown();
ok('topic breakdown built', bd.topics.length >= 1, JSON.stringify(bd.topics));
ok('weak topic detected', stats.weakTopics().length >= 1);
ok('sparkline renders svg', stats.sparkline([10, 50, 90]).startsWith('<svg'));
ok('report text has score', stats.reportText(store.getAttempts()[0]).includes('Score:'));
ok('backup export shape', store.exportAll().app === 'supertet-prep');
ok('storage usage reported', store.usageBytes() > 0);

/* ---------- 7. import parsing ---------- */
console.log('\n7) File import parsing');
const csv = 'subject,q_hi,q_en,opt1_hi,opt2_hi,opt3_hi,opt4_hi,answer\nGK,Q,When is it?,a,b,c,d,A\n';
const rows = importer.parseCsvText(csv);
ok('csv parsed', rows.length === 1 && rows[0].answer === 'A', JSON.stringify(rows));
const jsonRows = importer.parseJsonText(JSON.stringify({ 'GK & GS': [{ q_hi: 'a', opt1_hi: '1', opt2_hi: '2', answer: 'A' }] }));
ok('grouped json gets subject', jsonRows[0].subject === 'GK & GS', JSON.stringify(jsonRows));
const rowsOut = importer.questionsToRows(list.questions);
ok('flat export has opt1_hi', rowsOut[0].opt1_hi === list.questions[0].options.hi[0]);
ok('flat export keeps answer letter', rowsOut[0].answer === list.questions[0].answerLetter);

/* ---------- 8. static integrity: imports + html asset references ---------- */
console.log('\n8) Import and asset integrity');
const jsDir = path.join(ROOT, 'js');
const src = {};
for (const f of fs.readdirSync(jsDir)) src[f] = fs.readFileSync(path.join(jsDir, f), 'utf8');

const exportedNames = (code) => {
  const names = new Set();
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]+)\}/g)) {
    m[1].split(',').forEach(p => names.add(p.split(/\s+as\s+/).pop().trim()));
  }
  return names;
};

let brokenImports = 0;
for (const [file, code] of Object.entries(src)) {
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([A-Za-z0-9_.-]+)'/g)) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    const target = m[2];
    const available = exportedNames(src[target] || '');
    for (const n of names) {
      if (!available.has(n)) {
        brokenImports++;
        console.error('  FAIL  ' + file + ' imports "' + n + '" which ' + target + ' does not export');
      }
    }
  }
}
ok('every named import resolves', brokenImports === 0, brokenImports + ' broken import(s)');

const htmlFiles = ['index.html', '404.html',
  'pages/test.html', 'pages/result.html', 'pages/analytics.html',
  'pages/flashcards.html', 'pages/manage.html'];
let brokenRefs = 0;
for (const html of htmlFiles) {
  const p = path.join(ROOT, html);
  ok('page exists: ' + html, fs.existsSync(p));
  if (!fs.existsSync(p)) continue;
  const code = fs.readFileSync(p, 'utf8');
  for (const m of code.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1];
    if (/^(https?:|#|mailto:)/.test(ref)) continue;
    const resolved = path.resolve(path.dirname(p), ref);
    if (!fs.existsSync(resolved)) {
      brokenRefs++;
      console.error('  FAIL  ' + html + ' references missing file ' + ref);
    }
  }
}
ok('all local html references exist', brokenRefs === 0, brokenRefs + ' missing reference(s)');

const swCode = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
let missingCache = 0;
for (const m of swCode.matchAll(/'\.\/([^']+)'/g)) {
  if (!fs.existsSync(path.join(ROOT, m[1]))) {
    missingCache++;
    console.error('  FAIL  sw.js caches missing file ' + m[1]);
  }
}
ok('service worker precache list is complete', missingCache === 0, missingCache + ' missing file(s)');


console.log('\n' + (failures ? 'FAILED: ' + failures + ' check(s) need attention.' : 'ALL CHECKS PASSED.'));
process.exit(failures ? 1 : 0);
