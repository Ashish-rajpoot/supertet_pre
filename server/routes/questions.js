import { Router } from 'express';
import { Question } from '../models/Question.js';
import { isDbConnected } from '../db.js';

const router = Router();

function requireDb(res) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'MongoDB is not connected. Local storage is being used.' });
    return false;
  }
  return true;
}

/** GET /api/questions - list questions with optional filters */
router.get('/', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const filter = {};
    if (req.query.subject) filter.subject = String(req.query.subject).trim();
    if (req.query.topic) filter.topic = String(req.query.topic).trim();
    if (req.query.difficulty) filter.difficulty = String(req.query.difficulty).trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 5000, 10000);

    const questions = await Question.find(filter).limit(limit).lean();
    res.json({ questions, count: questions.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/questions - bulk upsert questions */
router.post('/', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const list = Array.isArray(req.body) ? req.body : (req.body && req.body.questions);
    if (!Array.isArray(list) || !list.length) {
      return res.status(400).json({ error: 'Body must be an array of questions or { questions: [...] }' });
    }

    const ops = list
      .filter(q => q && q.id && q.answerIndex != null)
      .map(q => ({
        updateOne: {
          filter: { id: String(q.id) },
          update: { $set: q },
          upsert: true,
        },
      }));

    if (!ops.length) {
      return res.status(400).json({ error: 'No valid questions found to save' });
    }

    const result = await Question.bulkWrite(ops);
    res.status(201).json({
      ok: true,
      upserted: result.upsertedCount,
      modified: result.modifiedCount,
      matched: result.matchedCount,
      total: ops.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/questions/:id - remove one question */
router.delete('/:id', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const r = await Question.deleteOne({ id: req.params.id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/questions - clear all questions (or per subject) */
router.delete('/', async (req, res) => {
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
