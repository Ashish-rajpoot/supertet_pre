/* ===========================================================
   store.js - localStorage persistence
   Everything is stored per-device. Export/import keeps a backup.
   =========================================================== */

const K = {
  questions: 'stp.questions',   // user imported/added questions (bulk bank)
  attempts: 'stp.attempts',     // finished test attempts + results
  settings: 'stp.settings',
  cards: 'stp.cards',           // flashcard progress (Leitner boxes)
  hidden: 'stp.hidden',         // ids of seeded questions removed by the user
};

/** localStorage key holding the signed-in session (token + user). Shared with auth.js and sync.js. */
export const AUTH_KEY = 'stp.auth';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (e) {
    console.warn('store read failed', key, e);
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('store write failed', key, e);
    return false;
  }
}

/* ---------------- user questions ---------------- */
export const getQuestions = () => read(K.questions, []);
export function setQuestions(list) { return write(K.questions, list || []); }

export function addQuestions(list) {
  const existing = getQuestions();
  const byId = new Map(existing.map(q => [String(q.id), q]));
  let added = 0, updated = 0;
  for (const q of list || []) {
    const id = String(q.id);
    if (byId.has(id)) { byId.set(id, q); updated++; }
    else { byId.set(id, q); added++; }
  }
  setQuestions(Array.from(byId.values()));
  return { added, updated, total: byId.size };
}

export function removeQuestion(id) {
  const before = getQuestions().length;
  const rest = getQuestions().filter(q => String(q.id) !== String(id));
  setQuestions(rest);
  // remember removed seed questions so they do not come back
  const hidden = read(K.hidden, []);
  if (!hidden.includes(String(id))) { hidden.push(String(id)); write(K.hidden, hidden); }
  return before - rest.length;
}

export function clearUserQuestions() {
  setQuestions([]);
  write(K.hidden, []);
}

export const getHidden = () => read(K.hidden, []);
export const setHidden = (ids) => write(K.hidden, ids || []);

/* ---------------- attempts (results) ---------------- */
export const getAttempts = () => read(K.attempts, []);

export function addAttempt(attempt) {
  const list = getAttempts();
  list.push(attempt);
  // keep storage bounded: max 300 attempts
  const trimmed = list.slice(-300);
  write(K.attempts, trimmed);
  return attempt;
}

export function deleteAttempt(id) {
  write(K.attempts, getAttempts().filter(a => a.id !== id));
}

export function clearAttempts() { write(K.attempts, []); }

export const getAttempt = (id) => getAttempts().find(a => a.id === id) || null;

/* ---------------- flashcard progress ---------------- */
/* box 1 = needs work ... box 5 = mastered */
export const getCards = () => read(K.cards, {});
export function setCard(id, box) {
  const all = getCards();
  all[String(id)] = { box: Math.min(5, Math.max(1, box)), at: Date.now() };
  write(K.cards, all);
}
export function resetCards() { write(K.cards, {}); }

/* ---------------- settings ---------------- */
export const DEFAULT_SETTINGS = {
  theme: 'auto',            // auto | light | dark
  defaultCount: 20,         // questions per test
  defaultMinutes: 20,       // timer
  negativeMarking: 0,       // e.g. 0.25 -> -0.25 per wrong answer
  showExplanation: true,    // show explanation in practice mode
  shuffleOptions: false,
  name: '',                 // student name for sync
  apiUrl: '',               // optional backend URL override (e.g. for GitHub Pages -> external backend)
  googleClientId: '',       // optional Google OAuth client id for Google Sign-In
};

export function getSettings() {
  return Object.assign({}, DEFAULT_SETTINGS, read(K.settings, {}));
}
export function saveSettings(patch) {
  const next = Object.assign(getSettings(), patch || {});
  write(K.settings, next);
  window.dispatchEvent(new CustomEvent('stp:settings', { detail: next }));
  return next;
}

/* ---------------- auth session helpers ----------------
   Kept here so sync.js can attach the bearer token without importing auth.js
   (auth.js imports sync.js for the API base, so the reverse import would cycle). */
export function getAuthSession() {
  const s = read(AUTH_KEY, null);
  return s && s.token ? s : null;
}
export function getAuthToken() {
  const s = getAuthSession();
  return s ? s.token : '';
}
export function getAuthUser() {
  const s = getAuthSession();
  return s ? (s.user || null) : null;
}

export function exportAll(extra = {}) {
  return {
    app: 'supertet-prep',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: getSettings(),
    questions: getQuestions(),
    attempts: getAttempts(),
    cards: getCards(),
    hidden: getHidden(),
    ...extra,
  };
}

export function importAll(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Invalid backup file');
  if (Array.isArray(obj.questions)) {
    const r = addQuestions(obj.questions);
    return r;
  }
  throw new Error('Backup has no "questions" array');
}

export function usageBytes() {
  let total = 0;
  for (const k of Object.keys(K)) {
    const v = localStorage.getItem(K[k]);
    if (v) total += v.length;
  }
  return total;
}
