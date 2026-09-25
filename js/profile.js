/* ===========================================================
   profile.js - the signed-in student's own account details.
   Name and study details can be edited; email, phone and the
   login id are identity fields and stay read-only.
   =========================================================== */

import { BASE, mountChrome, openAuthModal } from './app.js';
import { ready, esc, toast } from './util.js';
import * as store from './store.js';
import { getCurrentUser, isLoggedIn, logout, updateProfile, changePassword, roleLabel, checkSession } from './auth.js';
import { checkServerStatus } from './sync.js';

let serverStatus = { online: false, mongo: false };

ready(async () => {
  mountChrome({ active: 'pages/profile.html' });
  serverStatus = await checkServerStatus();

  if (isLoggedIn()) {
    // Pull the freshest copy from the server; offline keeps the cached profile.
    await checkSession().catch(() => {});
  }

  render();
  // After logging in from this page (or the top bar modal) re-render the form.
  window.addEventListener('stp:auth', () => render());
});

/* ---------------------------------------------------------------- views */

function render() {
  const host = document.getElementById('profile');
  if (!host) return;
  const user = getCurrentUser();
  if (!user) {
    host.innerHTML = signedOutHtml();
    const btn = document.getElementById('profileLogin');
    if (btn) btn.onclick = () => openAuthModal('login');
    return;
  }
  host.innerHTML = signedInHtml(user);
  wireForm();
}

function signedOutHtml() {
  return `
  <div class="card">
    <h2 style="margin-top:0">You are not logged in</h2>
    <p class="muted">Log in with Google, or with your User ID / Email / Phone and OTP, to see and edit your profile.</p>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn primary" id="profileLogin" type="button">Log in</button>
    </div>
    <p class="help">Without an account the app still works: your questions and results stay on this device.</p>
  </div>`;
}

function headerHtml(user) {
  const initial = (user.name || user.email || 'U')[0].toUpperCase();
  const avatar = user.avatar
    ? `<span class="avatar-lg"><img src="${esc(user.avatar)}" alt="${esc(user.name)}"></span>`
    : `<span class="avatar-lg">${esc(initial)}</span>`;
  const badgeClass = user.role === 'admin' ? 'auth-badge admin' : 'auth-badge';

  return `
  <div class="card">
    <div class="profile-head">
      ${avatar}
      <div style="min-width:0">
        <h2 style="margin:0">${esc(user.name || 'Student')}</h2>
        <div class="small muted truncate">${esc(user.email || user.phone || user.userId || 'Account')}</div>
        <div style="margin-top:6px"><span class="${badgeClass}">${esc(roleLabel(user))}</span></div>
      </div>
      <span class="spacer" style="flex:1 1 auto"></span>
      <div class="btn-row">
        <a class="btn sm" href="${BASE}pages/analytics.html">My progress</a>
        <button class="btn sm ghost" id="profileLogout" type="button">Log out</button>
      </div>
    </div>
    ${serverStatus.online ? '' : '<p class="pill warn" style="margin:12px 0 0; display:inline-block">Server offline - showing this device copy. Saving is disabled until you reconnect.</p>'}
  </div>`;
}

function identityHtml(user) {
  const row = (label, value, icon) => `
      <div class="locked-row">
        <span class="lock-ico">${icon}</span>
        <span class="grow"><span class="k">${esc(label)}</span><div class="v">${esc(value)}</div></span>
      </div>`;
  return `
  <div class="card">
    <h3 style="margin-top:0">Account identity</h3>
    <p class="muted small" style="margin-top:0">These identify your account and cannot be changed here. Ask the admin if something is wrong.</p>
    <div class="field-grid">
      ${row('User ID', user.userId || '-', '&#128274;')}
      ${row('Email', user.email || 'not set', '&#128274;')}
      ${row('Phone number', user.phone || 'not set', '&#128274;')}
      ${row('Verified', user.verified ? 'Yes' : 'No', '&#9989;')}
    </div>
  </div>`;
}

