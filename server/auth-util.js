import crypto from 'node:crypto';
import { User } from './models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'supertet-secret-key-change-in-prod-123!';

/** Hash password with salt using native Node crypto scrypt */
export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

/** Verify password against stored hash and salt */
export function verifyPassword(password, salt, storedHash) {
  if (!password || !salt || !storedHash) return false;
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

/** Create a simple self-contained JWT token valid for 30 days */
export function signToken(payload, expiresInSeconds = 30 * 24 * 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

/** Verify a self-contained JWT token */
export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (expectedSig !== signature) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch (_e) {
    return null;
  }
}

/** Generate a 6-digit numeric OTP */
export function generateOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Express middleware to authenticate token from Authorization header or cookie */
export function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = payload;
  next();
}

/**
 * Express middleware: attach req.user when a readable token is present,
 * but let the request through otherwise (used by routes that support both modes).
 */
export function optionalAuth(req, _res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (payload) req.user = payload;
  next();
}

/**
 * Express middleware: the caller must be signed in AND have the admin role.
 * The role is always read from the database so promotions/demotions apply instantly.
 */
export async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const user = await User.findOne({ id: payload.id });
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin permission is required for this action' });
    }
    req.user = payload;
    req.dbUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not verify admin permission' });
  }
}

/**
 * Express middleware for question editors: an admin, or a student the admin
 * has explicitly allowed with `canAddQuestions`.
 */
export async function requireQuestionEditor(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    return res.status(401).json({ error: 'Please log in to add or change questions' });
  }
  try {
    const user = await User.findOne({ id: payload.id });
    if (!user) {
      return res.status(401).json({ error: 'Your account no longer exists' });
    }
    const allowed = user.role === 'admin' || user.canAddQuestions === true;
    if (!allowed) {
      return res.status(403).json({
        error: 'You do not have permission to add questions. Ask the admin to allow you.',
      });
    }
    req.user = payload;
    req.dbUser = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message || 'Could not verify your permission' });
  }
}
