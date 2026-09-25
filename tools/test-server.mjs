import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { start } from '../server/index.js';

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.error('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
};

console.log('\n=== SuperTET Server & MongoDB Integration Tests ===\n');

let mongod, server;
const PORT = 4567;
const BASE = `http://localhost:${PORT}`;

/** fetch wrapper returning { status, data } for the JSON API. */
async function call(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (_e) { /* empty body */ }
  return { status: res.status, data };
}

try {
  // Whoever is listed here becomes an admin - this is how you create the first admin.
  process.env.ADMIN_EMAILS = 'admin@example.com';

  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  server = await start(PORT, uri);

  /* ---------------- 1. status and static files ---------------- */
  const statusRes = await fetch(`${BASE}/api/status`);
  const statusData = await statusRes.json();
  ok('status returns ok: true', statusData.ok === true);
  ok('mongoConnected is true', statusData.mongoConnected === true);

  // Static files (verifies fix for Cannot GET /pages/pages/test.html)
  ok('/ serves 200', (await fetch(`${BASE}/`)).status === 200);
  ok('/pages/test.html serves 200', (await fetch(`${BASE}/pages/test.html`)).status === 200);
  for (const p of ['flashcards', 'analytics', 'manage', 'result']) {
    ok(`/pages/${p}.html serves 200`, (await fetch(`${BASE}/pages/${p}.html`)).status === 200);
  }
  ok('/js/auth.js serves 200', (await fetch(`${BASE}/js/auth.js`)).status === 200);
  ok('/js/app.js serves 200', (await fetch(`${BASE}/js/app.js`)).status === 200);
  ok('/pages/profile.html serves 200', (await fetch(`${BASE}/pages/profile.html`)).status === 200);
  ok('/js/profile.js serves 200', (await fetch(`${BASE}/js/profile.js`)).status === 200);

  /* ---------------- 1b. default admin account (bootstrap-admin.js) ---------------- */
  console.log('\n========================================\n[DEFAULT ADMIN] Seeded admin@gmail.com account\n========================================\n');
  const defLogin = await call('/api/auth/login', {
    method: 'POST', body: { identifier: 'admin@gmail.com', password: 'admin@123' },
  });
  ok('default admin@gmail.com logs in with admin@123',
    defLogin.status === 200 && Boolean(defLogin.data.token), JSON.stringify(defLogin.data));
  ok('the default account has role: admin', defLogin.data.user?.role === 'admin', JSON.stringify(defLogin.data.user));
  ok('the default account may add questions', defLogin.data.user?.canAddQuestions === true);
  const defMe = await call('/api/auth/me', { token: defLogin.data.token });
  ok('GET /api/auth/me confirms the seeded admin', defMe.data.user?.email === 'admin@gmail.com' && defMe.data.user?.role === 'admin');
  const defBadPw = await call('/api/auth/login', { method: 'POST', body: { identifier: 'admin@gmail.com', password: 'wrong' } });
  ok('a wrong password is refused for the default admin', defBadPw.status === 401);

  /* ---------------- 2. accounts: register, OTP, login ---------------- */
  // Attempts and questions now need a signed-in account, so those tests run
  // further down once the rohan / admin tokens exist.
  // Auth & OTP Tests
  // 1. Register with email -> generates OTP
  const regEmailRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Rohan Sharma',
      identifier: 'rohan@example.com',
      password: 'password123',
    }),
  });
  ok('POST /api/auth/register returns 200', regEmailRes.status === 200);
  const regEmailData = await regEmailRes.json();
  ok('Registration returns devOtp', Boolean(regEmailData.devOtp));

  // 2. Verify OTP
  const verifyEmailRes = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: 'rohan@example.com',
      code: regEmailData.devOtp,
    }),
  });
  ok('POST /api/auth/verify-otp returns 200', verifyEmailRes.status === 200);
  const verifyEmailData = await verifyEmailRes.json();
  ok('Verify OTP returns auth token', Boolean(verifyEmailData.token));
  ok('User is verified', verifyEmailData.user?.verified === true);

  // 3. Login with email & password
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: 'rohan@example.com',
      password: 'password123',
    }),
  });
  ok('POST /api/auth/login returns 200', loginRes.status === 200);
  const loginData = await loginRes.json();
  ok('Login returns user profile', loginData.user?.name === 'Rohan Sharma');

  // 4. GET /api/auth/me with Bearer token
  const meRes = await fetch(`${BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${loginData.token}` },
  });
  ok('GET /api/auth/me returns 200', meRes.status === 200);
  const meData = await meRes.json();
  ok('GET /api/auth/me matches user email', meData.user?.email === 'rohan@example.com');

  // 5. Register with phone number -> generates OTP
  const regPhoneRes = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Priya Verma',
      identifier: '+919876543210',
      password: 'mypassword99',
    }),
  });
  ok('POST /api/auth/register (phone) returns 200', regPhoneRes.status === 200);
  const regPhoneData = await regPhoneRes.json();
  ok('Phone registration returns devOtp', Boolean(regPhoneData.devOtp));

  // 6. Verify phone OTP
  const verifyPhoneRes = await fetch(`${BASE}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: '+919876543210',
      code: regPhoneData.devOtp,
    }),
  });
  ok('Verify phone OTP returns 200', verifyPhoneRes.status === 200);

  // 7. Login with phone
  const loginPhoneRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identifier: '+919876543210',
      password: 'mypassword99',
    }),
  });
  ok('Login with phone returns 200', loginPhoneRes.status === 200);

  // ============================================================
  // 9. Client auth module (js/auth.js) - same calls the modal makes
  // ============================================================
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  if (!globalThis.CustomEvent) {
    globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  }
  globalThis.document = {
    querySelector: () => null,
    querySelectorAll: () => [],
    readyState: 'complete',
    addEventListener() {},
    documentElement: { setAttribute() {} },
    body: { appendChild() {} },
    createElement: () => ({
      id: '', className: '', textContent: '', style: {}, _t: 0,
      classList: { add() {}, remove() {} },
      appendChild() {}, remove() {},
    }),
  };
  const winListeners = {};
  globalThis.window = {
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    dispatchEvent: (e) => { (winListeners[e.type] || []).forEach(fn => fn(e)); return true; },
    matchMedia: () => ({ matches: false }),
  };

  const store = await import('../js/store.js');
  const auth = await import('../js/auth.js');

  // Same thing the "API URL" setting does in the app: point the client at the test server.
  // In the browser getApiBase() resolves to "/api"; here we point it at the test server's /api.
  store.saveSettings({ apiUrl: BASE + '/api', name: '' });

  let authEvents = 0;
  globalThis.window.addEventListener('stp:auth', () => { authEvents++; });

  const cReg = await auth.register({ name: 'Client Tester', identifier: 'client@example.com', password: 'secret123' });
  ok('client register() returns target + devOtp', Boolean(cReg.devOtp) && cReg.target === 'client@example.com');
  ok('client isLoggedIn() is false before OTP', auth.isLoggedIn() === false);

  const cVerify = await auth.verifyOtp({ target: cReg.target, code: cReg.devOtp });
  ok('client verifyOtp() returns a token', Boolean(cVerify.token));
  ok('client isLoggedIn() after verify', auth.isLoggedIn() === true);
  ok('client getCurrentUser() has the name', auth.getCurrentUser()?.name === 'Client Tester');
  ok('client syncs the name into settings', store.getSettings().name === 'Client Tester');
  ok('stp:auth event fired for the topbar', authEvents > 0);

  const cMe = await auth.checkSession();
  ok('client checkSession() returns the profile', cMe?.email === 'client@example.com');

  auth.logout();
  ok('client logout() clears the session', auth.isLoggedIn() === false && auth.getCurrentUser() === null);

  const cLogin = await auth.login({ identifier: 'client@example.com', password: 'secret123' });
  ok('client login() returns a token', Boolean(cLogin.token));
  ok('client login() keeps the user', auth.getCurrentUser()?.email === 'client@example.com');

  auth.logout();
  let wrongErr = null;
  try { await auth.login({ identifier: 'client@example.com', password: 'wrong-pass' }); } catch (e) { wrongErr = e; }
  ok('client login() rejects a wrong password (401)', wrongErr?.status === 401, wrongErr && wrongErr.message);
  ok('a failed login leaves the user logged out', auth.isLoggedIn() === false);

  await auth.register({ name: 'Pending User', identifier: 'pending@example.com', password: 'secret123' });
  let needsOtpErr = null;
  try { await auth.login({ identifier: 'pending@example.com', password: 'secret123' }); } catch (e) { needsOtpErr = e; }
  ok('client login() flags needsOtp for unverified account', needsOtpErr?.needsOtp === true && needsOtpErr?.target === 'pending@example.com');
  ok('needsOtp error carries a dev OTP', Boolean(needsOtpErr?.devOtp));

  const resent = await auth.resendOtp({ target: 'pending@example.com' });
  ok('client resendOtp() returns a fresh OTP', Boolean(resent.devOtp));

  const verifiedPending = await auth.verifyOtp({ target: 'pending@example.com', code: resent.devOtp });
  ok('client verifies after resend and logs in', Boolean(verifiedPending.token) && auth.isLoggedIn() === true);

  /* ---------------- 11. profile: editable details, locked identity ---------------- */
  console.log('\n========================================\n[PROFILE] Editable details, locked identity\n========================================\n');
  const studentToken = (await call('/api/auth/login', {
    method: 'POST', body: { identifier: 'rohan@example.com', password: 'password123' },
  })).data.token;

  const anonProfile = await call('/api/auth/profile', { method: 'PATCH', body: { name: 'Nope' } });
  ok('PATCH /api/auth/profile needs a login (401)', anonProfile.status === 401);

  const patched = await call('/api/auth/profile', {
    method: 'PATCH', token: studentToken,
    body: { name: 'Rohan S. Sharma', city: 'Lucknow', school: 'TET Academy', classLevel: 'Paper 1', about: 'Preparing for SuperTET.' },
  });
  ok('PATCH /api/auth/profile returns 200', patched.status === 200);
  ok('name is updated', patched.data.user?.name === 'Rohan S. Sharma');
  ok('city / school / class / about are saved',
    patched.data.user?.city === 'Lucknow' && patched.data.user?.school === 'TET Academy' &&
    patched.data.user?.classLevel === 'Paper 1' && patched.data.user?.about === 'Preparing for SuperTET.');

  const blocked = await call('/api/auth/profile', {
    method: 'PATCH', token: studentToken, body: { email: 'new@example.com' },
  });
  ok('email cannot be changed (400)', blocked.status === 400 && /cannot be changed/i.test(blocked.data.error || ''), JSON.stringify(blocked.data));
  const blockedPhone = await call('/api/auth/profile', {
    method: 'PATCH', token: studentToken, body: { phone: '+919000000000' },
  });
  ok('phone cannot be changed (400)', blockedPhone.status === 400);
  const stillSame = await call('/api/auth/me', { token: studentToken });
  ok('email + phone are untouched after the rejected patch',
    stillSame.data.user?.email === 'rohan@example.com' && !stillSame.data.user?.phone);

  const badName = await call('/api/auth/profile', { method: 'PATCH', token: studentToken, body: { name: 'x' } });
  ok('a 1-character name is rejected', badName.status === 400);

  const pwChange = await call('/api/auth/change-password', {
    method: 'POST', token: studentToken, body: { currentPassword: 'wrong', newPassword: 'brandnew1' },
  });
  ok('changing the password needs the current one (401)', pwChange.status === 401);

  /* ---------------- 12. admin bootstrap + permission grants ---------------- */
  console.log('\n========================================\n[PERMISSIONS] Admin only question writing\n========================================\n');
  const adminReg = await call('/api/auth/register', {
    method: 'POST', body: { name: 'Site Admin', identifier: 'admin@example.com', password: 'adminpass1' },
  });
  const adminToken = (await call('/api/auth/verify-otp', {
    method: 'POST', body: { target: 'admin@example.com', code: adminReg.data.devOtp },
  })).data.token;
  const adminMe = await call('/api/auth/me', { token: adminToken });
  ok('ADMIN_EMAILS account gets role: admin', adminMe.data.user?.role === 'admin', JSON.stringify(adminMe.data.user));

  const students = await call('/api/auth/users', { token: studentToken });
  ok('GET /api/auth/users is admin only (403 for a student)', students.status === 403);
  const usersList = await call('/api/auth/users', { token: adminToken });
  ok('admin can list every account', usersList.status === 200 && usersList.data.users.length >= 3);

  const rohanId = stillSame.data.user.id;
  const selfDemote = await call('/api/auth/users/' + adminMe.data.user.id, { method: 'PATCH', token: adminToken, body: { role: 'user' } });
  ok('an admin cannot demote themselves', selfDemote.status === 400);
  const studentGrants = await call('/api/auth/users/' + rohanId, { method: 'PATCH', token: studentToken, body: { canAddQuestions: true } });
  ok('a student cannot grant themselves permission (403)', studentGrants.status === 403);

  /* ---------------- 13. question writing permissions ---------------- */
  const q = (id, subject) => ({
    id, subject, topic: 'General', difficulty: 'easy',
    question: { hi: id, en: id },
    options: { hi: ['a', 'b', 'c', 'd'], en: ['a', 'b', 'c', 'd'] },
    answerIndex: 0,
  });

  const noAuth = await call('/api/questions', { method: 'POST', body: [q('perm-anon', 'GK')] });
  ok('POST /api/questions needs a login (401)', noAuth.status === 401);
  const notGranted = await call('/api/questions', { method: 'POST', token: studentToken, body: [q('perm-none', 'GK')] });
  ok('a student without permission is refused (403)', notGranted.status === 403);

  const adminWrite = await call('/api/questions', { method: 'POST', token: adminToken, body: [q('admin-1', 'GK')] });
  ok('an admin can add questions', adminWrite.status === 201);

  const grant = await call('/api/auth/users/' + rohanId, { method: 'PATCH', token: adminToken, body: { canAddQuestions: true } });
  ok('admin can grant canAddQuestions', grant.status === 200 && grant.data.user?.canAddQuestions === true);

  const studentWrite = await call('/api/questions', { method: 'POST', token: studentToken, body: [q('student-1', 'GK')] });
  ok('a granted student can add questions', studentWrite.status === 201 && studentWrite.data.total === 1);
  ok('the student question is attributed to its author',
    (await call('/api/questions?createdBy=' + rohanId)).data.questions.some(x => x.id === 'student-1'));

  const steal = await call('/api/questions', { method: 'POST', token: studentToken, body: [q('admin-1', 'GK')] });
  ok("a student cannot overwrite an admin's question (403)", steal.status === 403);

  const delOwnQ = await call('/api/questions/student-1', { method: 'DELETE', token: studentToken });
  ok('a student can delete the question they added', delOwnQ.status === 200);
  const delOthers = await call('/api/questions/admin-1', { method: 'DELETE', token: studentToken });
  ok("a student cannot delete an admin's question (403)", delOthers.status === 403);

  const revoke = await call('/api/auth/users/' + rohanId, { method: 'PATCH', token: adminToken, body: { canAddQuestions: false } });
  ok('admin can revoke the permission', revoke.status === 200 && revoke.data.user?.canAddQuestions === false);
  const afterRevoke = await call('/api/questions', { method: 'POST', token: studentToken, body: [q('perm-revoked', 'GK')] });
  ok('the permission takes effect immediately (403)', afterRevoke.status === 403);

  const wipeAll = await call('/api/questions', { method: 'DELETE', token: studentToken });
  ok('clearing the whole bank is admin only (403)', wipeAll.status === 403);
  const wipeAsAdmin = await call('/api/questions', { method: 'DELETE', token: adminToken });
  ok('an admin can clear the bank', wipeAsAdmin.status === 200);

  /* ---------------- 14. attempts are scoped per user ---------------- */
  console.log('\n========================================\n[ATTEMPTS] Per-user scoping\n========================================\n');
  const attempt = (id, correct, total) => ({
    id, total, correct, wrong: total - correct, skipped: 0, score: correct,
    percent: Math.round((correct / total) * 100), at: Date.now(), mode: 'test', label: 'Test ' + id,
  });

  const anonPost = await call('/api/attempts', { method: 'POST', body: attempt('a-anon', 1, 10) });
  ok('an anonymous attempt is still accepted (device-only)', anonPost.status === 201 && anonPost.data.userId === '');

  await call('/api/attempts', { method: 'POST', token: studentToken, body: attempt('a-rohan-1', 8, 10) });
  await call('/api/attempts', { method: 'POST', token: studentToken, body: attempt('a-rohan-2', 6, 10) });
  const adminLogin = await call('/api/auth/login', { method: 'POST', body: { identifier: 'admin@example.com', password: 'adminpass1' } });
  const adminFreshToken = adminLogin.data.token;
  await call('/api/attempts', { method: 'POST', token: adminFreshToken, body: attempt('a-admin-1', 10, 10) });

  const noAuthList = await call('/api/attempts');
  ok('GET /api/attempts needs a login (401)', noAuthList.status === 401);
  const mine = await call('/api/attempts', { token: studentToken });
  ok('a student sees only their own attempts', mine.status === 200 && mine.data.attempts.length === 2 && mine.data.scope === 'mine');
  const allAsStudent = await call('/api/attempts?scope=all', { token: studentToken });
  ok('a student cannot read everyone (403)', allAsStudent.status === 403);
  const allAsAdmin = await call('/api/attempts?scope=all', { token: adminFreshToken });
  ok('an admin can read every attempt (including device-only rows)', allAsAdmin.status === 200 && allAsAdmin.data.attempts.length === 4, JSON.stringify(allAsAdmin.data.attempts.map(a => a.id)));
  const oneStudent = await call('/api/attempts?userId=' + rohanId, { token: adminFreshToken });
  ok('an admin can filter to one student', oneStudent.status === 200 && oneStudent.data.attempts.every(a => a.userId === rohanId));

  const delOther = await call('/api/attempts/a-admin-1', { method: 'DELETE', token: studentToken });
  ok("a student cannot delete another user's result (403)", delOther.status === 403);
  const delOwnResult = await call('/api/attempts/a-rohan-1', { method: 'DELETE', token: studentToken });
  ok('a student can delete their own result', delOwnResult.status === 200);
  const clearOne = await call('/api/attempts?userId=' + rohanId, { method: 'DELETE', token: adminFreshToken });
  ok("an admin can clear one student's results", clearOne.status === 200 && clearOne.data.scope === 'all');
  const afterClear = await call('/api/attempts', { token: studentToken });
  ok('the cleared rows are gone for the student too', afterClear.data.attempts.length === 0);

  /* ---------------- 15. user-wise analytics (admin only) ---------------- */
  console.log('\n========================================\n[ANALYTICS] User-wise dashboard\n========================================\n');
  await call('/api/attempts', { method: 'POST', token: studentToken, body: attempt('a-rohan-3', 6, 10) });
  const analyticsAsStudent = await call('/api/analytics/users', { token: studentToken });
  ok('GET /api/analytics/users is admin only (403)', analyticsAsStudent.status === 403);
  const analyticsAnon = await call('/api/analytics/users');
  ok('GET /api/analytics/users needs a login (401)', analyticsAnon.status === 401);

  const analytics = await call('/api/analytics/users', { token: adminFreshToken });
  ok('an admin gets the user-wise report', analytics.status === 200 && Array.isArray(analytics.data.students));
  const row = (analytics.data.students || []).find(s => s.userId === rohanId);
  ok('the row carries the student name + email', row?.name === 'Rohan S. Sharma' && row?.email === 'rohan@example.com');
  ok('the row shows tests / average / best / accuracy',
    row && row.attempts === 1 && row.avgPercent === 60 && row.best === 60 && row.accuracy === 60, JSON.stringify(row));
  ok('students who never practised are listed too', (analytics.data.students || []).some(s => s.attempts === 0));
  ok('the permission flag is exposed per student',
    (analytics.data.students || []).some(s => s.userId === rohanId && s.canAddQuestions === false));

} catch (err) {
  failures++;
  console.error('Test crashed:', err);
} finally {
  if (server) await new Promise(r => server.close(r));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

console.log('\n' + (failures ? `FAILED: ${failures}` : 'ALL SERVER & MONGODB TESTS PASSED!'));
process.exit(failures ? 1 : 0);
