/* ===========================================================
   sync.js - client-side sync layer between localStorage and MongoDB backend
   Automatically detects if backend is available.
   Gracefully falls back to pure localStorage if offline or no server.
   =========================================================== */

import { BASE } from './util.js';
import * as store from './store.js';

const QUEUE_KEY = 'stp.syncQueue';

/**
 * Get API base URL.
 * Defaults to same-origin /api.
 * Can be overridden in settings (e.g. for GitHub Pages talking to a hosted backend).
 */
export function getApiBase() {
  const s = store.getSettings();
  if (s.apiUrl && String(s.apiUrl).trim()) {
    return String(s.apiUrl).trim().replace(/\/+$/, '');
  }
  // When running through the Node server, BASE + 'api' resolves to /api
  return (BASE + 'api').replace(/\/+/g, '/').replace(/^http:\//, 'http://').replace(/^https:\//, 'https://');
}

/** Check if backend API and MongoDB are reachable */
export async function checkServerStatus() {
  try {
    const res = await fetch(getApiBase() + '/status', { method: 'GET', cache: 'no-cache' });
    if (!res.ok) return { online: false, mongo: false };
    const data = await res.json();
    return { online: true, mongo: Boolean(data.mongoConnected) };
  } catch (_e) {
    return { online: false, mongo: false };
  }
}

/** Build request headers, attaching the bearer token when a user is signed in. */
function headers(json = true) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  const token = store.getAuthToken();
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

/** Turn a failed response into an Error that carries the HTTP status. */
async function errorFrom(res, fallback) {
  let msg = fallback || ('Server error ' + res.status);
  try {
    const data = await res.json();
    if (data && data.error) msg = data.error;
  } catch (_e) { /* not json */ }
  const err = new Error(msg);
  err.status = res.status;
  return err;
}

/** Read offline outbox */
function getQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_e) {
    return [];
  }
}

function saveQueue(q) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch (_e) { /* quota */ }
}

/**
 * Send an attempt to the MongoDB backend.
 * If offline or server unavailable, queues it in localStorage for auto-retry.
 */
export async function syncAttempt(attempt) {
  const s = store.getSettings();
  const account = store.getAuthUser();
  const payload = Object.assign({}, attempt, {
    // With an account the server attributes the attempt to that user; otherwise fall back to
    // the name saved in settings so device-only results stay readable.
    student: (s.name && s.name.trim()) || (account && account.name) || 'Anonymous',
  });

  try {
    const res = await fetch(getApiBase() + '/attempts', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      return { ok: true, synced: true };
    }
  } catch (_e) {
    // Network failure
  }

  // Failed to reach server or DB not ready — add to queue for later
  const queue = getQueue();
  if (!queue.some(item => item.id === payload.id)) {
    queue.push(payload);
    saveQueue(queue);
  }
  return { ok: false, queued: true };
}

/** Flush offline queue to the server */
export async function flushQueue() {
  const queue = getQueue();
  if (!queue.length) return 0;

  const remaining = [];
  let flushed = 0;

  for (const item of queue) {
    try {
      const res = await fetch(getApiBase() + '/attempts', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(item),
      });
      if (res.ok) {
        flushed++;
      } else {
        remaining.push(item);
      }
    } catch (_e) {
      remaining.push(item);
    }
  }

  saveQueue(remaining);
  return flushed;
}

/** Fetch a single attempt from the server (e.g. for shared results links). */
export async function fetchRemoteAttempt(id) {
  try {
    const res = await fetch(getApiBase() + '/attempts/' + encodeURIComponent(id), { headers: headers(false) });
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  }
}

/**
 * Fetch attempts from the server, always scoped to one user:
 *   fetchRemoteAttempts()                 -> my own attempts (needs a signed-in session)
 *   fetchRemoteAttempts({ scope: 'all' }) -> every student (admin only)
 *   fetchRemoteAttempts({ userId: '...' })-> one student (admin only)
 *   fetchRemoteAttempts({ student: 'XYZ' }) or fetchRemoteAttempts('XYZ') -> filter by name
 * Returns null when the request could not be made (offline / not allowed) and
 * an array (possibly empty) when the server answered.
 *
 * @param {{scope?: 'mine'|'all', userId?: string, student?: string}|string} [opts]
 */
