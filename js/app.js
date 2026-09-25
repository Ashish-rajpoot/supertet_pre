/* ===========================================================
   app.js - shared shell: base path, nav, theme, settings, toast, auth modal
   =========================================================== */

import { BASE, $, $$, esc, toast, getLang, setLang, ready } from './util.js';
import { getSettings, saveSettings } from './store.js';
import { getCurrentUser, isLoggedIn, logout, login, register, verifyOtp, resendOtp, loginWithGoogleCredential, checkSession, canAddQuestions, isAdmin } from './auth.js';

export { BASE, $, $$, esc, toast, ready };

const LANG_LABELS = [
  ['both', 'हिंदी + English'],
  ['hi', 'हिंदी'],
  ['en', 'English'],
];

/** Theme cycle order used by the header button (auto follows the device). */
export const THEME_ORDER = ['auto', 'light', 'dark'];

/** Inline icons - no icon font, no extra request, and they inherit the text colour. */
const ICON = {
  menu: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  moon: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  auto: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/></svg>',
  caret: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M6 9.5l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  top: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d="M12 19V5M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/**
 * Links shown in the desktop nav and in the phone menu.
 *   group: 'study' | 'manage' -> the section heading inside the phone menu
 *   hint:  the one-line description under the label in the phone menu
 *   auth: true    -> only for a signed-in user
 *   editor: true  -> only for an admin, or a student allowed to add questions
 *   admin: true   -> only for the site admin
 * Hidden links are removed from the markup entirely, not just greyed out, so a
 * signed-out visitor cannot find the pages by looking at the source either.
 */
export const NAV = [
  { href: 'index.html', label: 'Home', group: 'study', hint: 'Question bank at a glance' },
  { href: 'pages/flashcards.html', label: 'Flashcards', group: 'study', hint: 'Flip cards for quick revision' },
  { href: 'pages/test.html', label: 'Test', group: 'study', hint: 'Timed test with instant scoring' },
  { href: 'pages/analytics.html', label: 'Progress', group: 'study', auth: true, hint: 'Scores, weak topics and trends' },
  { href: 'pages/manage.html', label: 'Questions', group: 'manage', editor: true, hint: 'Upload, paste or write with AI' },
  { href: 'pages/subjects.html', label: 'Subjects', group: 'manage', admin: true, hint: 'Maintain the syllabus' },
];

/** Phone-menu sections, in display order (empty ones are dropped). */
export const NAV_GROUPS = [
  { id: 'study', label: 'Practise' },
  { id: 'manage', label: 'Manage' },
];

/** May the current visitor see this nav link? */
export function canSeeNavLink(item) {
  if (item.auth && !isLoggedIn()) return false;
  if (item.editor && !canAddQuestions()) return false;
  if (item.admin && !isAdmin()) return false;
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

/** Keep the header icon button and the phone-menu buttons showing the current theme. */
function syncThemeControls() {
  const mode = getSettings().theme || 'auto';
  const label = THEME_ORDER.indexOf(mode) >= 0 ? mode : 'auto';

  const btn = $('#themeBtn');
  if (btn) {
    btn.innerHTML = label === 'auto' ? ICON.auto : (label === 'light' ? ICON.sun : ICON.moon);
    btn.title = 'Theme: ' + label;
    btn.setAttribute('aria-label', 'Theme: ' + label + '. Tap to change.');
  }

  $$('[data-theme-opt]').forEach(el => {
    const on = el.getAttribute('data-theme-opt') === label;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

/** Pick one theme explicitly - the header button and the phone menu both land here. */
export function setTheme(mode) {
  const next = THEME_ORDER.indexOf(String(mode)) >= 0 ? String(mode) : 'auto';
  saveSettings({ theme: next });
  applyTheme();
  syncThemeControls();
  toast('Theme: ' + next);
}

/** Header button: auto -> light -> dark -> auto. */
export function cycleTheme() {
  const cur = THEME_ORDER.indexOf(getSettings().theme || 'auto');
  setTheme(THEME_ORDER[(cur + 1) % THEME_ORDER.length]);
}

/**
 * Reading language. Each page renders its text once at load time, so a change
 * reloads - the same behaviour as before, now shared by the header and the menu.
 */
export function setLanguage(value) {
  const next = LANG_LABELS.some(([v]) => v === value) ? value : 'both';
  setLang(next);
  document.documentElement.setAttribute('data-lang', next);
  location.reload();
}

/** Keep the header <select> and the phone-menu buttons showing the current language. */
function syncLangControls() {
  const cur = getLang();
  const sel = $('#langSel');
  if (sel) sel.value = cur;
  $$('[data-lang-opt]').forEach(el => {
    const on = el.getAttribute('data-lang-opt') === cur;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
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

/** Set by wireDrawer(): lets other code (e.g. the "Log in" button) close the phone menu. */
let closeDrawer = () => {};

/** Log out from wherever the button lives (header menu, phone menu or footer). */
function doLogout() {
  logout();
  closeDrawer();
  renderAuthNav();
  location.reload();
}

/** Cleanup for the account popover's document listeners (the chip re-renders on every login). */
let accountMenuCleanup = null;

/**
 * The account popover in the header: avatar chip opens a small menu with the
 * profile link and Log out, so the bar itself stays uncluttered.
 */
function wireAccountMenu() {
  if (typeof accountMenuCleanup === 'function') { accountMenuCleanup(); accountMenuCleanup = null; }

  const btn = $('#accountBtn');
  const menu = $('#accountMenu');
  if (!btn || !menu) return;

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  setOpen(false);

  const onDocumentClick = (e) => {
    if (menu.hidden) return;
    if (!menu.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  };
  const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };

  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(menu.hidden); });
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onKeyDown);
  accountMenuCleanup = () => {
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onKeyDown);
  };
}

/**
 * Phones and tablets: the links, the account block and the preferences all live
 * in one slide-in menu, so the bar only carries the brand and two small buttons.
 * Wide screens never open it - the links are inline and the menu is hidden.
 */
function wireDrawer() {
  const toggle = $('#navToggle');
  const drawer = $('#navDrawer');
  const backdrop = $('#navBackdrop');
  const closeBtn = $('#navClose');
  if (!toggle || !drawer) return;

  let lastFocus = null;
  let hideTimer = null;

  const setOpen = (open) => {
    if (open === drawer.classList.contains('open')) return;
    clearTimeout(hideTimer);

    if (open) {
      // Put it in the layout first, then flip the class so the slide-in animates.
      drawer.hidden = false;
      void drawer.offsetWidth;
      drawer.classList.add('open');
    } else {
      drawer.classList.remove('open');
      // Let the slide-out finish, then guarantee it is really gone even if the
      // stylesheet never loaded (the hidden attribute is HTML, not CSS).
      hideTimer = setTimeout(() => { drawer.hidden = true; }, 280);
    }

    drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (backdrop) backdrop.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    // Locks the page behind the menu without the iOS "fixed body" jitter.
    document.documentElement.classList.toggle('drawer-open', open);
    if (open) {
      lastFocus = document.activeElement;
      const first = drawer.querySelector('a[href], button:not([disabled])');
      if (first && first.focus) first.focus();
    } else if (lastFocus && lastFocus.focus && lastFocus !== document.body) {
      lastFocus.focus();
    }
    if (!open) lastFocus = null;
  };
  closeDrawer = () => setOpen(false);

  toggle.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!drawer.classList.contains('open')); });
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));
  if (backdrop) backdrop.addEventListener('click', () => setOpen(false));
  // Choosing a page closes the menu; Escape closes it from anywhere.
  drawer.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  // Keep the keyboard inside the open menu (Tab / Shift+Tab loop).
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = $$('a[href], button:not([disabled])', drawer);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // Growing the window to the desktop layout must never leave the menu floating open.
  if (window.matchMedia) {
    const wide = window.matchMedia('(min-width: 900px)');
    const onChange = () => { if (wide.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener('change', onChange);
    else if (wide.addListener) wide.addListener(onChange);
  }
}

/** Build the sticky header (with the phone menu) and the footer into <header id="top"> / <footer id="foot">. */
export function mountChrome({ title = 'SuperTET Prep', active = 'index.html' } = {}) {
  const top = $('#top');
  if (top) {
    const langOpts = LANG_LABELS.map(([v, label]) =>
      '<option value="' + v + '"' + (getLang() === v ? ' selected' : '') + '>' + label + '</option>').join('');

    top.className = 'topbar';
    top.innerHTML = `
      <div class="topbar-inner">
        <a class="brand" href="${BASE}index.html" aria-label="SuperTET Prep - home">
          <span class="brand-mark" aria-hidden="true">ST</span>
          <span class="brand-text">Super<span class="brand-accent">TET</span> Prep</span>
        </a>

        <nav class="site-nav" id="navMenu" aria-label="Main menu"></nav>

        <div class="topbar-tools">
          <button id="themeBtn" class="icon-btn" type="button"></button>
          <div class="lang-slot">
            <label class="sr-only" for="langSel">Reading language</label>
            <select id="langSel">${langOpts}</select>
          </div>
          <div id="authNavSlot" class="auth-nav-slot"></div>
          <button id="navToggle" class="icon-btn nav-toggle" type="button" aria-expanded="false"
            aria-controls="navDrawer" aria-label="Open menu" title="Menu">${ICON.menu}</button>
        </div>
      </div>

      <div class="drawer-backdrop" id="navBackdrop" hidden></div>
      <aside class="nav-drawer" id="navDrawer" role="dialog" aria-modal="true" aria-hidden="true" aria-label="Menu" hidden>
        <div class="drawer-head">
          <span class="drawer-title">Menu</span>
          <button class="icon-btn" id="navClose" type="button" aria-label="Close menu" title="Close">${ICON.close}</button>
        </div>
        <div class="drawer-body">
          <div id="drawerAuthSlot" class="drawer-account"></div>
          <nav id="drawerNav" class="drawer-nav" aria-label="Pages"></nav>

          <p class="drawer-label">Preferences</p>
          <div class="drawer-pref">
            <span class="drawer-pref-name">Language</span>
            <div class="segmented" role="group" aria-label="Reading language">
              <button type="button" data-lang-opt="both">हिंदी + English</button>
              <button type="button" data-lang-opt="hi">हिंदी</button>
              <button type="button" data-lang-opt="en">English</button>
            </div>
          </div>
          <div class="drawer-pref">
            <span class="drawer-pref-name">Theme</span>
            <div class="segmented" role="group" aria-label="Theme">
              <button type="button" data-theme-opt="auto">Auto</button>
              <button type="button" data-theme-opt="light">Light</button>
              <button type="button" data-theme-opt="dark">Dark</button>
            </div>
          </div>
        </div>
      </aside>`;
    /**
     * Draw the permitted links. Wide screens show them in the bar, smaller ones in the
     * menu - never both, so no stylesheet or cache state can ever show them twice.
     * Re-run after every login/logout (stp:auth) and when the window crosses 900px.
     */
    const isWide = () => !window.matchMedia || window.matchMedia('(min-width: 900px)').matches;
    /** href + class (+ aria-current) for a nav link; `extra` adds the menu's own class. */
    const linkAttrs = (n, extra = '') => {
      const isActive = active === n.href;
      const cls = ((extra ? extra + ' ' : '') + (isActive ? 'active' : '')).trim();
      return ' href="' + BASE + n.href + '" class="' + cls + '"' + (isActive ? ' aria-current="page"' : '');
    };

    const renderNav = () => {
      const links = visibleNav();
      const wide = isWide();

      const nav = $('#navMenu');
      if (nav) {
        nav.innerHTML = wide
          ? links.map(n => '<a' + linkAttrs(n) + '>' + esc(n.label) + '</a>').join('')
          : '';
      }

      const drawerNav = $('#drawerNav');
      if (drawerNav) {
        drawerNav.innerHTML = wide ? '' : NAV_GROUPS.map(g => {
          const items = links.filter(n => (n.group || 'study') === g.id);
          if (!items.length) return '';
          return '<p class="drawer-label">' + esc(g.label) + '</p><div class="drawer-links">' +
            items.map(n => '<a' + linkAttrs(n, 'drawer-link') + '>' +
              '<span class="drawer-link-label">' + esc(n.label) + '</span>' +
              (n.hint ? '<span class="drawer-link-hint">' + esc(n.hint) + '</span>' : '') +
              '</a>').join('') + '</div>';
        }).join('');
      }
    };
    renderNav();

    // Compact one-tap controls in the bar; the rest of the settings live in the phone menu.
    const themeBtn = $('#themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', cycleTheme);
    const langSel = $('#langSel');
    if (langSel) langSel.addEventListener('change', e => setLanguage(e.target.value));
    top.querySelectorAll('[data-lang-opt]').forEach(el =>
      el.addEventListener('click', () => setLanguage(el.getAttribute('data-lang-opt'))));
    top.querySelectorAll('[data-theme-opt]').forEach(el =>
      el.addEventListener('click', () => setTheme(el.getAttribute('data-theme-opt'))));

    syncThemeControls();
    syncLangControls();
    wireDrawer();
    wireAccountMenu();
    renderAuthNav();

    // A hairline shadow once the page scrolls, so the sticky bar reads as "on top".
    const onScroll = () => top.classList.toggle('is-scrolled',
      (window.pageYOffset || document.documentElement.scrollTop || 0) > 4);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Crossing the breakpoint must move the links between the bar and the menu.
    if (window.matchMedia) {
      const wide = window.matchMedia('(min-width: 900px)');
      const onBreakpoint = () => renderNav();
      if (wide.addEventListener) wide.addEventListener('change', onBreakpoint);
      else if (wide.addListener) wide.addListener(onBreakpoint);
    }

    window.addEventListener('stp:auth', () => {
      // Progress / Questions links appear or vanish the moment the session changes.
      renderNav();
      renderAuthNav();
      renderFooter();
    });
    // Confirm a cached session with the backend; offline users keep their cached profile.
    if (isLoggedIn()) checkSession().catch(() => {});
  }
  /** The footer: brand blurb, the same permission-aware links and account shortcuts. */
  function renderFooter() {
    const foot = $('#foot');
    if (!foot) return;
    foot.className = 'site-footer';

    const links = visibleNav();
    const study = links.filter(n => (n.group || 'study') === 'study');
    const manage = links.filter(n => n.group === 'manage');
    const user = getCurrentUser();

    const navItem = (n) => '<li><a href="' + BASE + n.href + '"' +
      (active === n.href ? ' aria-current="page"' : '') + '>' + esc(n.label) + '</a></li>';
    const plainItem = (href, label) => '<li><a href="' + href + '">' + esc(label) + '</a></li>';

    // The prompt guide and the Excel template are public files, so everyone gets them.
    const bankItems = manage.map(navItem).join('') +
      plainItem(BASE + 'AI-QUESTION-PROMPT.md', 'AI question prompt guide') +
      plainItem(BASE + 'templates/questions-template.xlsx', 'Excel template');

    const accountItems = user
      ? '<li class="footer-user"><strong class="truncate">' + esc(user.name || 'Student') + '</strong>' +
        '<span class="muted truncate">' + esc(user.email || user.phone || user.userId || '') + '</span></li>' +
        navItem({ href: 'pages/profile.html', label: 'My profile' }) +
        '<li><button class="link-btn" id="footLogout" type="button">Log out</button></li>'
      : '<li><button class="link-btn" id="footLogin" type="button">Log in / Sign up</button></li>' +
        '<li><span class="muted">Sign in to track progress.</span></li>';

    foot.innerHTML = `
      <div class="footer-inner">
        <div class="footer-about">
          <a class="brand" href="${BASE}index.html" aria-label="SuperTET Prep - home">
            <span class="brand-mark" aria-hidden="true">ST</span>
            <span class="brand-text">Super<span class="brand-accent">TET</span> Prep</span>
          </a>
          <p class="footer-tagline">Bilingual (हिंदी + English) practice for SuperTET / TET style
            teacher-eligibility exams - flashcards, timed tests, answer review and progress tracking.</p>
          <p class="footer-badges">
            <span class="pill ok">Offline ready</span>
            <span class="pill">Private by default</span>
          </p>
        </div>

        <nav class="footer-col" aria-labelledby="footPractice">
          <h2 id="footPractice">Practise</h2>
          <ul>${study.map(navItem).join('')}</ul>
        </nav>

        <nav class="footer-col" aria-labelledby="footBank">
          <h2 id="footBank">Question bank</h2>
          <ul>${bankItems}</ul>
        </nav>

        <nav class="footer-col" aria-labelledby="footAccount">
          <h2 id="footAccount">Account</h2>
          <ul>${accountItems}</ul>
        </nav>
      </div>

      <div class="footer-bottom">
        <span>&copy; ${new Date().getFullYear()} SuperTET Prep &middot; ${esc(title)}</span>
        <span class="footer-meta">हिंदी + English &middot; your data stays on this device</span>
        <a class="footer-top" href="#top">Back to top ${ICON.top}</a>
      </div>`;

    const loginBtn = foot.querySelector('#footLogin');
    if (loginBtn) loginBtn.onclick = () => openAuthModal('login');
    const logoutBtn = foot.querySelector('#footLogout');
    if (logoutBtn) logoutBtn.onclick = doLogout;

    // "Back to top": #top is the sticky header, and browsers can no-op a fragment
    // jump when the target is already on screen - so scroll explicitly instead of
    // trusting the anchor (delegated once, survives every footer re-render).
    if (!foot.__backTopWired) {
      foot.__backTopWired = true;
      foot.addEventListener('click', (e) => {
        const a = e.target && e.target.closest ? e.target.closest('a.footer-top') : null;
        if (!a) return;
        e.preventDefault();
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        try { window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' }); }
        catch (_err) { window.scrollTo(0, 0); }
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', '#top');
      });
    }
  }
  renderFooter();

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

/**
 * Draw the account controls in both places that need them:
 *   #authNavSlot   - the compact avatar chip + popover in the header (desktop / tablet)
 *   #drawerAuthSlot - the full account block inside the phone menu
 * Re-run after every login / logout.
 */
export function renderAuthNav() {
  const header = $('#authNavSlot');
  const drawer = $('#drawerAuthSlot');
  if (!header && !drawer) return;

  const user = getCurrentUser();

  // Always the first letter of the name - a photo (or a broken image URL) never
  // gets a chance to blow up the size of the chip or the phone-menu account block.
  const avatarHtml = (u) =>
    `<span class="auth-avatar">${esc((String(u.name || u.email || u.userId || '').trim()[0] || 'U').toUpperCase())}</span>`;

  // Small badge so an admin can always tell which account they are using.
  const badgeHtml = (u) => {
    const role = u.role === 'admin' ? 'Admin' : (u.canAddQuestions ? 'Contributor' : '');
    return role ? `<span class="auth-badge${u.role === 'admin' ? ' admin' : ''}">${esc(role)}</span>` : '';
  };

  const identity = (u) => esc(u.email || u.phone || u.userId || '');

  if (header) {
    if (user) {
      header.innerHTML = `
        <button class="auth-chip" id="accountBtn" type="button" aria-haspopup="menu" aria-expanded="false"
          aria-controls="accountMenu" title="${esc(user.name || 'Student')} &middot; account menu">
          ${avatarHtml(user)}
          <span class="chip-name truncate">${esc(user.name || 'Student')}</span>
          ${badgeHtml(user)}
          <span class="chip-caret" aria-hidden="true">${ICON.caret}</span>
        </button>
        <div class="account-menu" id="accountMenu" role="menu" hidden>
          <div class="account-menu-head">
            <strong class="truncate">${esc(user.name || 'Student')}</strong>
            <span class="small muted truncate">${identity(user)}</span>
          </div>
          <a class="account-menu-item" role="menuitem" href="${BASE}pages/profile.html">My profile</a>
          <button class="account-menu-item danger" role="menuitem" id="btnLogout" type="button">Log out</button>
        </div>`;
      wireAccountMenu();
      const out = header.querySelector('#btnLogout');
      if (out) out.onclick = doLogout;
    } else {
      header.innerHTML = '<button id="btnOpenLogin" class="btn sm primary" type="button">Log in</button>';
      const btn = header.querySelector('#btnOpenLogin');
      if (btn) btn.onclick = () => openAuthModal('login');
    }
  }

  if (drawer) {
    if (user) {
      drawer.innerHTML = `
        <div class="drawer-user">
          ${avatarHtml(user)}
          <span class="drawer-user-text">
            <strong class="truncate">${esc(user.name || 'Student')}</strong>
            <span class="small muted truncate">${identity(user)}</span>
          </span>
          ${badgeHtml(user)}
        </div>
        <div class="drawer-user-actions">
          <a class="btn sm" href="${BASE}pages/profile.html">My profile</a>
          <button class="btn sm ghost" id="drawerLogout" type="button">Log out</button>
        </div>`;
      const out = drawer.querySelector('#drawerLogout');
      if (out) out.onclick = doLogout;
    } else {
      drawer.innerHTML = `
        <p class="muted small drawer-note">Sign in to save your results, track progress and help
          maintain the shared question bank.</p>
        <button class="btn primary block" id="drawerLogin" type="button">Log in / Sign up</button>`;
      const btn = drawer.querySelector('#drawerLogin');
      if (btn) {
        btn.onclick = () => {
          closeDrawer();              // the modal has to sit on top of the menu
          openAuthModal('login');
        };
      }
    }
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

