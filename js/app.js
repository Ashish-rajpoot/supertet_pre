/* ===========================================================
   app.js - shared shell: base path, nav, theme, settings, toast, auth modal
   =========================================================== */

import { BASE, $, $$, esc, toast, getLang, setLang, ready } from './util.js';
import { getSettings, saveSettings } from './store.js';
import { getCurrentUser, isLoggedIn, logout, login, register, verifyOtp, resendOtp, loginWithGoogleCredential, checkSession, canAddQuestions } from './auth.js';

export { BASE, $, $$, esc, toast, ready };

const LANG_LABELS = [
  ['both', 'हिंदी + English'],
  ['hi', 'हिंदी'],
  ['en', 'English'],
];

/**
 * Links shown in the top nav.
 *   auth: true    -> only for a signed-in user
 *   editor: true  -> only for an admin, or a student allowed to add questions
 * Hidden links are removed from the markup entirely, not just greyed out, so a
 * signed-out visitor cannot find the pages by looking at the source either.
 */
export const NAV = [
  { href: 'index.html', label: 'Home' },
  { href: 'pages/flashcards.html', label: 'Flashcards' },
  { href: 'pages/test.html', label: 'Test' },
  { href: 'pages/analytics.html', label: 'Progress', auth: true },
  { href: 'pages/manage.html', label: 'Questions', editor: true },
];

/** May the current visitor see this nav link? */
export function canSeeNavLink(item) {
  if (item.auth && !isLoggedIn()) return false;
  if (item.editor && !canAddQuestions()) return false;
  return true;
}

/** The nav links the current visitor is allowed to see. */
export function visibleNav() {
  return NAV.filter(canSeeNavLink);
}

/** Apply the saved theme (auto follows the device). */
export function applyTheme() {
  const s = getSettings();
  const mode = s.theme || 'auto';
  let dark = false;
  if (mode === 'dark') dark = true;
  else if (mode === 'auto' && window.matchMedia) dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

export function cycleTheme() {
  const s = getSettings();
  const order = ['auto', 'light', 'dark'];
  const next = order[(order.indexOf(s.theme || 'auto') + 1) % order.length];
  saveSettings({ theme: next });
  applyTheme();
  const btn = $('#themeBtn');
  if (btn) btn.textContent = next === 'auto' ? 'Auto' : (next === 'light' ? 'Light' : 'Dark');
  toast('Theme: ' + next);
}

/**
 * Show Auth Modal (Login / Sign Up / OTP)
 */
export function openAuthModal(defaultTab = 'login') {
  let existing = $('#authModalOverlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'authModalOverlay';
  overlay.className = 'auth-modal-overlay';

  overlay.innerHTML = `
    <div class="auth-modal" role="dialog" aria-modal="true">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0; font-size:19px;">Account</h2>
        <button id="closeAuthModal" class="btn sm ghost" style="padding:4px 8px; font-size:16px;" type="button" aria-label="Close">&times;</button>
      </div>

      <div class="auth-tabs" id="authTabs">
        <button class="auth-tab ${defaultTab === 'login' ? 'active' : ''}" data-tab="login" type="button">Log In</button>
        <button class="auth-tab ${defaultTab === 'register' ? 'active' : ''}" data-tab="register" type="button">Sign Up</button>
      </div>

      <!-- Google Sign In Button -->
      <button class="google-btn" id="googleSignInBtn" type="button">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/>
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/>
          <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/>
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
        </svg>
        <span>Continue with Google</span>
      </button>

      <!-- Official Google button renders here when a Client ID is configured -->
      <div id="gsiButtonHost" class="hidden" style="display:flex; justify-content:center; margin-bottom:14px;"></div>

      <div class="divider">or with User ID / Email / Phone</div>

      <!-- Login Form -->
      <form id="authLoginForm" class="${defaultTab === 'login' ? '' : 'hidden'}">
        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:13px;">User ID, Email, or Phone</label>
        <input type="text" id="loginIdentifier" placeholder="e.g. rohan@example.com or 9876543210" required style="margin-bottom:12px;">

        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:13px;">Password</label>
        <input type="password" id="loginPassword" placeholder="Your password" required style="margin-bottom:14px;">

        <div id="loginError" class="pill bad hidden" style="width:100%; margin-bottom:12px; text-align:center;"></div>

        <button type="submit" class="btn primary" style="width:100%;">Log In</button>
      </form>

      <!-- Register Form -->
      <form id="authRegisterForm" class="${defaultTab === 'register' ? '' : 'hidden'}">
        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:13px;">Your Name</label>
        <input type="text" id="regName" placeholder="Full name (optional)" style="margin-bottom:12px;">

        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:13px;">Email or Phone Number</label>
        <input type="text" id="regIdentifier" placeholder="Email or 10-digit mobile number" required style="margin-bottom:6px;">
        <div class="muted small" style="margin-bottom:12px;">We'll send a 6-digit OTP to verify.</div>

        <label style="display:block; margin-bottom:6px; font-weight:600; font-size:13px;">Create Password</label>
        <input type="password" id="regPassword" placeholder="At least 6 characters" minlength="6" required style="margin-bottom:14px;">

        <div id="regError" class="pill bad hidden" style="width:100%; margin-bottom:12px; text-align:center;"></div>

        <button type="submit" class="btn primary" style="width:100%;">Send Verification OTP</button>
      </form>

      <!-- OTP Verification Form -->
      <form id="authOtpForm" class="hidden">
        <div style="text-align:center; margin-bottom:14px;">
          <h3 style="margin:0 0 6px;">Enter OTP</h3>
          <p class="muted small" style="margin:0;" id="otpPrompt">We sent a 6-digit code to your contact.</p>
        </div>

        <input type="text" id="otpCode" class="otp-input" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" placeholder="123456" required style="margin-bottom:12px;">

        <div id="otpNotice" class="pill brand hidden" style="width:100%; margin-bottom:12px; text-align:center; font-size:12px;"></div>
        <div id="otpError" class="pill bad hidden" style="width:100%; margin-bottom:12px; text-align:center;"></div>

        <button type="submit" class="btn primary" style="width:100%; margin-bottom:10px;">Verify &amp; Continue</button>

        <div style="display:flex; justify-content:space-between; align-items:center;">
          <button type="button" id="otpBackBtn" class="btn sm ghost">Back</button>
          <button type="button" id="otpResendBtn" class="btn sm ghost">Resend OTP</button>
        </div>
      </form>
    </div>
  `;

  document.body.appendChild(overlay);
  bindAuthModalEvents(overlay);
}

/** Label for the theme button based on the saved preference. */
function themeLabel() {
  const t = getSettings().theme || 'auto';
  return t === 'auto' ? 'Auto' : (t === 'light' ? 'Light' : 'Dark');
}

/**
 * On phones the nav links live behind a menu button (see .nav-toggle in the CSS).
 * On wide screens the button is hidden and the links are always visible.
 */
function wireNavToggle() {
  const toggle = $('#navToggle');
  const menu = $('#navMenu');
  if (!toggle || !menu) return;

  const setOpen = (open) => {
    menu.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Hide menu' : 'Show menu');
  };
  setOpen(false);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!menu.classList.contains('open'));
  });
  // Close after choosing a page, tapping outside or pressing Escape.
  menu.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target) && !toggle.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}

