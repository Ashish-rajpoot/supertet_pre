/* ===========================================================
   data.js - question schema, normalisation, validation, loader
   =========================================================== */

import { BASE, uid } from './util.js';
import * as store from './store.js';

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Answer may be "B", "b", 1 (1-based) or 0 (0-based) -> always 0-based index. */
export function answerIndex(ans, optionCount) {
  if (ans == null || ans === '') return -1;
  if (typeof ans === 'number' && isFinite(ans)) {
    const n = Math.round(ans);
    if (n === 0) return optionCount > 0 ? 0 : -1;      // 0 means the first option
    if (n >= 1 && n <= optionCount) return n - 1;       // 1..n follow the A/B/C/D order
    return -1;
  }
  const s = String(ans).trim();
  const letter = s.toUpperCase().match(/^[A-F]$/);
  if (letter) {
    const i = LETTERS.indexOf(letter[0]);
    return i < optionCount ? i : -1;
  }
  const num = parseInt(s.replace(/[^0-9]/g, ''), 10);
  if (!isNaN(num)) {
    if (num === 0 && optionCount > 0) return 0;
    if (num >= 1 && num <= optionCount) return num - 1;
  }
  return -1;
}

export function optionsOf(q) {
  const opts = q.options || {};
  const hi = Array.isArray(opts.hi) ? opts.hi : (Array.isArray(opts) ? opts : []);
  const en = Array.isArray(opts.en) ? opts.en : [];
  return { hi, en };
}

export function answerTextOf(q) {
  const i = q.answerIndex;
  const { hi, en } = optionsOf(q);
  return { hi: i >= 0 ? (hi[i] || '') : '', en: i >= 0 ? (en[i] || '') : '' };
}

/* ---------------- normalisation ---------------- */

const FIELD_ALIASES = {
  id: ['id', 'qid', 'question_id', 'ques_id', 'sr', 's.no', 'sno', 'no', 'q.no', 'number'],
  subject: ['subject', 'sub', 'section', 'paper', 'category'],
  topic: ['topic', 'chapter', 'unit', 'subtopic', 'tag'],
  difficulty: ['difficulty', 'level', 'difficulty_level'],
  qH: ['q_hi', 'question_hi', 'question_hindi', 'hindi', 'que_hi', 'prashn'],
  qE: ['q_en', 'question_en', 'question_english', 'english', 'que_en'],
  ans: ['answer', 'ans', 'correct', 'correct_option', 'correct_answer', 'key', 'answer_key', 'uttar'],
  explH: ['expl_hi', 'explanation_hi', 'explain_hi', 'sol_hi'],
  explE: ['expl_en', 'explanation_en', 'explain_en', 'sol_en', 'explanation', 'solution'],
  tags: ['tags', 'keywords'],
};

function normKey(k) {
  return String(k == null ? '' : k).trim().toLowerCase().replace(/\s+/g, '_');
}

function buildKeyMap(row) {
  const map = {};
  for (const rawKey of Object.keys(row)) map[normKey(rawKey)] = rawKey;
  return map;
}

