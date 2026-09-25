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

/* user-wise (per account) grouping used by the analytics page */
store.clearAttempts();
store.addAttempt(Object.assign(mk(40, ['correct', 'wrong']), { userId: 'u_aa', student: 'Aarav' }));
store.addAttempt(Object.assign(mk(80, ['correct', 'correct']), { userId: 'u_aa', student: 'Aarav' }));
store.addAttempt(Object.assign(mk(60, ['correct', 'skipped']), { userId: 'u_bb', student: 'Bhavna' }));
const perUser = stats.groupByStudent(store.getAttempts());
ok('groupByStudent makes one row per account', perUser.length === 2, String(perUser.length));
ok('per-user totals are separate', perUser[0].userId === 'u_aa' && perUser[0].attempts === 2, JSON.stringify(perUser[0]));
ok('per-user average is per user', perUser[0].avgPercent === 60, String(perUser[0].avgPercent));
ok('second user kept apart', perUser[1].name === 'Bhavna' && perUser[1].attempts === 1, JSON.stringify(perUser[1]));
store.clearAttempts();

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
  'pages/flashcards.html', 'pages/manage.html', 'pages/profile.html',
  'pages/subjects.html'];
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


/* ---------- 9. AI question prompt (js/ai-prompt.js + AI-QUESTION-PROMPT.md) ---------- */
console.log('\n9) AI question prompt');
const ai = await import(pathToFileURL(path.join(ROOT, 'js/ai-prompt.js')).href);
const built = ai.buildAiPrompt({ count: 7, subject: 'Science', topic: 'Human Body', difficulty: 'easy', medium: 'English' });
ok('placeholders replaced',
  !built.includes('{{') && built.includes('7') && built.includes('Science') && built.includes('Human Body') && built.includes('easy'));
ok('defaults used for blank inputs',
  !ai.buildAiPrompt({}).includes('{{') && ai.buildAiPrompt({}).includes('General')
  && ai.buildAiPrompt({}).includes('(medium: Hindi)'));
ok('medium option respected',
  built.includes('(medium: English)') && ai.buildAiPrompt({ medium: 'Hindi + English' }).includes('(medium: Hindi + English)')
  && ai.buildAiPrompt({ medium: 'French' }).includes('(medium: Hindi)'));
ok('clamps silly counts', !ai.buildAiPrompt({ count: 9999 }).includes('9999'));
ok('import column list present',
  ['q_hi', 'q_en', 'opt1_hi', 'opt4_hi', 'opt1_en', 'opt4_en', 'answer', 'expl_hi', 'expl_en', 'tags']
    .every(k => built.includes(k)));

/* the EXAMPLE block inside the prompt must be a valid JSON array of one row */
const arrStart = built.indexOf('[', built.indexOf('EXAMPLE'));
const arrEnd = built.indexOf(']', arrStart) + 1;
let example = null;
try { example = JSON.parse(built.slice(arrStart, arrEnd)); } catch (_e) { example = null; }
ok('prompt example parses as JSON',
  Array.isArray(example) && example.length === 1 && example[0].answer === 'B' && example[0].opt4_en === '24 January',
  example ? JSON.stringify(example) : 'unparseable');

const aiMd = path.join(ROOT, 'AI-QUESTION-PROMPT.md');
ok('AI-QUESTION-PROMPT.md exists', fs.existsSync(aiMd));
if (fs.existsSync(aiMd)) {
  const md = fs.readFileSync(aiMd, 'utf8');
  ok('md keeps all four placeholders',
    ai.AI_PROMPT_PLACEHOLDERS.every(s => md.includes(s)));
  // template literals cook CRLF -> LF at parse time, the raw md keeps its CRLF: normalise first
  const normEol = s => s.replace(/\r\n?/g, '\n');
  ok('md embeds the same prompt text as the app',
    normEol(md).includes(normEol(ai.AI_PROMPT_TEMPLATE)));
  ok('md explains how to import the reply', /paste/i.test(md) && /JSON/i.test(md));
}

