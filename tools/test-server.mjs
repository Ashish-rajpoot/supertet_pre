import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { start } from '../server/index.js';

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log('  PASS  ' + name);
  else { failures++; console.error('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
};

console.log('\n=== SuperTET Server & MongoDB Integration Tests ===\n');

let mongod, server;
const PORT = 4567;
const BASE = `http://localhost:${PORT}`;

try {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  server = await start(PORT, uri);

  // Status endpoint
  const statusRes = await fetch(`${BASE}/api/status`);
  const statusData = await statusRes.json();
  ok('status returns ok: true', statusData.ok === true);
  ok('mongoConnected is true', statusData.mongoConnected === true);

  // Static files (verifies fix for Cannot GET /pages/pages/test.html)
  ok('/ serves 200', (await fetch(`${BASE}/`)).status === 200);
  ok('/pages/test.html serves 200', (await fetch(`${BASE}/pages/test.html`)).status === 200);
  for (const p of ['flashcards', 'analytics', 'manage', 'result']) {
    ok(`/pages/${p}.html serves 200`, (await fetch(`${BASE}/pages/${p}.html`)).status === 200);
  }

  // Attempts CRUD
  const testAttempt = {
    id: 'test-attempt-1', student: 'Aarav', at: Date.now(), finishedAt: Date.now() + 60000,
    mode: 'test', label: 'GK Test', subjects: ['GK & GS'],
    total: 10, correct: 8, wrong: 2, skipped: 0, score: 8, percent: 80, timeTaken: 120,
    breakdown: [{ subject: 'GK & GS', total: 10, correct: 8, accuracy: 80 }],
    weakTopics: [],
    details: [{ id: 'q1', subject: 'GK & GS', topic: 'Days', question: { hi: 'प्रशन?', en: 'Q?' }, options: { hi: ['A'], en: ['A'] }, answerIndex: 0, status: 'correct' }],
  };

  const postAttemptRes = await fetch(`${BASE}/api/attempts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(testAttempt),
  });
  ok('POST /api/attempts returns 201', postAttemptRes.status === 201);

  const listData = await (await fetch(`${BASE}/api/attempts`)).json();
  ok('GET /api/attempts lists 1 attempt', listData.attempts?.length === 1);
  ok('Attempt student is Aarav', listData.attempts[0]?.student === 'Aarav');

  const getOneData = await (await fetch(`${BASE}/api/attempts/test-attempt-1`)).json();
  ok('GET /api/attempts/:id returns full details', getOneData.details?.length === 1);

  // Questions CRUD
  const sampleQ = [{
    id: 'srv-q1', subject: 'Science', topic: 'Body', difficulty: 'easy',
    question: { hi: 'हड्डियाँ?', en: 'Bones?' }, options: { hi: ['206'], en: ['206'] },
    answerIndex: 0, answerLetter: 'A',
  }];
  const postQRes = await fetch(`${BASE}/api/questions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sampleQ),
  });
  ok('POST /api/questions returns 201', postQRes.status === 201);

  const getQData = await (await fetch(`${BASE}/api/questions?subject=Science`)).json();
  ok('GET /api/questions returns 1 question', getQData.count === 1);

  ok('DELETE /api/questions/:id returns 200', (await fetch(`${BASE}/api/questions/srv-q1`, { method: 'DELETE' })).status === 200);
  ok('DELETE /api/attempts/:id returns 200', (await fetch(`${BASE}/api/attempts/test-attempt-1`, { method: 'DELETE' })).status === 200);

} catch (err) {
  failures++;
  console.error('Test crashed:', err);
} finally {
  if (server) await new Promise(r => server.close(r));
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (mongod) await mongod.stop();
}

console.log('\n' + (failures ? `FAILED: ${failures}` : 'ALL SERVER & MONGODB TESTS PASSED!'));
process.exit(failures ? 1 : 0);
