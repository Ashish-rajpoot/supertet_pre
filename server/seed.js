import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, isDbConnected } from './db.js';
import { Question } from './models/Question.js';
import { normaliseRow } from '../js/data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function seed() {
  const connected = await connectDB();
  if (!connected) {
    console.error('[seed] Cannot seed because MongoDB is not connected.');
    process.exit(1);
  }

  const idxPath = path.join(ROOT, 'data/index.json');
  if (!fs.existsSync(idxPath)) {
    console.error('[seed] data/index.json not found');
    process.exit(1);
  }

  const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
  const files = idx.files || [];
  let total = 0;

  for (const f of files) {
    const filePath = path.join(ROOT, 'data', f);
    if (!fs.existsSync(filePath)) continue;
    const rows = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const ops = [];
    (rows || []).forEach((row, i) => {
      const { q } = normaliseRow(Object.assign({ source: 'seed' }, row), i + 1);
      if (q && q.answerIndex >= 0) {
        ops.push({
          updateOne: {
            filter: { id: String(q.id) },
            update: { $set: q },
            upsert: true,
          },
        });
      }
    });
    if (ops.length) {
      const res = await Question.bulkWrite(ops);
      console.log(`[seed] ${f}: ${ops.length} questions processed (${res.upsertedCount} new, ${res.modifiedCount} updated)`);
      total += ops.length;
    }
  }

  console.log(`[seed] Done! Total questions processed: ${total}`);
  process.exit(0);
}

seed().catch(err => {
  console.error('[seed] Error:', err);
  process.exit(1);
});