/* ---------- 10. syllabus seed data (data/subjects.json) ---------- */
console.log('\n10) Syllabus seed data');
const syllabusPath = path.join(ROOT, 'data/subjects.json');
ok('data/subjects.json exists', fs.existsSync(syllabusPath));
if (fs.existsSync(syllabusPath)) {
  let syllabus = null;
  try { syllabus = JSON.parse(fs.readFileSync(syllabusPath, 'utf8')); } catch (e) { syllabus = null; }
  ok('syllabus parses as JSON', Array.isArray(syllabus), 'invalid JSON');
  if (Array.isArray(syllabus)) {
    ok('has subjects', syllabus.length >= 9, syllabus.length + ' subject(s)');
    const names = syllabus.map(s => String(s.name || '').toLowerCase());
    ok('subject names are unique', new Set(names).size === names.length && names.every(Boolean));
    ok('every subject has a Hindi name', syllabus.every(s => String(s.nameHi || '').trim().length > 0));

    const topicTotal = syllabus.reduce((n, s) => n + (Array.isArray(s.topics) ? s.topics.length : 0), 0);
    ok('every subject has topics', syllabus.every(s => Array.isArray(s.topics) && s.topics.length > 0));
    ok('at least 200 topics seeded', topicTotal >= 200, topicTotal + ' topic(s)');

    let topicProblems = 0;
    for (const s of syllabus) {
      const seen = new Set();
      for (const t of (s.topics || [])) {
        const n = String(t.name || '').trim();
        const hi = String(t.nameHi || '').trim();
        if (!n || !hi || seen.has(n.toLowerCase())) topicProblems++;
        seen.add(n.toLowerCase());
      }
    }
    ok('every topic has an English and a Hindi name, no duplicates', topicProblems === 0,
      topicProblems + ' problem(s)');

    // The seeder and the admin API both rely on these being present.
    const expected = ['Mathematics', 'Hindi', 'English', 'Science', 'History', 'Geography', 'Civics'];
    ok('the core SuperTET subjects are seeded',
      expected.every(name => names.includes(name.toLowerCase())),
      'missing: ' + expected.filter(name => !names.includes(name.toLowerCase())).join(', '));
  }
}

/* ---------- 11. AI prompt search boxes (js/ai-prompt.js + js/combo.js) ---------- */
console.log('\n11) AI prompt subject / topic suggestions');
const combo = await import(pathToFileURL(path.join(ROOT, 'js/combo.js')).href);

const demo = [
  { name: 'Science', nameHi: 'विज्ञान', topics: [{ name: 'Human Body', nameHi: 'मानव शरीर' }, { name: 'Light', nameHi: 'प्रकाश' }] },
  { name: 'Hindi', nameHi: 'हिंदी', topics: [{ name: 'Unseen Passage', nameHi: 'अपठित गद्यांश' }] },
];
const subjectChoices = ai.buildSubjectChoices(demo, ['GK & GS', 'Science']);
ok('syllabus subjects come first with the Hindi name as hint',
  subjectChoices.length === 3 && subjectChoices[0].value === 'Science' && subjectChoices[0].sub === 'विज्ञान',
  JSON.stringify(subjectChoices));
ok('bank-only subjects are appended, duplicates dropped',
  subjectChoices[2].value === 'GK & GS' && subjectChoices[2].sub === 'already in your bank');

const demoBank = [{ subject: 'Science', topic: 'Human Body' }, { subject: 'Science', topic: 'Old Topic' }];
const scienceTopics = ai.buildTopicChoices(demo, demoBank, 'science');
ok('topics follow the chosen subject (case-insensitive), duplicates skipped',
  scienceTopics.length === 3 && scienceTopics[2].value === 'Old Topic', JSON.stringify(scienceTopics));
const allTopics = ai.buildTopicChoices(demo, []);
ok('a blank subject lists every topic with its subject as hint',
  allTopics.length === 3 && allTopics[0].sub === 'मानव शरीर \u00b7 Science', JSON.stringify(allTopics[0]));

