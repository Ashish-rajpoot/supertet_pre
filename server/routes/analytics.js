import { Router } from 'express';
import { Attempt } from '../models/Attempt.js';
import { User } from '../models/User.js';
import { isDbConnected } from '../db.js';
import { requireAdmin } from '../auth-util.js';

const router = Router();

function requireDb(res) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'MongoDB is not connected. Local storage is being used.' });
    return false;
  }
  return true;
}

const round = n => Math.round((n || 0) * 10) / 10;

/**
 * GET /api/analytics/users - admin only.
 * User-wise analytics: one row per student with their test count, average, best
 * score, overall accuracy and last activity. Students who never practised are
 * included with zeros so the admin can see who needs a nudge.
 */
router.get('/users', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const users = await User.find()
      .select('id name email phone userId role canAddQuestions createdAt')
      .sort({ createdAt: 1 })
      .lean();

    const grouped = await Attempt.aggregate([
      { $match: { userId: { $nin: ['', null] } } },
      {
        $group: {
          _id: '$userId',
          attempts: { $sum: 1 },
          avgPercent: { $avg: '$percent' },
          best: { $max: '$percent' },
          totalQuestions: { $sum: '$total' },
          correctAnswers: { $sum: '$correct' },
          lastAt: { $max: '$at' },
        },
      },
    ]);

    const byId = new Map(grouped.map(g => [String(g._id), g]));
    const students = users.map(u => {
      const g = byId.get(u.id) || {};
      byId.delete(u.id);
      return {
        userId: u.id,
        name: u.name || 'Student',
        email: u.email || '',
        phone: u.phone || '',
        role: u.role || 'user',
        canAddQuestions: Boolean(u.canAddQuestions),
        attempts: g.attempts || 0,
        avgPercent: g.attempts ? round(g.avgPercent) : 0,
        best: g.best || 0,
        accuracy: g.totalQuestions ? Math.round(((g.correctAnswers || 0) / g.totalQuestions) * 100) : 0,
        totalQuestions: g.totalQuestions || 0,
        lastAt: g.lastAt || 0,
      };
    });

    // Attempts whose account was deleted still show up, so no data is hidden.
    for (const [userId, g] of byId) {
      students.push({
        userId,
        name: 'Unknown user',
        email: '', phone: '', role: 'user', canAddQuestions: false,
        attempts: g.attempts || 0,
        avgPercent: round(g.avgPercent),
        best: g.best || 0,
        accuracy: g.totalQuestions ? Math.round(((g.correctAnswers || 0) / g.totalQuestions) * 100) : 0,
        totalQuestions: g.totalQuestions || 0,
        lastAt: g.lastAt || 0,
      });
    }

    students.sort((a, b) => (b.attempts - a.attempts) || String(a.name).localeCompare(String(b.name)));
    res.json({ students, count: students.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;