function editFormHtml(user, offline) {
  return `
  <div class="card">
    <h3 style="margin-top:0">Edit your details</h3>
    <div id="profileError" class="pill bad hidden" style="width:100%; margin-bottom:12px; text-align:center;"></div>
    <form id="profileForm">
      <div class="field-grid">
        <div class="field">
          <label for="pfName">Full name</label>
          <input type="text" id="pfName" maxlength="60" value="${esc(user.name || '')}" required>
        </div>
        <div class="field">
          <label for="pfClass">Class / paper</label>
          <input type="text" id="pfClass" maxlength="60" placeholder="e.g. Class 6-8 or Paper 1" value="${esc(user.classLevel || '')}">
        </div>
        <div class="field">
          <label for="pfCity">City</label>
          <input type="text" id="pfCity" maxlength="60" placeholder="e.g. Lucknow" value="${esc(user.city || '')}">
        </div>
        <div class="field">
          <label for="pfSchool">School / coaching</label>
          <input type="text" id="pfSchool" maxlength="120" placeholder="Optional" value="${esc(user.school || '')}">
        </div>
        <div class="field" style="grid-column:1/-1">
          <label for="pfAvatar">Profile photo link</label>
          <input type="url" id="pfAvatar" placeholder="https://..." value="${esc(user.avatar || '')}">
          <p class="help">Paste a full http(s) image link. Leave empty to show your initial instead.</p>
        </div>
        <div class="field" style="grid-column:1/-1">
          <label for="pfAbout">About you</label>
          <textarea id="pfAbout" rows="3" maxlength="120" placeholder="Optional, max 120 characters">${esc(user.about || '')}</textarea>
        </div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn primary" id="pfSave" type="submit" ${offline ? 'disabled' : ''}>Save details</button>
        <button class="btn ghost" id="pfReset" type="button">Reset</button>
      </div>
      <p class="help">Email and phone number are locked. Only the admin can change them.</p>
    </form>
  </div>`;
}

function passwordFormHtml(offline) {
  return `
  <div class="card">
    <h3 style="margin-top:0">Change password</h3>
    <div id="pwError" class="pill bad hidden" style="width:100%; margin-bottom:12px; text-align:center;"></div>
    <form id="pwForm">
      <div class="field-grid">
        <div class="field">
          <label for="pwCurrent">Current password</label>
          <input type="password" id="pwCurrent" autocomplete="current-password" placeholder="Your current password">
        </div>
        <div class="field">
          <label for="pwNew">New password</label>
          <input type="password" id="pwNew" minlength="6" autocomplete="new-password" placeholder="At least 6 characters">
        </div>
        <div class="field">
          <label for="pwConfirm">Repeat new password</label>
          <input type="password" id="pwConfirm" minlength="6" autocomplete="new-password" placeholder="Repeat">
        </div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" type="submit" ${offline ? 'disabled' : ''}>Update password</button>
      </div>
      <p class="help">A Google-only account can set a password here to also log in with email/phone.</p>
    </form>
  </div>`;
}

function signedInHtml(user) {
  const offline = !serverStatus.online;
  return headerHtml(user) + identityHtml(user) + editFormHtml(user, offline) + passwordFormHtml(offline);
}

/* ---------------------------------------------------------------- wiring */

function showError(id, message) {
  const box = document.getElementById(id);
  if (!box) return;
  if (message) {
    box.textContent = message;
    box.classList.remove('hidden');
  } else {
    box.classList.add('hidden');
  }
}

function wireForm() {
  const logoutBtn = document.getElementById('profileLogout');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      logout();
      render();
    };
  }

  const form = document.getElementById('profileForm');
  if (form) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      showError('profileError', '');

      const name = document.getElementById('pfName').value.trim();
      if (name.length < 2) return showError('profileError', 'Please enter your full name (at least 2 characters)');

      const patch = {
        name,
        classLevel: document.getElementById('pfClass').value.trim(),
        city: document.getElementById('pfCity').value.trim(),
        school: document.getElementById('pfSchool').value.trim(),
        about: document.getElementById('pfAbout').value.trim(),
        avatar: document.getElementById('pfAvatar').value.trim(),
      };

      const btn = document.getElementById('pfSave');
      btn.disabled = true;
      try {
        await updateProfile(patch);
        toast('Profile updated');
        render();
      } catch (err) {
        showError('profileError', err.message || 'Could not save your details');
      } finally {
        btn.disabled = false;
      }
    };
  }

  const resetBtn = document.getElementById('pfReset');
  if (resetBtn) resetBtn.onclick = () => render();

  const pwForm = document.getElementById('pwForm');
  if (pwForm) {
    pwForm.onsubmit = async (e) => {
      e.preventDefault();
      showError('pwError', '');

      const currentPassword = document.getElementById('pwCurrent').value;
      const newPassword = document.getElementById('pwNew').value;
      const confirm = document.getElementById('pwConfirm').value;

      if (newPassword.length < 6) return showError('pwError', 'New password must be at least 6 characters');
      if (newPassword !== confirm) return showError('pwError', 'The two new passwords do not match');

      try {
        await changePassword({ currentPassword, newPassword });
        toast('Password updated');
        pwForm.reset();
      } catch (err) {
        showError('pwError', err.message || 'Could not change the password');
      }
    };
  }
}

/* Keep the name saved in settings aligned with the account (used by test labels). */
window.addEventListener('stp:auth', () => {
  const u = getCurrentUser();
  if (u && u.name && store.getSettings().name !== u.name) store.saveSettings({ name: u.name });
});