ok('search matches the label', combo.filterMatches(subjectChoices, 'hindi').length === 1);
ok('search matches the Hindi hint',
  combo.filterMatches(demo[0].topics.map(t => ({ value: t.name, label: t.name, sub: t.nameHi })), 'प्रकाश')[0].value === 'Light');
ok('a blank query keeps every row in order', combo.filterMatches(subjectChoices, '').length === 3);
ok('the limit caps the rows', combo.filterMatches(['Maths', 'Science', 'Hindi'], '', 2).length === 2);
ok('blank / missing choices are ignored', combo.filterMatches([null, '', '  ', { label: '' }, 'Maths'], '').length === 1);

// The bundled syllabus must power the boxes too.
if (fs.existsSync(syllabusPath)) {
  const real = JSON.parse(fs.readFileSync(syllabusPath, 'utf8'));
  const realSubjects = ai.buildSubjectChoices(real, []);
  ok('every syllabus subject is offered', realSubjects.length === real.length && realSubjects.every(c => c.value),
    realSubjects.length + ' of ' + real.length);
  const biggest = real.slice().sort((a, b) => (b.topics || []).length - (a.topics || []).length)[0];
  const realTopics = ai.buildTopicChoices(real, [], biggest.name);
  ok('the chosen subject offers exactly its own topics', realTopics.length === biggest.topics.length,
    realTopics.length + ' vs ' + biggest.topics.length);
  ok('a real topic is findable by typing its name', combo.filterMatches(realTopics, biggest.topics[0].name).length >= 1);
  ok('a real topic is findable by its Hindi name',
    combo.filterMatches(realTopics, biggest.topics[0].nameHi)[0].value === biggest.topics[0].name);
}

/* ---------- 12. searchable dropdown wiring (js/combo.js) ---------- */
// A mini DOM is enough to prove the keyboard / click behaviour of the suggestions
// under the Subject and Topic boxes; jsdom would be a dependency for nothing.
console.log('\n12) Searchable dropdown');