/** Build the sticky top bar + footer into <header id="top"> and <footer id="foot">. */
export function mountChrome({ title = 'SuperTET Prep', active = 'index.html' } = {}) {
  const top = $('#top');
  if (top) {
    const langOpts = LANG_LABELS.map(([v, label]) =>
      '<option value="' + v + '"' + (getLang() === v ? ' selected' : '') + '>' + label + '</option>').join('');
    top.className = 'topbar';
    top.innerHTML =
      '<div class="topbar-inner">' +
        '<a class="brand" href="' + BASE + 'index.html">Super<span>TET</span> Prep</a>' +
        '<span class="spacer"></span>' +
        '<div class="topbar-actions">' +
          '<div id="authNavSlot" class="auth-nav-slot"></div>' +
          '<select id="langSel" title="Language" aria-label="Language">' + langOpts + '</select>' +
          '<button id="themeBtn" class="btn sm ghost" type="button" title="Switch theme">' + themeLabel() + '</button>' +
          '<button id="navToggle" class="btn sm ghost nav-toggle" type="button" aria-expanded="false" ' +
            'aria-controls="navMenu" aria-label="Show menu">&#9776;</button>' +
        '</div>' +
        '<nav class="nav" id="navMenu"></nav>' +
      '</div>';
    /** Draw the permitted nav links; re-run after every login/logout (stp:auth). */
    const renderNav = () => {
      const nav = $('#navMenu');
      if (!nav) return;
      nav.innerHTML = visibleNav().map(n => {
        const isActive = active === n.href || (active.startsWith('pages/') && n.href === active);
        return '<a href="' + BASE + n.href + '" class="' + (isActive ? 'active' : '') + '">' + esc(n.label) + '</a>';
      }).join('');
    };
    renderNav();
    $('#themeBtn').addEventListener('click', cycleTheme);
    $('#langSel').addEventListener('change', e => {
      setLang(e.target.value);
      // questions are rendered by each page; reload keeps things simple and consistent
      location.reload();
    });
    wireNavToggle();
    renderAuthNav();
    window.addEventListener('stp:auth', () => {
      // Progress / Questions links appear or vanish the moment the session changes.
      renderNav();
      renderAuthNav();
    });
    // Confirm a cached session with the backend; offline users keep their cached profile.
    if (isLoggedIn()) checkSession().catch(() => {});
  }
  const foot = $('#foot');
  if (foot) {
    foot.className = 'footer';
    foot.innerHTML = '<span>' + esc(title) + ' &middot; works offline &middot; your data stays on this device</span>';
  }
  applyTheme();
}
function bindAuthModalEvents(overlay) {
  const closeBtn = overlay.querySelector('#closeAuthModal');
  if (closeBtn) closeBtn.onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const tabs = overlay.querySelectorAll('.auth-tab');
  const loginForm = overlay.querySelector('#authLoginForm');
  const regForm = overlay.querySelector('#authRegisterForm');
  const otpForm = overlay.querySelector('#authOtpForm');

  tabs.forEach(tab => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const targetTab = tab.getAttribute('data-tab');
      otpForm.classList.add('hidden');
      if (targetTab === 'login') {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
      } else {
        regForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
      }
    };
  });

  let pendingTarget = '';
  let pendingType = 'register';

  function showOtpStep(target, devOtp, type = 'register') {
    pendingTarget = target;
    pendingType = type;
    loginForm.classList.add('hidden');
    regForm.classList.add('hidden');
    otpForm.classList.remove('hidden');
    const prompt = overlay.querySelector('#otpPrompt');
    if (prompt) prompt.textContent = `Enter the 6-digit verification code sent to ${target}`;
    const notice = overlay.querySelector('#otpNotice');
    if (notice) {
      if (devOtp) {
        notice.textContent = `Demo / Dev Mode OTP: ${devOtp}`;
        notice.classList.remove('hidden');
        const codeInput = overlay.querySelector('#otpCode');
        if (codeInput) codeInput.value = devOtp;
      } else {
        notice.classList.add('hidden');
      }
    }
  }

  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const errBox = overlay.querySelector('#loginError');
    errBox.classList.add('hidden');
    const idVal = overlay.querySelector('#loginIdentifier').value.trim();
    const passVal = overlay.querySelector('#loginPassword').value;
    try {
      const res = await login({ identifier: idVal, password: passVal });
      toast(`Welcome back, ${res.user.name}!`);
      overlay.remove();
      renderAuthNav();
    } catch (err) {
      if (err.needsOtp && err.target) {
        showOtpStep(err.target, err.devOtp, 'register');
      } else {
        errBox.textContent = err.message || 'Login failed';
        errBox.classList.remove('hidden');
      }
    }
  };

  regForm.onsubmit = async (e) => {
    e.preventDefault();
    const errBox = overlay.querySelector('#regError');
    errBox.classList.add('hidden');
    const nameVal = overlay.querySelector('#regName').value.trim();
    const idVal = overlay.querySelector('#regIdentifier').value.trim();
    const passVal = overlay.querySelector('#regPassword').value;
    try {
      const res = await register({ name: nameVal, identifier: idVal, password: passVal });
      toast('Verification OTP sent');
      showOtpStep(res.target, res.devOtp, 'register');
    } catch (err) {
      errBox.textContent = err.message || 'Registration failed';
      errBox.classList.remove('hidden');
    }
  };

  otpForm.onsubmit = async (e) => {
    e.preventDefault();
    const errBox = overlay.querySelector('#otpError');
    errBox.classList.add('hidden');
    const code = overlay.querySelector('#otpCode').value.trim();
    try {
      const res = await verifyOtp({ target: pendingTarget, code, type: pendingType });
      toast(`Welcome, ${res.user.name}! Account verified.`);
      overlay.remove();
      renderAuthNav();
    } catch (err) {
      errBox.textContent = err.message || 'Invalid OTP';
      errBox.classList.remove('hidden');
    }
  };

  const resendBtn = overlay.querySelector('#otpResendBtn');
  if (resendBtn) {
    resendBtn.onclick = async () => {
      try {
        const res = await resendOtp({ target: pendingTarget, type: pendingType });
        toast('New OTP sent');
        const notice = overlay.querySelector('#otpNotice');
        if (notice && res.devOtp) {
          notice.textContent = `Demo / Dev Mode OTP: ${res.devOtp}`;
          notice.classList.remove('hidden');
          const codeInput = overlay.querySelector('#otpCode');
          if (codeInput) codeInput.value = res.devOtp;
        }
      } catch (err) {
        toast('Failed to resend OTP: ' + err.message);
      }
    };
  }

  const backBtn = overlay.querySelector('#otpBackBtn');
  if (backBtn) {
    backBtn.onclick = () => {
      otpForm.classList.add('hidden');
      regForm.classList.remove('hidden');
    };
  }

  const gBtn = overlay.querySelector('#googleSignInBtn');
  if (gBtn) {
    gBtn.onclick = () => {
      initGoogleSignIn(overlay);
    };
  }
}