export async function fetchRemoteAttempts(opts = {}) {
  const o = typeof opts === 'string' ? { student: opts } : (opts || {});
  const params = new URLSearchParams();
  if (o.scope === 'all') params.set('scope', 'all');
  if (o.userId) params.set('userId', o.userId);
  if (o.student) params.set('student', o.student);
  if (o.limit) params.set('limit', String(o.limit));
  const qs = params.toString();
  try {
    const res = await fetch(getApiBase() + '/attempts' + (qs ? '?' + qs : ''), { headers: headers(false) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.attempts || [];
  } catch (_e) {
    return null;
  }
}

/** Admin only: user-wise analytics summary (one row per student). */
export async function fetchUserAnalytics() {
  try {
    const res = await fetch(getApiBase() + '/analytics/users', { headers: headers(false) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.students || [];
  } catch (_e) {
    return null;
  }
}

/** Bulk upload questions to MongoDB backend (needs admin / granted permission). */
export async function syncQuestions(questions) {
  const res = await fetch(getApiBase() + '/questions', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(questions),
  });
  if (!res.ok) throw await errorFrom(res, 'Could not save questions to the server');
  return await res.json();
}

/**
 * Read the shared question bank from the server (GET /api/questions is public -
 * "anyone can read the shared bank"). Returns the array of questions, or null
 * when the server / MongoDB is unreachable, so callers can fall back to the
 * local copy without ever failing the page.
 */
export async function fetchQuestions({ limit = 5000, timeout = 5000 } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl && timeout > 0 ? setTimeout(() => ctrl.abort(), timeout) : null;
  try {
    const res = await fetch(getApiBase() + '/questions?limit=' + encodeURIComponent(limit), {
      headers: headers(false),
      cache: 'no-cache',
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.questions) ? data.questions : [];
  } catch (_e) {
    return null;                 // offline / server down - the local bank still works
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Delete a single attempt from MongoDB backend */
export async function deleteRemoteAttempt(id) {
  try {
    const res = await fetch(getApiBase() + '/attempts/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: headers(false),
    });
    return res.ok;
  } catch (_e) {
    return false;
  }
}

/**
 * Clear attempts from MongoDB backend.
 * Admins clear every student by default; a signed-in student clears only their own.
 * @param {{student?: string, userId?: string}} [opts]
 */
export async function clearRemoteAttempts(opts = {}) {
  const o = typeof opts === 'string' ? { student: opts } : (opts || {});
  const params = new URLSearchParams();
  if (o.student) params.set('student', o.student);
  if (o.userId) params.set('userId', o.userId);
  const qs = params.toString();
  try {
    const res = await fetch(getApiBase() + '/attempts' + (qs ? '?' + qs : ''), {
      method: 'DELETE',
      headers: headers(false),
    });
    if (!res.ok) return { ok: false, count: 0 };
    return await res.json();
  } catch (_e) {
    return { ok: false, count: 0 };
  }
}

/* ---------------- subjects & topics (syllabus) ---------------- */

/** Everyone may read the syllabus (students need it offline too). Returns null when unreachable. */
export async function fetchSubjects() {
  try {
    const res = await fetch(getApiBase() + '/subjects', { headers: headers(false), cache: 'no-cache' });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.subjects) ? data.subjects : [];
  } catch (_e) {
    return null;
  }
}

/** Admin only: create a subject. Body: { name, nameHi, topics?, order? }. */
export async function saveSubject(payload) {
  const res = await fetch(getApiBase() + '/subjects', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw await errorFrom(res, 'Could not save the subject');
  return await res.json();
}

/** Admin only: rename a subject / change its Hindi name or order. */
export async function updateSubject(id, patch) {
  const res = await fetch(getApiBase() + '/subjects/' + encodeURIComponent(id), {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await errorFrom(res, 'Could not update the subject');
  return await res.json();
}

/** Admin only: delete a subject with all of its topics. */
export async function deleteSubject(id) {
  const res = await fetch(getApiBase() + '/subjects/' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) throw await errorFrom(res, 'Could not delete the subject');
  return await res.json();
}

/** Admin only: add a topic to a subject. Body: { name, nameHi }. */
export async function addTopic(subjectId, topic) {
  const res = await fetch(getApiBase() + '/subjects/' + encodeURIComponent(subjectId) + '/topics', {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(topic),
  });
  if (!res.ok) throw await errorFrom(res, 'Could not add the topic');
  return await res.json();
}

/** Admin only: rename a topic / change its Hindi name. */
export async function updateTopic(subjectId, topicId, patch) {
  const url = getApiBase() + '/subjects/' + encodeURIComponent(subjectId) +
    '/topics/' + encodeURIComponent(topicId);
  const res = await fetch(url, { method: 'PATCH', headers: headers(), body: JSON.stringify(patch) });
  if (!res.ok) throw await errorFrom(res, 'Could not update the topic');
  return await res.json();
}

/** Admin only: remove one topic from a subject. */
export async function deleteTopic(subjectId, topicId) {
  const url = getApiBase() + '/subjects/' + encodeURIComponent(subjectId) +
    '/topics/' + encodeURIComponent(topicId);
  const res = await fetch(url, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw await errorFrom(res, 'Could not delete the topic');
  return await res.json();
}

// Auto-flush queue when network comes back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
  // Also try flushing on initial page load
  setTimeout(() => { flushQueue(); }, 2000);
}