const mkEl = (id) => {
  const el = {
    id, value: '', innerHTML: '', attrs: {}, listeners: {}, isConnected: true,
    classList: {
      set: new Set(['hidden']),
      add(...c) { c.forEach(x => this.set.add(x)); },
      remove(...c) { c.forEach(x => this.set.delete(x)); },
      contains(c) { return this.set.has(c); },
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { el.listeners[t] = (el.listeners[t] || []).filter(f => f !== fn); },
    dispatchEvent(ev) { (el.listeners[ev.type] || []).forEach(fn => fn(ev)); return true; },
    fire(type, props = {}) {
      const ev = Object.assign({ type, target: el, preventDefault() {} }, props);
      (el.listeners[type] || []).forEach(fn => fn(ev));
      return ev;
    },
    contains() { return false; },
    querySelector() { return null; },
  };
  return el;
};

const docHandlers = {};
globalThis.document = {
  addEventListener(t, fn) { (docHandlers[t] = docHandlers[t] || []).push(fn); },
  removeEventListener(t, fn) { docHandlers[t] = (docHandlers[t] || []).filter(f => f !== fn); },
};

const subjectBox = mkEl('aiSubject');
const subjectList = mkEl('aiSubjectList');
const subjectSuggestions = ['Science', 'Hindi', 'Mathematics'];
let picked = null;
let promptRebuilds = 0;
combo.attachSearch(subjectBox, subjectList, { getOptions: () => subjectSuggestions, onPick: (v) => { picked = v; } });
subjectBox.addEventListener('input', () => { promptRebuilds++; });   // the page rebuilding its prompt

subjectBox.fire('focus');
ok('focus opens the suggestion list',
  !subjectList.classList.contains('hidden') && (subjectList.innerHTML.match(/combo-opt/g) || []).length === 3);
subjectBox.value = 'mat';
subjectBox.fire('input');
ok('typing filters the suggestions',
  (subjectList.innerHTML.match(/combo-opt/g) || []).length === 1 && subjectList.innerHTML.includes('Mathematics'));
subjectBox.value = '';
subjectBox.fire('input');
subjectBox.fire('keydown', { key: 'ArrowUp' });
ok('ArrowUp wraps to the last suggestion', subjectList.innerHTML.includes('data-i="2" aria-selected="true"'));
const rebuildsBeforePick = promptRebuilds;
subjectBox.fire('keydown', { key: 'Enter' });
ok('Enter picks the highlighted suggestion', subjectBox.value === 'Mathematics' && picked === 'Mathematics',
  'value=' + subjectBox.value);
ok('picking refills the box with one rebuild event', promptRebuilds === rebuildsBeforePick + 1,
  (promptRebuilds - rebuildsBeforePick) + ' event(s)');
ok('the list closes after picking', subjectList.classList.contains('hidden'));
subjectBox.value = 'zzz';
subjectBox.fire('input');
ok('a query with no match explains itself', subjectList.innerHTML.includes('combo-empty'));
(docHandlers.mousedown || []).forEach(fn => fn({ target: {} }));
ok('clicking outside closes the list', subjectList.classList.contains('hidden'));

/* ---------- 13. app shell markup (js/app.js mountChrome) ---------- */
console.log('\n13) App shell: header, phone menu and footer');

// One fake element per selector, so the generated markup can be inspected without a browser.
const stubEl = (sel) => {
  const el = {
    sel, value: '', innerHTML: '', className: '', textContent: '', hidden: false,
    attrs: {}, listeners: {}, scrollTop: 0,
    classList: {
      set: new Set(),
      add(...c) { c.forEach(x => this.set.add(x)); },
      remove(...c) { c.forEach(x => this.set.delete(x)); },
      toggle(c, on) { const want = on === undefined ? !this.set.has(c) : !!on; if (want) this.set.add(c); else this.set.delete(c); return want; },
      contains(c) { return this.set.has(c); },
    },
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k]; },
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    appendChild() {}, focus() {}, contains() { return false; },
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
  return el;
};

const els = {};
globalThis.document = {
  documentElement: stubEl('html'),
  body: stubEl('body'),
  head: stubEl('head'),
  activeElement: null,
  createElement: () => stubEl('new'),
  addEventListener() {}, removeEventListener() {},
  querySelector: (sel) => (els[sel] = els[sel] || stubEl(sel)),
  querySelectorAll: () => [],
};
try { if (typeof navigator === 'undefined') globalThis.navigator = {}; } catch (_e) { /* node already provides one */ }

const app = await import(pathToFileURL(path.join(ROOT, 'js/app.js')).href);

// Check wide screen (>=900px) nav rendering: links in bar, empty drawer nav
let mmHandler = null;
globalThis.window.matchMedia = (q) => ({
  matches: true,
  addEventListener(t, fn) { mmHandler = fn; },
  removeEventListener() {},
});
app.mountChrome({ title: 'Test page', active: 'pages/test.html' });

const shell = els['#top'].innerHTML || '';
const foot = els['#foot'].innerHTML || '';
const navBar = els['#navMenu'].innerHTML || '';
const navMenuDesktop = els['#drawerNav'].innerHTML || '';

const shellIds = ['navMenu', 'navToggle', 'themeBtn', 'langSel', 'authNavSlot',
  'navDrawer', 'navBackdrop', 'navClose', 'drawerNav', 'drawerAuthSlot'];
ok('header builds every hook the shell needs',
  shellIds.every(id => shell.includes('id="' + id + '"')),
  shellIds.filter(id => !shell.includes('id="' + id + '"')).join(', ') + ' missing');
ok('phone menu carries the language and theme switches',
  shell.includes('data-lang-opt="hi"') && shell.includes('data-theme-opt="dark"') && shell.includes('segmented'));
ok('bar keeps only one-tap controls',
  !shell.includes('id="btnLogout"') && !shell.includes('id="langSelDrawer"'));