function val(row, map, names) {
  for (const n of names) {
    if (map[n] != null) {
      const v = row[map[n]];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
  }
  return '';
}

/**
 * Turn a raw plain object (from JSON, Excel or CSV) into the canonical schema.
 * Accepts both the flat column layout and the nested JSON layout.
 * Returns { q, errors[] }.
 */
export function normaliseRow(row, seq = 1) {
  const errors = [];
  if (!row || typeof row !== 'object') return { q: null, errors: ['Row is not an object'] };

  const nested = row.options && typeof row.options === 'object' && !Array.isArray(row.options)
    && (row.question != null || row.q != null) && (row.answer != null || row.answerLetter != null || row.answerIndex != null);
  if (nested) {
    const clone = Object.assign({}, row);
    if (clone.answer == null) {
      clone.answer = clone.answerLetter != null ? clone.answerLetter : clone.answerIndex;
    }
    return { q: canonical(clone, seq, errors), errors };
  }

  const map = buildKeyMap(row);
  const optsHi = [], optsEn = [];
  for (let i = 1; i <= 6; i++) {
    const h = val(row, map, ['opt' + i + '_hi', 'option' + i + '_hi', 'option_' + i + '_hi', 'opt_' + i + '_hi', 'choice' + i + '_hi', 'a' + i + '_hi']);
    const e = val(row, map, ['opt' + i + '_en', 'option' + i + '_en', 'option_' + i + '_en', 'opt_' + i + '_en', 'choice' + i + '_en', 'a' + i + '_en']);
    const p = val(row, map, ['opt' + i, 'option' + i, 'option_' + i, 'opt_' + i, 'choice' + i, 'a' + i]);
    optsHi.push(h || p);
    optsEn.push(e);
  }
  while (optsHi.length && !optsHi[optsHi.length - 1]) optsHi.pop();
  while (optsEn.length && !optsEn[optsEn.length - 1]) optsEn.pop();

  const flat = {
    id: val(row, map, FIELD_ALIASES.id),
    subject: val(row, map, FIELD_ALIASES.subject),
    topic: val(row, map, FIELD_ALIASES.topic),
    difficulty: val(row, map, FIELD_ALIASES.difficulty),
    question: { hi: val(row, map, FIELD_ALIASES.qH), en: val(row, map, FIELD_ALIASES.qE) },
    options: { hi: optsHi, en: optsEn.length ? optsEn : optsHi.slice() },
    answer: val(row, map, FIELD_ALIASES.ans),
    explanation: { hi: val(row, map, FIELD_ALIASES.explH), en: val(row, map, FIELD_ALIASES.explE) },
    tags: val(row, map, FIELD_ALIASES.tags),
  };
  return { q: canonical(flat, seq, errors), errors };
}


/** Canonicalise a merged object into the app schema. */
function canonical(src, seq, errors) {
  const en = String((src.question && src.question.en) || '').trim();
  const hiRaw = String((src.question && src.question.hi) || src.q || '').trim();
  let oHi = (src.options && Array.isArray(src.options.hi)) ? src.options.hi : [];
  let oEn = (src.options && Array.isArray(src.options.en)) ? src.options.en : [];
  oHi = oHi.map(s => String(s == null ? '' : s).trim());
  oEn = oEn.map(s => String(s == null ? '' : s).trim());
  while (oHi.length && !oHi[oHi.length - 1]) oHi.pop();
  while (oEn.length && !oEn[oEn.length - 1]) oEn.pop();
  if (!oHi.length) oHi = oEn.slice();
  if (!oEn.length) oEn = oHi.slice();

  let subject = String(src.subject || '').trim() || 'General';
  let topic = String(src.topic || '').trim() || 'General';
  let difficulty = String(src.difficulty || '').trim().toLowerCase();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) difficulty = 'medium';

  const count = Math.max(oHi.length, oEn.length);
  const idx = answerIndex(src.answer, count);

  const tags = Array.isArray(src.tags)
    ? src.tags.map(String)
    : String(src.tags || '').split(/[,;|]/).map(s => s.trim()).filter(Boolean);

  const q = {
    id: String(src.id || '').trim() || uid('u'),
    subject, topic, difficulty,
    question: { hi: hiRaw, en },
    options: { hi: oHi, en: oEn },
    answerIndex: idx,
    answerLetter: idx >= 0 ? LETTERS[idx] : '',
    explanation: {
      hi: String((src.explanation && src.explanation.hi) || '').trim(),
      en: String((src.explanation && src.explanation.en) || '').trim(),
    },
    tags,
    source: src.source || 'import',
  };

  validate(q, errors, seq);
  return q;
}

export function validate(q, errors = [], seq = '?') {
  const tag = q.id || ('row ' + seq);
  if (!q.question.hi && !q.question.en) errors.push('[' + tag + '] missing question text');
  const count = Math.max(q.options.hi.length, q.options.en.length);
  if (count < 2) errors.push('[' + tag + '] needs at least 2 options (found ' + count + ')');
  if (q.answerIndex < 0) errors.push('[' + tag + '] missing/invalid answer');
  if (!q.options.hi.some(Boolean) && !q.options.en.some(Boolean)) errors.push('[' + tag + '] all options empty');
  return errors;
}

