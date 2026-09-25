import { Router } from 'express';
import crypto from 'node:crypto';
import { User } from '../models/User.js';
import { Otp } from '../models/Otp.js';
import { isDbConnected } from '../db.js';
import { hashPassword, verifyPassword, signToken, generateOtp, requireAuth, requireAdmin } from '../auth-util.js';

const router = Router();

function requireDb(res) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'MongoDB is not connected. User login is unavailable offline.' });
    return false;
  }
  return true;
}

/** Fields sent to the browser - never passwordHash / salt / googleId. */
function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email || '',
    phone: user.phone || '',
    userId: user.userId || '',
    avatar: user.avatar || '',
    verified: Boolean(user.verified),
    role: user.role || 'user',
    canAddQuestions: Boolean(user.canAddQuestions),
    classLevel: user.classLevel || '',
    city: user.city || '',
    school: user.school || '',
    about: user.about || '',
    createdAt: user.createdAt,
  };
}

/**
 * Admin bootstrap: any email listed in the ADMIN_EMAILS env var (comma separated)
 * is promoted to admin the next time it is seen. Lets you create the first admin
 * without touching the database by hand.
 */
function adminEmails() {
  return String(process.env.ADMIN_EMAILS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

async function applyAdminBootstrap(user) {
  if (!user || !user.email) return false;
  if (!adminEmails().includes(String(user.email).toLowerCase())) return false;
  if (user.role === 'admin' && user.canAddQuestions) return false;
  user.role = 'admin';
  user.canAddQuestions = true;   // admins may always add questions
  await user.save();
  return true;
}

/** Fields a student may edit on their own profile (email/phone/userId are NOT here). */
const PROFILE_FIELDS = ['name', 'avatar', 'classLevel', 'city', 'school', 'about'];
/** Fields that identify the account - blocked explicitly so the rule is obvious. */
const IMMUTABLE_FIELDS = ['email', 'phone', 'userId', 'id', 'passwordHash', 'salt', 'googleId', 'role', 'canAddQuestions'];

/** Helper: normalize email or phone */
function parseIdentifier(input = '') {
  const str = String(input).trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  const isPhone = /^\+?[0-9]{10,14}$/.test(str.replace(/[\s-]/g, ''));
  return {
    raw: str,
    isEmail,
    isPhone,
    value: isPhone ? str.replace(/[\s-]/g, '') : (isEmail ? str.toLowerCase() : str),
  };
}

/** Dispatch OTP (prominently logged to server console in dev) */
async function dispatchOtp(target, code, type = 'register') {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await Otp.deleteMany({ target, type });
  await Otp.create({ target, code, type, expiresAt });
  console.log(`\n========================================\n[OTP] Sent to ${target}: ${code} (purpose: ${type}, valid 10m)\n========================================\n`);
}

/** POST /api/auth/register */
router.post('/register', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { name, identifier, userId, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Email/phone and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const idf = parseIdentifier(identifier);
    if (!idf.isEmail && !idf.isPhone) {
      return res.status(400).json({ error: 'Please enter a valid email address or phone number' });
    }

    const query = idf.isEmail ? { email: idf.value } : { phone: idf.value };
    let existing = await User.findOne(query);
    if (existing && existing.verified) {
      return res.status(409).json({ error: 'An account with this email/phone already exists. Please log in.' });
    }

    const { hash, salt } = hashPassword(password);
    const userIdVal = (userId && String(userId).trim()) || (idf.isEmail ? idf.value.split('@')[0] : `user_${Date.now().toString(36)}`);
    const displayName = (name && String(name).trim()) || userIdVal;

    if (!existing) {
      existing = new User({
        id: 'u_' + crypto.randomUUID(),
        name: displayName,
        email: idf.isEmail ? idf.value : undefined,
        phone: idf.isPhone ? idf.value : undefined,
        userId: userIdVal.toLowerCase(),
        passwordHash: hash,
        salt,
        verified: false,
      });
      await existing.save();
    } else {
      existing.name = displayName;
      existing.passwordHash = hash;
      existing.salt = salt;
      if (userIdVal) existing.userId = userIdVal.toLowerCase();
      await existing.save();
    }

    const code = generateOtp();
    await dispatchOtp(idf.value, code, 'register');

    res.status(200).json({
      ok: true,
      message: `OTP sent to ${idf.value}`,
      target: idf.value,
      isEmail: idf.isEmail,
      isPhone: idf.isPhone,
      devOtp: code,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Registration failed' });
  }
});

/** POST /api/auth/verify-otp */
router.post('/verify-otp', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { target, code, type = 'register' } = req.body || {};
    if (!target || !code) {
      return res.status(400).json({ error: 'Target and OTP code are required' });
    }

    const idf = parseIdentifier(target);
    const otpDoc = await Otp.findOne({ target: idf.value, type, code: String(code).trim() });

    if (!otpDoc || otpDoc.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired OTP code' });
    }

    await Otp.deleteOne({ _id: otpDoc._id });

    const userQuery = idf.isEmail ? { email: idf.value } : { phone: idf.value };
    const user = await User.findOne(userQuery);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.verified = true;
    await user.save();
    await applyAdminBootstrap(user);

    const token = signToken({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userId: user.userId,
    });

    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'OTP verification failed' });
  }
});