ok('signed-out visitors see the public links only',
  navBar.includes('Home') && navBar.includes('Flashcards') && navBar.includes('Test')
  && !navBar.includes('Progress') && !navBar.includes('Questions') && !navBar.includes('Subjects'));
ok('the current page is marked for screen readers',
  /href="[^"]*pages\/test\.html"[^>]*aria-current="page"/.test(navBar));
ok('wide view leaves phone menu nav container empty to prevent link duplication',
  navMenuDesktop === '');

// Check narrow screen (<900px) nav rendering: links in drawer menu, empty bar
globalThis.window.matchMedia = (q) => ({
  matches: false,
  addEventListener(t, fn) { mmHandler = fn; },
  removeEventListener() {},
});
if (mmHandler) mmHandler();

const navBarMobile = els['#navMenu'].innerHTML || '';
const navMenu = els['#drawerNav'].innerHTML || '';
ok('phone view moves links to drawer and clears navbar',
  navBarMobile === '' && navMenu.includes('Home') && navMenu.includes('Test'));
ok('the phone menu groups links and hides empty groups',
  navMenu.includes('Practise') && navMenu.includes('drawer-link-hint') && !navMenu.includes('Manage'));

ok('footer has the four columns',
  foot.includes('id="footPractice"') && foot.includes('id="footBank"')
  && foot.includes('id="footAccount"') && foot.includes('footer-about'));
ok('footer keeps the public downloads', foot.includes('AI-QUESTION-PROMPT.md') && foot.includes('questions-template.xlsx'));
ok('footer offers a login for guests and no log out', foot.includes('id="footLogin"') && !foot.includes('id="footLogout"'));
ok('footer shows the year and the page name',
  foot.includes(String(new Date().getFullYear())) && foot.includes('Test page'));

/* ---------- the five reported bug fixes ---------- */
const cssText = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

// 1) Back to top: the anchor exists, and its handler scrolls even though #top
//    is the sticky header (a plain fragment jump can be a no-op there).
ok('footer offers a back-to-top link', foot.includes('href="#top"') && foot.includes('Back to top'));
let scrollArg = null;
globalThis.window.scrollTo = (arg) => { scrollArg = arg; };
const backTopEvt = {
  target: { closest: (sel) => (sel === 'a.footer-top' ? { className: 'footer-top' } : null) },
  prevented: false,
  preventDefault() { this.prevented = true; },
};
(els['#foot'].listeners.click || []).forEach(fn => fn(backTopEvt));
ok('back-to-top scrolls to the top of the page',
  backTopEvt.prevented && scrollArg !== null && (scrollArg === 0 || scrollArg.top === 0),
  'scrollTo=' + JSON.stringify(scrollArg));

// 2) The "Hindi + English" dropdown lives in the bar and is never hidden.
ok('the bar carries the language dropdown',
  shell.includes('id="langSel"') && shell.includes('हिंदी + English'));
const langRules = cssText.match(/\.lang-slot[^{}]*\{[^}]*\}/g) || [];
ok('the language dropdown is never hidden by the stylesheet',
  langRules.length > 0 && langRules.every(r => !/display\s*:\s*none/.test(r)),
  JSON.stringify(langRules));

// 3) Nav links must truncate instead of stretching across the wordmark.
const navRule = (cssText.match(/\.site-nav a\s*\{[^}]*\}/) || [''])[0];
ok('nav links shrink with an ellipsis instead of covering the logo',
  /min-width:\s*0/.test(navRule) && /text-overflow:\s*ellipsis/.test(navRule), navRule);

// 4) Profile avatar: compact circle, always the first letter of the name.
const avatarRule = (cssText.match(/\.avatar-lg\s*\{[^}]*\}/) || [''])[0];
ok('profile avatar is a compact circle', /width:\s*4\dpx/.test(avatarRule), avatarRule);
const profileJs = fs.readFileSync(path.join(ROOT, 'js/profile.js'), 'utf8');
ok('profile avatar shows the first letter, not a photo',
  !profileJs.includes('user.avatar') && profileJs.includes('avatar-lg'));