/** Normalise a list from any source. Returns { questions, errors, warnings }. */
export function normaliseList(rows, { dedupe = true } = {}) {
  const questions = [], errors = [], warnings = [];
  const seen = new Set();
  (rows || []).forEach((row, i) => {
    const { q, errors: errs } = normaliseRow(row, i + 1);
    if (!q) { errors.push('Row ' + (i + 1) + ': could not read'); return; }
    if (errs.length) { errors.push.apply(errors, errs); return; }
    const key = (q.question.hi || q.question.en) + '|' + q.options.hi.join(',') + '|' + q.options.en.join(',');
    if (dedupe && seen.has(key)) { warnings.push('Duplicate skipped: ' + (q.question.hi || q.question.en) + ' (' + q.id + ')'); return; }
    seen.add(key);
    questions.push(q);
  });
  return { questions, errors, warnings };
}

/* ---------------- loader (seed data + user data) ---------------- */

let _seed = null;

export async function loadSeed() {
  if (_seed) return _seed;
  try {
    const idx = await (await fetch(BASE + 'data/index.json', { cache: 'no-cache' })).json();
    const files = idx.files || [];
    const all = [];
    for (const f of files) {
      try {
        const rows = await (await fetch(BASE + 'data/' + f, { cache: 'no-cache' })).json();
        (rows || []).forEach((row, i) => {
          const { q } = normaliseRow(Object.assign({ source: 'seed' }, row), i + 1);
          if (q && q.answerIndex >= 0) all.push(q);
        });
      } catch (e) { console.warn('seed file failed', f, e); }
    }
    _seed = all;
    return all;
  } catch (e) {
    console.warn('seed index failed', e);
    _seed = [];
    return _seed;
  }
}

/** All questions available to the app (seeds + user imports, minus removed). */
export async function getAll() {
  const seed = await loadSeed();
  const hidden = new Set(store.getHidden().map(String));
  const user = store.getQuestions();
  const seen = new Set(seed.map(q => (q.question.hi || q.question.en) + '|' + q.options.hi.join(',')));
  const out = seed.filter(q => !hidden.has(String(q.id)));
  for (const q of user) {
    const k = (q.question.hi || q.question.en) + '|' + q.options.hi.join(',');
    if (seen.has(k)) continue;
    out.push(q);
  }
  return out;
}

/**
 * Merge an extra source of questions (the shared bank on the server) into the
 * local list without duplicating anything:
 *   - each row is normalised first, so raw spreadsheet rows and canonical
 *     questions both come out in the app schema;
 *   - a question whose id or whose text is already present is skipped;
 *   - locally removed (hidden) seed questions stay removed;
 *   - rows without a usable answer are dropped, exactly like loadSeed().
 * Pure and synchronous - fetchQuestions() supplies the extra rows.
 */
export function mergeQuestions(local, extra, hiddenIds = []) {
  if (!Array.isArray(extra) || !extra.length) return local || [];
  const hidden = new Set((hiddenIds || []).map(String));
  const out = (local || []).slice();
  const ids = new Set(out.map(q => String(q.id)));
  const keys = new Set(out.map(q => (q.question.hi || q.question.en) + '|' + q.options.hi.join(',')));

  extra.forEach(row => {
    const { q } = normaliseRow(row, 1);
    if (!q || q.answerIndex < 0 || hidden.has(String(q.id))) return;
    const key = (q.question.hi || q.question.en) + '|' + q.options.hi.join(',');
    if (ids.has(String(q.id)) || keys.has(key)) return;
    ids.add(String(q.id));
    keys.add(key);
    out.push(q);
  });
  return out;
}

/** Subject list with counts and topics. */
export async function meta() {
  const all = await getAll();
  const bySubject = new Map();
  for (const q of all) {
    if (!bySubject.has(q.subject)) bySubject.set(q.subject, { subject: q.subject, count: 0, topics: new Set() });
    const s = bySubject.get(q.subject);
    s.count++; s.topics.add(q.topic);
  }
  return {
    total: all.length,
    subjects: Array.from(bySubject.values())
      .map(s => ({ subject: s.subject, count: s.count, topics: Array.from(s.topics).sort() }))
      .sort((a, b) => a.subject.localeCompare(b.subject)),
  };
}

export function filterQuestions(all, { subjects = [], topics = [], difficulty = [], onlyIds = null } = {}) {
  const idSet = onlyIds ? new Set(onlyIds.map(String)) : null;
  return all.filter(q => {
    if (idSet && !idSet.has(String(q.id))) return false;
    if (subjects.length && !subjects.includes(q.subject)) return false;
    if (topics.length && !topics.includes(q.topic)) return false;
    if (difficulty.length && !difficulty.includes(q.difficulty)) return false;
    return true;
  });
}