/** POST /api/auth/resend-otp */
router.post('/resend-otp', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { target, type = 'register' } = req.body || {};
    if (!target) return res.status(400).json({ error: 'Target identifier is required' });

    const idf = parseIdentifier(target);
    const code = generateOtp();
    await dispatchOtp(idf.value, code, type);

    res.json({
      ok: true,
      message: `New OTP sent to ${idf.value}`,
      target: idf.value,
      devOtp: code,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to resend OTP' });
  }
});
/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { identifier, password } = req.body || {};
    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password are required' });
    }

    const idf = parseIdentifier(identifier);
    const orCond = [
      { email: idf.value.toLowerCase() },
      { userId: idf.value.toLowerCase() },
    ];
    if (idf.isPhone) {
      orCond.push({ phone: idf.value });
    } else {
      orCond.push({ phone: idf.raw });
    }

    const user = await User.findOne({ $or: orCond });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials or account does not exist' });
    }

    const valid = verifyPassword(password, user.salt, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    if (!user.verified) {
      const target = user.email || user.phone;
      const code = generateOtp();
      await dispatchOtp(target, code, 'register');
      return res.status(403).json({
        error: 'Account not verified. Please verify your OTP.',
        needsOtp: true,
        target,
        devOtp: code,
      });
    }

    await applyAdminBootstrap(user);

    const token = signToken({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userId: user.userId,
    });

    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

/** POST /api/auth/google */
router.post('/google', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ error: 'Google credential token is required' });
    }

    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!googleRes.ok) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    const gData = await googleRes.json();
    const { sub: googleId, email, name, picture } = gData;

    if (!email) {
      return res.status(400).json({ error: 'Google account does not have an email address' });
    }

    let user = await User.findOne({ $or: [{ googleId }, { email: email.toLowerCase() }] });
    if (!user) {
      user = new User({
        id: 'u_' + crypto.randomUUID(),
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        googleId,
        avatar: picture || '',
        verified: true,
      });
      await user.save();
    } else {
      let changed = false;
      if (!user.googleId) { user.googleId = googleId; changed = true; }
      if (!user.avatar && picture) { user.avatar = picture; changed = true; }
      if (!user.verified) { user.verified = true; changed = true; }
      if (changed) await user.save();
    }

    await applyAdminBootstrap(user);

    const token = signToken({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      userId: user.userId,
    });

    res.json({ ok: true, token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Google authentication failed' });
  }
});

/** GET /api/auth/me */
router.get('/me', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    await applyAdminBootstrap(user);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/auth/profile - a student updates their own details.
 * Email, phone and the login id are identity fields: they can never be changed here.
 */
router.patch('/profile', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const body = req.body || {};

    // Be explicit instead of silently dropping: tell the caller these cannot change.
    const blocked = IMMUTABLE_FIELDS.filter(f => Object.prototype.hasOwnProperty.call(body, f));
    if (blocked.length) {
      return res.status(400).json({
        error: `These details cannot be changed: ${blocked.join(', ')}. Only name and profile details can be edited.`,
        blocked,
      });
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      const name = String(body.name || '').trim();
      if (name.length < 2 || name.length > 60) {
        return res.status(400).json({ error: 'Name must be between 2 and 60 characters' });
      }
      user.name = name;
    }

    if (Object.prototype.hasOwnProperty.call(body, 'avatar')) {
      const avatar = String(body.avatar || '').trim();
      if (avatar && !/^https?:\/\//i.test(avatar)) {
        return res.status(400).json({ error: 'Photo must be a full http(s) image link' });
      }
      if (avatar.length > 500) {
        return res.status(400).json({ error: 'Photo link is too long' });
      }
      user.avatar = avatar;
    }

    for (const field of PROFILE_FIELDS) {
      if (field === 'name' || field === 'avatar') continue;
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        const value = String(body[field] == null ? '' : body[field]).trim();
        if (value.length > 120) {
          return res.status(400).json({ error: `${field} is too long (max 120 characters)` });
        }
        user[field] = value;
      }
    }

    await user.save();
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not update the profile' });
  }
});

/** POST /api/auth/change-password - requires the current password. */
router.post('/change-password', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await User.findOne({ id: req.user.id });
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Google-only accounts have no password yet, so allow setting one without the old one.
    if (user.passwordHash) {
      const valid = verifyPassword(currentPassword, user.salt, user.passwordHash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const { hash, salt } = hashPassword(String(newPassword));
    user.passwordHash = hash;
    user.salt = salt;
    await user.save();
    res.json({ ok: true, message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not change the password' });
  }
});

/** GET /api/auth/users - admin only: student list for the permission panel. */
router.get('/users', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    const users = await User.find().sort({ createdAt: -1 }).limit(limit);
    res.json({ users: users.map(publicUser), count: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/auth/users/:id - admin only.
 * Grants/revokes `canAddQuestions` and (optionally) promotes/demotes a role.
 */
router.patch('/users/:id', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const body = req.body || {};
    const target = await User.findOne({ id: req.params.id });
    if (!target) return res.status(404).json({ error: 'User not found' });

    if (Object.prototype.hasOwnProperty.call(body, 'canAddQuestions')) {
      target.canAddQuestions = Boolean(body.canAddQuestions);
    }

    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      const role = String(body.role);
      if (!['user', 'admin'].includes(role)) {
        return res.status(400).json({ error: "role must be 'user' or 'admin'" });
      }
      if (target.id === req.user.id && role !== 'admin') {
        return res.status(400).json({ error: 'You cannot remove your own admin role' });
      }
      target.role = role;
      // Admins can always add questions, so keep the flag consistent.
      if (role === 'admin') target.canAddQuestions = true;
    }

    await target.save();
    res.json({ ok: true, user: publicUser(target) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not update the user' });
  }
});

export default router;
