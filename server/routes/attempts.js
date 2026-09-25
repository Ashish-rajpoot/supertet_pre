import { Router } from 'express';
import { Attempt } from '../models/Attempt.js';
import { User } from '../models/User.js';
import { isDbConnected } from '../db.js';
import { requireAuth, optionalAuth } from '../auth-util.js';

const router = Router();

function requireDb(res) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'MongoDB is not connected. Local storage is being used.' });
    return false;
  }
  return true;
}

/** Is the signed-in caller an admin? (role is read fresh from the database) */
async function isAdminUser(userId) {
  if (!userId) return false;
  const user = await User.findOne({ id: userId }).select('role').lean();
  return Boolean(user && user.role === 'admin');
}

/**
 * GET /api/attempts - list attempts, always scoped to one user.
 *   (default)        -> the signed-in user's own attempts
 *   ?scope=all       -> every student  (admin only)
 *   ?userId=<id>     -> one student    (admin only)
 * GET /api/attempts/:id stays public so shared result links keep working.
 */
router.get('/', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const admin = await isAdminUser(req.user.id);
    const wantsAll = req.query.scope === 'all';
    const wantsUser = String(req.query.userId || '').trim();

    const filter = {};
    if (wantsAll || wantsUser) {
      if (!admin) {
        return res.status(403).json({ error: 'Only an admin can see other students\' results' });
      }
      if (wantsUser) filter.userId = wantsUser;
    } else {
      filter.userId = req.user.id;
    }
    if (req.query.student) filter.student = String(req.query.student).trim();
    if (req.query.mode) filter.mode = String(req.query.mode).trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    // Omit heavy details array for the list view to keep responses fast
    const docs = await Attempt.find(filter)
      .select('-details')
      .sort({ at: -1 })
      .limit(limit)
      .lean();

    res.json({ attempts: docs, scope: wantsAll ? 'all' : (wantsUser ? 'user' : 'mine') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/attempts/:id - fetch full single result including details (for sharing) */
router.get('/:id', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Attempt.findOne({ id: req.params.id }).lean();
    if (!doc) return res.status(404).json({ error: 'Result not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/attempts - save or upsert an attempt.
 * When the caller is signed in the attempt is attributed to their account, so the
 * analytics page can show a user-wise breakdown.
 */
router.post('/', optionalAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const data = Object.assign({}, req.body || {});
    if (!data.id || data.total == null) {
      return res.status(400).json({ error: 'Missing required field: id and total are required' });
    }

    if (req.user && req.user.id) {
      data.userId = req.user.id;
      const account = await User.findOne({ id: req.user.id }).select('name').lean();
      if (account && account.name) data.student = account.name;
    } else if (!data.userId) {
      data.userId = '';
    }

    const doc = await Attempt.findOneAndUpdate(
      { id: data.id },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ ok: true, id: doc.id, userId: doc.userId || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/attempts/:id - delete a single attempt.
 * Anonymous (device-only) attempts can be deleted by anyone holding the id;
 * attempts owned by an account need the owner or an admin.
 */
router.delete('/:id', optionalAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Attempt.findOne({ id: req.params.id }).select('id userId').lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });

    if (doc.userId) {
      const admin = await isAdminUser(req.user && req.user.id);
      if (!req.user || (req.user.id !== doc.userId && !admin)) {
        return res.status(403).json({ error: 'You can only delete your own results' });
      }
    }

    await Attempt.deleteOne({ id: req.params.id });
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/attempts - clear results.
 *   admin  -> every student (optionally ?student= or ?userId=)
 *   user   -> only their own attempts
 */
router.delete('/', requireAuth, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const admin = await isAdminUser(req.user.id);
    const filter = {};
    if (admin) {
      if (req.query.student) filter.student = String(req.query.student).trim();
      if (req.query.userId) filter.userId = String(req.query.userId).trim();
    } else {
      filter.userId = req.user.id;
    }
    const r = await Attempt.deleteMany(filter);
    res.json({ ok: true, count: r.deletedCount, scope: admin ? 'all' : 'mine' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
