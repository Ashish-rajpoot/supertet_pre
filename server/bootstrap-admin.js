/* ===========================================================
   bootstrap-admin.js - creates the very first admin account.

   Default credentials (development):
     email:    ADMIN_EMAIL    or admin@gmail.com
     password: ADMIN_PASSWORD or admin@123

   Called once at server boot and by `npm run seed`, so a fresh
   MongoDB always has an admin that can sign in without going
   through the OTP registration flow. Override both values via
   environment variables in production - the defaults are public.
   =========================================================== */

import crypto from 'node:crypto';
import { isDbConnected } from './db.js';
import { User } from './models/User.js';
import { hashPassword } from './auth-util.js';

export function defaultAdminEmail() {
  return String(process.env.ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();
}

export function defaultAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || 'admin@123');
}

/**
 * Ensure the default admin exists and is allowed to add questions.
 * Never overwrites an existing password - only the role / permission flags
 * are repaired, so changing the password later sticks.
 * @returns {Promise<import('mongoose').Document|null>} the admin user or null when offline
 */
export async function ensureDefaultAdmin() {
  if (!isDbConnected()) return null;

  const email = defaultAdminEmail();
  if (!email || !email.includes('@')) return null;
  const password = defaultAdminPassword();

  const existing = await User.findOne({ email });
  if (existing) {
    let dirty = false;
    if (existing.role !== 'admin') { existing.role = 'admin'; dirty = true; }
    if (!existing.canAddQuestions) { existing.canAddQuestions = true; dirty = true; }
    if (!existing.verified) { existing.verified = true; dirty = true; }
    // An account promoted by ADMIN_EMAILS but never given a password (e.g. imported) gets the default one.
    if (!existing.passwordHash) {
      const { hash, salt } = hashPassword(password);
      existing.passwordHash = hash;
      existing.salt = salt;
      dirty = true;
    }
    if (dirty) {
      await existing.save();
      console.log(`[admin] Repaired default admin flags for ${email}`);
    }
    return existing;
  }

  const { hash, salt } = hashPassword(password);
  const user = new User({
    id: 'u_' + crypto.randomUUID(),
    name: 'Site Admin',
    email,
    // The email doubles as the login id so it can never collide with the
    // user id another account picked at registration (e.g. "admin").
    userId: email,
    passwordHash: hash,
    salt,
    verified: true,
    role: 'admin',
    canAddQuestions: true,
  });
  await user.save();
  console.warn(`[admin] Created default admin account: ${email}`);
  console.warn('[admin] Password comes from ADMIN_PASSWORD env (default "admin@123"). Change it before going live!');
  return user;
}