// 5) Test page: shared server bank pulled in + full syllabus subject list.
const syncJs = fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8');
const testJs = fs.readFileSync(path.join(ROOT, 'js/test.js'), 'utf8');
ok('the shared question bank can be read', /export async function fetchQuestions\(/.test(syncJs));
ok('test page merges the shared bank',
  testJs.includes('fetchQuestions(') && testJs.includes('mergeQuestions('));
ok('test page lists every syllabus subject',
  testJs.includes('subjects.json') && testJs.includes('no questions yet'));

/* every link the shell renders must point at a real file */
let deadLinks = 0;
for (const m of (shell + foot).matchAll(/href="([^"]+)"/g)) {
  const href = m[1];
  if (/^(#|https?:|mailto:|tel:)/.test(href)) continue;
  const rel = href.startsWith(BASE) ? href.slice(BASE.length) : href;
  if (!fs.existsSync(path.join(ROOT, rel))) { deadLinks++; console.error('  FAIL  shell links to missing file ' + href); }
}
ok('every header / footer link exists', deadLinks === 0, deadLinks + ' dead link(s)');

/* the generated markup must be well formed - catches typos in the template strings */
const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'meta', 'link', 'path', 'circle']);
let unbalanced = 0;
for (const [name, html] of Object.entries({ header: shell, navBar, drawerNav: navMenu, footer: foot })) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, , selfClose] = m;
    const t = tag.toLowerCase();
    if (VOID_TAGS.has(t) || selfClose || tag !== t) continue;
    if (close) {
      if (stack.pop() !== t) { unbalanced++; console.error('  FAIL  ' + name + ': </' + t + '> does not match'); }
    } else stack.push(t);
  }
  if (stack.length) { unbalanced++; console.error('  FAIL  ' + name + ': unclosed ' + stack.join(', ')); }
}
ok('generated shell markup is balanced', unbalanced === 0, unbalanced + ' problem(s)');

/* ---------- 14. shared question bank merge (js/data.js mergeQuestions) ---------- */
console.log('\n14) Shared question bank merge');
const mkQ = (id, subject, text) => data.normaliseRow({
  id, subject, topic: 'Unit', q_hi: text, q_en: text,
  opt1_hi: 'a', opt2_hi: 'b', opt1_en: 'a', opt2_en: 'b', answer: 'A',
}, 1).q;
const localBank = [mkQ('q1', 'Science', 'Local question')];
const dupRow = {
  id: 'q1', subject: 'Science',
  question: { hi: 'Local question', en: 'Local question' },
  options: { hi: ['a', 'b'], en: ['a', 'b'] }, answerIndex: 0,
};
const newRow = {
  id: 'q2', subject: 'English',
  question: { hi: 'Shared question', en: 'Shared question' },
  options: { hi: ['x', 'y'], en: ['x', 'y'] }, answerIndex: 1,
};
ok('the shared bank adds new subjects without duplicating what is here',
  (() => { const m = data.mergeQuestions(localBank, [dupRow, newRow]);
    return m.length === 2 && m[1].subject === 'English'; })());
ok('a different id with the same question text is still deduped',
  (() => { const m = data.mergeQuestions(localBank, [Object.assign({}, dupRow, { id: 'other' })]);
    return m.length === 1; })());
ok('locally removed (hidden) questions stay removed',
  data.mergeQuestions(localBank, [dupRow], ['q1']).length === 1);
ok('rows without a usable answer are dropped',
  data.mergeQuestions(localBank, [
    { id: 'q3', subject: 'X', question: { hi: '?', en: '?' },
      options: { hi: ['a'], en: ['a'] }, answerIndex: -1 },
  ]).length === 1);
ok('an empty or unreachable shared bank changes nothing',
  data.mergeQuestions(localBank, null).length === 1
  && data.mergeQuestions(localBank, []).length === 1);

console.log('\n' + (failures ? 'FAILED: ' + failures + ' check(s) need attention.' : 'ALL CHECKS PASSED.'));
process.exit(failures ? 1 : 0);
