/* ===========================================================
   seed-subjects.js - loads the bundled syllabus (data/subjects.json)
   into MongoDB.

   Merge semantics, never overwrite: a subject or topic the admin added
   or renamed by hand survives re-running `npm run seed`; only what is
   missing gets inserted. That makes the seeder safe to run any time.
   =========================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDbConnected } from './db.js';
import { Subject, slugify } from './models/Subject.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const norm = (s) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ');

/** Read data/subjects.json from disk. Returns [] when the file is absent. */
export function loadSyllabus(root = ROOT) {
  const file = path.join(root, 'data', 'subjects.json');
  if (!fs.existsSync(file)) return [];
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('data/subjects.json must be an array of subjects');
  return parsed;
}

/**
 * Upsert the syllabus. Returns { subjects, topics, created } where
 * `subjects`/`topics` count the rows that were actually inserted.
 */
export async function seedSubjects(list = loadSyllabus()) {
  if (!isDbConnected()) {
    console.warn('[seed] Subjects skipped - MongoDB is not connected.');
    return { subjects: 0, topics: 0, created: 0 };
  }

  const existing = await Subject.find({}).lean();
  const byName = new Map(existing.map(s => [s.name.toLowerCase(), s]));
  const usedIds = new Set(existing.map(s => s.id));

  let subjects = 0;
  let topics = 0;
  let order = 0;

  for (const raw of list) {
    const name = norm(raw && raw.name);
    if (!name) continue;
    order++;

    let doc = byName.get(name.toLowerCase());
    const seedTopics = (Array.isArray(raw.topics) ? raw.topics : [])
      .map(t => ({ name: norm(t && t.name), nameHi: norm(t && t.nameHi) }))
      .filter(t => t.name);

    if (!doc) {
      let id = slugify(name);
      for (let i = 2; usedIds.has(id); i++) id = slugify(name) + '-' + i;
      usedIds.add(id);
      const taken = new Set();
      const embedded = seedTopics.map(t => {
        const topicId = id + '--' + slugify(t.name);
        const unique = taken.has(topicId) ? topicId + '-' + (taken.size + 1) : topicId;
        taken.add(unique);
        topics++;
        return { id: unique, name: t.name, nameHi: t.nameHi };
      });
      const created = await Subject.create({
        id,
        name,
        nameHi: norm(raw.nameHi),
        topics: embedded,
        order,
        createdBy: 'seed',
      });
      byName.set(name.toLowerCase(), created.toObject());
      subjects++;
      continue;
    }

    // Existing subject: fill in blanks, append the topics it is missing.
    const updates = {};
    if (!norm(doc.nameHi) && norm(raw.nameHi)) updates.nameHi = norm(raw.nameHi);
    if (doc.order == null) updates.order = order;
    if (!doc.id) {
      let id = slugify(name);
      for (let i = 2; usedIds.has(id); i++) id = slugify(name) + '-' + i;
      usedIds.add(id);
      updates.id = id;
    }

    const have = new Set((doc.topics || []).map(t => t.name.toLowerCase()));
    const missing = seedTopics.filter(t => !have.has(t.name.toLowerCase()));
    const push = {};
    if (missing.length) {
      const taken = new Set((doc.topics || []).map(t => t.id));
      push.$push = {
        $each: missing.map(t => {
          const base = (updates.id || doc.id) + '--' + slugify(t.name);
          let topicId = base;
          for (let i = 2; taken.has(topicId); i++) topicId = base + '-' + i;
          taken.add(topicId);
          topics++;
          return { id: topicId, name: t.name, nameHi: t.nameHi };
        }),
      };
    }

    const set = Object.assign({}, updates);
    const op = {};
    if (Object.keys(set).length) op.$set = set;
    if (push.$push) op.$push = push.$push;
    if (Object.keys(op).length) {
      await Subject.updateOne({ _id: doc._id }, op);
    }
  }

  return { subjects, topics, created: subjects + topics };
}