/** Load Google Identity Services and start the sign-in prompt. */
function initGoogleSignIn(overlay) {
  if (typeof window === 'undefined') return;
  if (!window.google || !window.google.accounts) {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => triggerGooglePrompt(overlay);
    document.head.appendChild(script);
  } else {
    triggerGooglePrompt(overlay);
  }
}

function triggerGooglePrompt(overlay) {
  if (!window.google || !window.google.accounts) return;
  const clientId = String(getSettings().googleClientId || '').trim();
  const customBtn = overlay.querySelector('#googleSignInBtn');
  const host = overlay.querySelector('#gsiButtonHost');

  // Without a Client ID Google cannot show its widget - tell the user how to enable it.
  if (!clientId) {
    if (host) {
      host.classList.remove('hidden');
      host.innerHTML = '<div class="pill warn" style="width:100%; padding:8px; text-align:left; font-size:12px;">' +
        'Google Sign-In needs an OAuth Client ID (Google Cloud Console &rarr; Credentials). ' +
        'Set it once with <code>saveSettings({ googleClientId: \'...\' })</code>.</div>';
    }
    if (customBtn) customBtn.classList.add('hidden');
    toast('Add your Google OAuth Client ID to enable Google Sign-In');
    return;
  }

  const onCredential = async (response) => {
    if (!response || !response.credential) return;
    try {
      const res = await loginWithGoogleCredential(response.credential);
      toast(`Logged in as ${res.user.name}`);
      if (overlay) overlay.remove();
      renderAuthNav();
    } catch (err) {
      toast('Google login failed: ' + err.message);
    }
  };

  try {
    window.google.accounts.id.initialize({ client_id: clientId, callback: onCredential });
    // The official button is the most reliable path; One Tap prompt() alone can be blocked.
    if (host && window.google.accounts.id.renderButton) {
      window.google.accounts.id.renderButton(host, {
        type: 'standard', theme: 'outline', size: 'large',
        text: 'continue_with', logo_alignment: 'left', width: 320,
      });
      host.classList.remove('hidden');
      if (customBtn) customBtn.classList.add('hidden');
    }
    window.google.accounts.id.prompt();
  } catch (e) {
    console.warn('Google Sign-In could not start:', e);
    toast('Google Sign-In could not start. Check your Client ID and allowed origins.');
  }
}

