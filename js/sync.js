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
  const payload = Object.assign({}, attempt, {
    student: (s.name && s.name.trim()) || 'Anonymous',
  });

  try {
    const res = await fetch(getApiBase() + '/attempts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json' },
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

/** Fetch a single attempt from the server (e.g. for shared results links) */
export async function fetchRemoteAttempt(id) {
  try {
    const res = await fetch(getApiBase() + '/attempts/' + encodeURIComponent(id));
    if (!res.ok) return null;
    return await res.json();
  } catch (_e) {
    return null;
  }
}

/** Fetch all attempts from the server */
export async function fetchRemoteAttempts(student = '') {
  try {
    const url = getApiBase() + '/attempts' + (student ? '?student=' + encodeURIComponent(student) : '');
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.attempts || [];
  } catch (_e) {
    return [];
  }
}

/** Bulk upload questions to MongoDB backend */
export async function syncQuestions(questions) {
  try {
    const res = await fetch(getApiBase() + '/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(questions),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Server error ' + res.status);
    }
    return await res.json();
  } catch (e) {
    throw e;
  }
}

/** Delete a single attempt from MongoDB backend */
export async function deleteRemoteAttempt(id) {
  try {
    const res = await fetch(getApiBase() + '/attempts/' + encodeURIComponent(id), {
      method: 'DELETE',
    });
    return res.ok;
  } catch (_e) {
    return false;
  }
}

/** Clear all attempts from MongoDB backend (optionally by student) */
export async function clearRemoteAttempts(student = '') {
  try {
    const url = getApiBase() + '/attempts' + (student ? '?student=' + encodeURIComponent(student) : '');
    const res = await fetch(url, {
      method: 'DELETE',
    });
    if (!res.ok) return { ok: false, count: 0 };
    return await res.json();
  } catch (_e) {
    return { ok: false, count: 0 };
  }
}

// Auto-flush queue when network comes back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { flushQueue(); });
  // Also try flushing on initial page load
  setTimeout(() => { flushQueue(); }, 2000);
}
