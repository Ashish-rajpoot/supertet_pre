/* ===========================================================
   routes/subjects.js - syllabus API (subjects + their topics)

   GET    /api/subjects                      anyone (students need it too)
   POST   /api/subjects                      admin: add a subject
   PATCH  /api/subjects/:id                  admin: rename / reorder
   DELETE /api/subjects/:id                  admin: remove a subject
   POST   /api/subjects/:id/topics           admin: add a topic
   PATCH  /api/subjects/:id/topics/:topicId  admin: rename a topic
   DELETE /api/subjects/:id/topics/:topicId  admin: remove a topic
   =========================================================== */

import { Router } from 'express';
import { Subject, slugify } from '../models/Subject.js';
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

/** Collapse whitespace so "Maths" and " Maths " are the same subject. */
const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive lookup used for the "already exists" checks. */
async function findByName(name) {
  const n = norm(name);
  if (!n) return null;
  return Subject.findOne({ name: { $regex: '^' + escapeRegex(n) + '$', $options: 'i' } }).lean();
}

/** A slug that no other subject is using (maths, maths-2, maths-3, ...). */
async function uniqueSubjectId(name) {
  const base = slugify(name);
  for (let i = 2; i < 500; i++) {
    const candidate = i === 2 ? base : base + '-' + i;
    const clash = await Subject.findOne({ id: candidate }).select('id').lean();
    if (!clash) return candidate;
  }
  return base + '-' + Date.now();
}

/** Topic id is deterministic inside its subject: maths--percentage. */
function topicIdFor(subjectId, name, taken) {
  const base = subjectId + '--' + slugify(name);
  let candidate = base;
  for (let i = 2; taken.has(candidate); i++) candidate = base + '-' + i;
  return candidate;
}

/** Read the request body as a subject payload, with every field trimmed. */
function readSubjectBody(body) {
  const b = body || {};
  const name = norm(b.name);
  const nameHi = norm(b.nameHi);
  const order = Number.isFinite(Number(b.order)) ? Number(b.order) : undefined;
  return { name, nameHi, order };
}

function normaliseTopics(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(t => ({ name: norm(t && t.name), nameHi: norm(t && t.nameHi) }))
    .filter(t => t.name);
}

/* ---------------- read (public) ---------------- */

router.get('/', async (_req, res) => {
  if (!requireDb(res)) return;
  try {
    const subjects = await Subject.find({}).sort({ order: 1, name: 1 }).lean();
    res.json({ subjects, count: subjects.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/subjects/:id - one subject with its topics. */
router.get('/:id', async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const subject = await Subject.findOne({ id: req.params.id }).lean();
    if (!subject) return res.status(404).json({ error: 'Subject not found' });
    res.json({ subject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- create a subject (admin) ---------------- */

router.post('/', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const { name, nameHi, order } = readSubjectBody(req.body);
    if (!name) return res.status(400).json({ error: 'Subject name is required' });
    if (await findByName(name)) {
      return res.status(409).json({ error: 'That subject already exists: ' + name });
    }
    const id = await uniqueSubjectId(name);
    const topics = normaliseTopics(req.body && req.body.topics);
    const taken = new Set();
    topics.forEach(t => {
      t.id = topicIdFor(id, t.name, taken);
      taken.add(t.id);
    });
    const subject = await Subject.create({
      id, name, nameHi,
      topics,
      order: order == null ? 0 : order,
      createdBy: req.user.id,
    });
    res.status(201).json({ ok: true, subject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- update a subject (admin) ---------------- */

router.patch('/:id', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Subject.findOne({ id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Subject not found' });

    const { name, nameHi, order } = readSubjectBody(req.body);
    if (name) {
      const clash = await findByName(name);
      if (clash && clash.id !== doc.id) {
        return res.status(409).json({ error: 'That subject already exists: ' + name });
      }
      doc.name = name;                 // the id stays stable so links never break
    }
    if (nameHi !== undefined && req.body && req.body.nameHi !== undefined) doc.nameHi = nameHi;
    if (order != null) doc.order = order;
    await doc.save();
    res.json({ ok: true, subject: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- delete a subject (admin) ---------------- */

router.delete('/:id', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const r = await Subject.deleteOne({ id: req.params.id });
    if (!r.deletedCount) return res.status(404).json({ error: 'Subject not found' });
    res.json({ ok: true, deleted: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- topics ---------------- */

router.post('/:id/topics', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Subject.findOne({ id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Subject not found' });

    const name = norm(req.body && req.body.name);
    if (!name) return res.status(400).json({ error: 'Topic name is required' });
    const dup = doc.topics.some(t => t.name.toLowerCase() === name.toLowerCase());
    if (dup) return res.status(409).json({ error: 'That topic is already in this subject: ' + name });

    const taken = new Set(doc.topics.map(t => t.id));
    const topic = {
      id: topicIdFor(doc.id, name, taken),
      name,
      nameHi: norm(req.body && req.body.nameHi),
    };
    doc.topics.push(topic);
    await doc.save();
    res.status(201).json({ ok: true, subject: doc, topic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/topics/:topicId', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Subject.findOne({ id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Subject not found' });
    const topic = doc.topics.find(t => t.id === req.params.topicId);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const name = norm(req.body && req.body.name);
    if (name) {
      const dup = doc.topics.some(t => t.id !== topic.id && t.name.toLowerCase() === name.toLowerCase());
      if (dup) return res.status(409).json({ error: 'That topic is already in this subject: ' + name });
      topic.name = name;
    }
    if (req.body && req.body.nameHi !== undefined) topic.nameHi = norm(req.body.nameHi);
    await doc.save();
    res.json({ ok: true, subject: doc });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/topics/:topicId', requireAdmin, async (req, res) => {
  if (!requireDb(res)) return;
  try {
    const doc = await Subject.findOne({ id: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Subject not found' });
    const before = doc.topics.length;
    doc.topics = doc.topics.filter(t => t.id !== req.params.topicId);
    if (doc.topics.length === before) return res.status(404).json({ error: 'Topic not found' });
    await doc.save();
    res.json({ ok: true, subject: doc, removed: req.params.topicId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;