export function renderAuthNav() {
  const container = $('#authNavSlot');
  if (!container) return;

  const user = getCurrentUser();
  if (user) {
    const initial = (user.name || user.email || 'U')[0].toUpperCase();
    const avatarHtml = user.avatar
      ? `<span class="auth-avatar"><img src="${esc(user.avatar)}" alt="${esc(user.name)}"></span>`
      : `<span class="auth-avatar">${initial}</span>`;

    // Small badge so an admin can always tell which account they are using.
    const role = user.role === 'admin' ? 'Admin' : (user.canAddQuestions ? 'Contributor' : '');
    const badgeHtml = role
      ? `<span class="auth-badge ${user.role === 'admin' ? 'admin' : ''}">${esc(role)}</span>`
      : '';

    container.innerHTML = `
      <a class="auth-chip" id="userMenuBtn" href="${BASE}pages/profile.html"
         title="${esc(user.name)} (${esc(user.email || user.phone || user.userId || '')}) &middot; open profile">
        ${avatarHtml}
        <span class="chip-name truncate">${esc(user.name || 'Student')}</span>
        ${badgeHtml}
      </a>
      <button class="btn sm ghost" id="btnLogout" type="button" title="Log out" style="padding:4px 8px; font-size:12px;">Log out</button>
    `;

    const logoutBtn = $('#btnLogout');
    if (logoutBtn) {
      logoutBtn.onclick = () => {
        logout();
        renderAuthNav();
        location.reload();
      };
    }
  } else {
    container.innerHTML = `
      <button id="btnOpenLogin" class="btn sm primary" type="button" style="padding:5px 11px; font-size:13px;">Login</button>
    `;
    const btn = $('#btnOpenLogin');
    if (btn) btn.onclick = () => openAuthModal('login');
  }
}

/** Register the service worker so the site works offline (needs http/https). */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).catch(e => console.warn('SW failed', e));
  });
}

/** Small helper: read ?id= from the URL. */
export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

/** Render an error box inside a container. */
export function errorBox(host, err) {
  if (!host) return;
  host.innerHTML = '<div class="card"><h3>Something went wrong</h3><p class="muted small">' +
    esc(err && err.message ? err.message : err) + '</p></div>';
}

/** Render a list of {label, value} as simple rows. */
export function rowsHtml(rows) {
  return rows.map(r => '<div class="row"><span class="grow">' + esc(r.label) + '</span>' +
    '<span class="pill">' + esc(r.value) + '</span></div>').join('');
}

/* Register the offline worker once per page load. */
registerSW();

