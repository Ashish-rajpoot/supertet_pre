import { Router } from 'express';
import { Attempt } from '../models/Attempt.js';
import { isDbConnected } from '../db.js';

const router = Router();

function requireDb(res) {
  if (!isDbConnected()) {
    res.status(503).json({ error: 'MongoDB is not connected. Local storage is being used.' });
    return false;
  }
  return true;
}

/** GET /api/attempts - list attempts (most recent first) */
router.get('/', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const filter = {};
    if (req.query.student) filter.student = String(req.query.student).trim();
    if (req.query.mode) filter.mode = String(req.query.mode).trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

    // Omit heavy details array for the list view to keep responses fast
    const docs = await Attempt.find(filter)
      .select('-details')
      .sort({ at: -1 })
      .limit(limit)
      .lean();

    res.json({ attempts: docs });
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

/** POST /api/attempts - save or upsert an attempt */
router.post('/', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const data = req.body || {};
    if (!data.id || data.total == null) {
      return res.status(400).json({ error: 'Missing required field: id and total are required' });
    }
    const doc = await Attempt.findOneAndUpdate(
      { id: data.id },
      { $set: data },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.status(201).json({ ok: true, id: doc.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/attempts/:id - delete a single attempt */
router.delete('/:id', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const r = await Attempt.deleteOne({ id: req.params.id });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/attempts - clear all attempts (or per student) */
router.delete('/', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const filter = {};
    if (req.query.student) filter.student = String(req.query.student).trim();
    const r = await Attempt.deleteMany(filter);
    res.json({ ok: true, count: r.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
