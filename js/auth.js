/* ===========================================================
   auth.js - client-side authentication for SuperTET Prep
   Supports:
   1. Google Sign-In (OAuth via Google Identity Services)
   2. User ID / Email / Phone + Password with OTP validation
   3. Local fallback and seamless sync with store settings
   =========================================================== */

import { toast } from './util.js';
import * as store from './store.js';
import { getApiBase } from './sync.js';

/* Same key as store.js uses so sync.js can read the bearer token without a circular import. */
const AUTH_KEY = store.AUTH_KEY;

/**
 * Small wrapper around fetch for every auth endpoint so that network problems
 * (server down, no internet) surface as a readable message instead of "Failed to fetch".
 */
async function api(path, body, { method = 'POST', token = '' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(getApiBase() + '/auth' + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (_e) {
    throw new Error('Cannot reach the server. Check your internet connection or the API URL in settings.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    err.status = res.status;
    if (data.needsOtp) {
      err.needsOtp = true;
      err.target = data.target;
      err.devOtp = data.devOtp;
    }
    throw err;
  }
  return data;
}

/**
 * Get stored auth session:
 * { token, user: { id, name, email, phone, userId, avatar, verified } }
 */
export function getAuth() {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_e) {
    return null;
  }
}

/** Check if user is currently logged in */
export function isLoggedIn() {
  const a = getAuth();
  return Boolean(a && a.token && a.user);
}

/** Get current user object or null */
export function getCurrentUser() {
  const a = getAuth();
  return a ? a.user : null;
}

/** Save auth session and dispatch stp:auth event */
export function setAuth(data) {
  if (data && data.token && data.user) {
    try {
      localStorage.setItem(AUTH_KEY, JSON.stringify(data));
      // Automatically keep student name in settings aligned with logged-in user
      if (data.user.name) {
        store.saveSettings({ name: data.user.name });
      }
    } catch (_e) { /* quota */ }
  } else {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch (_e) { /* ignore */ }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stp:auth', { detail: data }));
  }
}

/** Log out current user */
export function logout() {
  setAuth(null);
  toast('Logged out successfully');
}

/**
 * Initiate registration: sends OTP to email or phone
 */
export async function register({ name, identifier, userId, password }) {
  return api('/register', { name, identifier, userId, password });
}

/**
 * Verify OTP code
 */
export async function verifyOtp({ target, code, type = 'register' }) {
  const data = await api('/verify-otp', { target, code, type });
  setAuth(data);
  return data;
}

/**
 * Resend OTP code
 */
export async function resendOtp({ target, type = 'register' }) {
  return api('/resend-otp', { target, type });
}

/**
 * Log in with user ID, email, or phone + password
 */
export async function login({ identifier, password }) {
  const data = await api('/login', { identifier, password });
  setAuth(data);
  return data;
}

/**
 * Log in with Google credential token (JWT from Google Identity Services)
 */
export async function loginWithGoogleCredential(credential) {
  const data = await api('/google', { credential });
  setAuth(data);
  return data;
}

/**
 * Is the signed-in user an admin? (can add/delete any question and grant permissions)
 */
export function isAdmin() {
  const u = getCurrentUser();
  return Boolean(u && u.role === 'admin');
}

/**
 * May the signed-in user add questions to the shared bank?
 * Admins always can; students only after an admin grants the permission.
 */
export function canAddQuestions() {
  const u = getCurrentUser();
  return Boolean(u && (u.role === 'admin' || u.canAddQuestions));
}

/** Human readable role label for the profile page / top bar chip. */
export function roleLabel(user = getCurrentUser()) {
  if (!user) return 'Guest';
  if (user.role === 'admin') return 'Admin';
  if (user.canAddQuestions) return 'Contributor';
  return 'Student';
}

/**
 * Update the signed-in user's own details.
 * Email, phone and the login id cannot be changed - the server rejects them.
 */
export async function updateProfile(patch) {
  const auth = getAuth();
  if (!auth || !auth.token) throw new Error('Please log in first');
  const data = await api('/profile', patch, { method: 'PATCH', token: auth.token });
  setAuth({ token: auth.token, user: data.user });
  return data.user;
}

/** Change the password (needs the current one). */
export async function changePassword({ currentPassword, newPassword }) {
  const auth = getAuth();
  if (!auth || !auth.token) throw new Error('Please log in first');
  return api('/change-password', { currentPassword, newPassword }, { method: 'POST', token: auth.token });
}

/** Admin only: every account, for the permission panel. */
export async function listUsers() {
  const auth = getAuth();
  if (!auth || !auth.token) throw new Error('Please log in first');
  const data = await api('/users', null, { method: 'GET', token: auth.token });
  return data.users || [];
}

/** Admin only: grant/revoke the "can add questions" permission or change a role. */
export async function updateUserPermissions(id, patch) {
  const auth = getAuth();
  if (!auth || !auth.token) throw new Error('Please log in first');
  const data = await api('/users/' + encodeURIComponent(id), patch, { method: 'PATCH', token: auth.token });
  // If the admin edited their own account, refresh the cached session too.
  const me = getCurrentUser();
  if (me && data.user && me.id === data.user.id) {
    setAuth({ token: auth.token, user: data.user });
  }
  return data.user;
}

/**
 * Verify current session with backend (silent check)
 */
export async function checkSession() {
  const auth = getAuth();
  if (!auth || !auth.token) return null;
  try {
    const data = await api('/me', null, { method: 'GET', token: auth.token });
    setAuth({ token: auth.token, user: data.user });
    return data.user;
  } catch (err) {
    // 401 means the token expired/invalid -> log out; anything else (offline) keeps the cached user.
    if (err && err.status === 401) {
      setAuth(null);
      return null;
    }
    return auth.user;
  }
}
