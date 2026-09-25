import { Router } from 'express';
import { Question } from '../models/Question.js';
import { isDbConnected } from '../db.js';
import { requireQuestionEditor, requireAdmin } from '../auth-util.js';

const router = Router();

function requireDb(res) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'MongoDB is not connected. Local storage is being used.' });
    return false;
  }
  return true;
}

/** Anyone can READ the shared bank (students need it offline too). */
/** GET /api/questions - list questions with optional filters */
router.get('/', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const filter = {};
    if (req.query.subject) filter.subject = String(req.query.subject).trim();
    if (req.query.topic) filter.topic = String(req.query.topic).trim();
    if (req.query.difficulty) filter.difficulty = String(req.query.difficulty).trim();
    if (req.query.createdBy) filter.createdBy = String(req.query.createdBy).trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 10000);

    const questions = await Question.find(filter).limit(limit).lean();
    res.json({ questions, count: questions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/questions - bulk upsert questions.
 * ONLY an admin, or a student the admin has granted `canAddQuestions`, may call this.
 * A student may only create new questions or update questions they created themselves.
 */
router.post('/', requireQuestionEditor, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const isAdmin = req.dbUser.role === 'admin';
    const list = Array.isArray(req.body) ? req.body : (req.body && req.body.questions);
    if (!Array.isArray(list) || !list.length) {
      return res.status(400).json({ error: 'Body must be an array of questions or { questions: [...] }' });
    }

    const incoming = list.filter(q => q && q.id && q.answerIndex != null);
    if (!incoming.length) {
      return res.status(400).json({ error: 'No valid questions found to save' });
    }

    // For students: load the owners of the ids they are trying to write.
    let owned = new Map();
    if (!isAdmin) {
      const ids = incoming.map(q => String(q.id));
      const existing = await Question.find({ id: { $in: ids } }).select('id createdBy').lean();
      owned = new Map(existing.map(q => [String(q.id), q.createdBy || '']));
    }

    const ops = [];
    const skipped = [];
    for (const q of incoming) {
      const id = String(q.id);
      if (!isAdmin) {
        const owner = owned.get(id);
        if (owner && owner !== req.user.id) {
          skipped.push(id);   // somebody else's question - leave it alone
          continue;
        }
      }
      ops.push({
        updateOne: {
          filter: { id },
          update: {
            $set: Object.assign({}, q, {
              id,
              createdBy: isAdmin ? (q.createdBy || req.user.id) : req.user.id,
              source: isAdmin ? 'admin' : 'user',
            }),
          },
          upsert: true,
        },
      });
    }

    if (!ops.length) {
      return res.status(403).json({
        error: 'Those questions belong to another user. Ask the admin if you need to change them.',
        skipped,
      });
    }

    const result = await Question.bulkWrite(ops);
    res.status(201).json({
      ok: true,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      matched: result.matchedCount,
      total: ops.length,
      skipped,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/questions/:id - an admin can remove any question,
 * a permitted student only the questions they added.
 */
router.delete('/:id', requireQuestionEditor, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Question.findOne({ id: req.params.id }).select('id createdBy').lean();
    if (!doc) return res.status(404).json({ error: 'Not found' });
    if (req.dbUser.role !== 'admin' && doc.createdBy && doc.createdBy !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete questions that you added' });
    }
    await Question.deleteOne({ id: req.params.id });
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/questions - clear all questions (or per subject). Admin only. */
router.delete('/', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const filter = {};
    if (req.query.subject) filter.subject = String(req.query.subject).trim();
    const r = await Question.deleteMany(filter);
    res.json({ ok: true, count: r.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
