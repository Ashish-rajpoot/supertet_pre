/* ===========================================================
   analytics.js - aggregate attempts into stats, trends, weak topics
   =========================================================== */

import { pct } from './util.js';
import { getAttempts } from './store.js';

export function summary(attempts = getAttempts()) {
  if (!attempts.length) {
    return { attempts: 0, avgScore: 0, bestScore: 0, accuracy: 0, totalQ: 0, totalTime: 0, streakDays: 0 };
  }
  const avgScore = Math.round(attempts.reduce((a, x) => a + x.percent, 0) / attempts.length);
  const bestScore = Math.max.apply(null, attempts.map(x => x.percent));
  const totalCorrect = attempts.reduce((a, x) => a + x.correct, 0);
  const totalQ = attempts.reduce((a, x) => a + x.total, 0);
  return {
    attempts: attempts.length,
    avgScore,
    bestScore,
    accuracy: pct(totalCorrect, totalQ),
    totalQ,
    totalTime: attempts.reduce((a, x) => a + (x.timeTaken || 0), 0),
    streakDays: streak(attempts),
  };
}

/** Consecutive days (ending today or yesterday) with at least one attempt. */
export function streak(attempts = getAttempts()) {
  if (!attempts.length) return 0;
  const days = new Set(attempts.map(a => new Date(a.at).toDateString()));
  let count = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) { count++; d.setDate(d.getDate() - 1); }
  return count;
}

/** Score trend: oldest -> newest, for the sparkline. */
export function trend(attempts = getAttempts(), limit = 30) {
  return attempts.slice(-limit).map(a => ({
    at: a.at, percent: a.percent, label: a.label || 'Test',
  }));
}

/** Group questions/results by subject and topic using attempt details. */
export function breakdown(attempts = getAttempts()) {
  const bySubject = new Map();
  const byTopic = new Map();
  for (const a of attempts) {
    for (const d of (a.details || [])) {
      const bump = (map, key) => {
        if (!map.has(key)) map.set(key, { key, total: 0, correct: 0, wrong: 0, skipped: 0 });
        return map.get(key);
      };
      const s = bump(bySubject, d.subject || 'General');
      const t = bump(byTopic, (d.subject || 'General') + ' / ' + (d.topic || 'General'));
      for (const row of [s, t]) {
        row.total++;
        if (d.status === 'correct') row.correct++;
        else if (d.status === 'wrong') row.wrong++;
        else row.skipped++;
      }
    }
  }
  const finish = m => Array.from(m.values())
    .map(r => Object.assign(r, { accuracy: pct(r.correct, r.total) }))
    .sort((a, b) => a.accuracy - b.accuracy);
  return { subjects: finish(bySubject), topics: finish(byTopic) };
}

/** Topics with the lowest accuracy (min 3 attempts on the topic). */
export function weakTopics(attempts = getAttempts(), minAsked = 3, limit = 5) {
  return breakdown(attempts).topics
    .filter(t => t.total >= minAsked)
    .slice(0, limit);
}

/** Difficulty performance. */
export function byDifficulty(attempts = getAttempts()) {
  const m = new Map();
  for (const a of attempts) {
    for (const d of (a.details || [])) {
      const k = d.difficulty || 'medium';
      if (!m.has(k)) m.set(k, { key: k, total: 0, correct: 0 });
      const r = m.get(k);
      r.total++; if (d.status === 'correct') r.correct++;
    }
  }
  return Array.from(m.values()).map(r => Object.assign(r, { accuracy: pct(r.correct, r.total) }));
}

/** Simple inline SVG line chart from a numeric series. */
export function sparkline(values, { width = 320, height = 90 } = {}) {
  if (!values || !values.length) return '<p class="muted small">No data yet.</p>';
  const max = 100, min = 0;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const y = v => height - ((v - min) / (max - min)) * (height - 12) - 6;
  const pts = values.map((v, i) => (i * stepX) + ',' + y(v));
  const area = '0,' + height + ' ' + pts.join(' ') + ' ' + ((values.length - 1) * stepX) + ',' + height;
  const last = values[values.length - 1];
  return '<svg class="spark" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-label="score trend">' +
    '<polyline fill="none" stroke="var(--brand)" stroke-width="2.5" points="' + pts.join(' ') + '"/>' +
    '<polygon fill="var(--brand-soft)" opacity="0.85" points="' + area + '"/>' +
    '<circle cx="' + ((values.length - 1) * stepX) + '" cy="' + y(last) + '" r="3.5" fill="var(--brand)"/>' +
    '</svg>';
}

/** Build the downloadable "report card" text for sharing. */
export function reportText(attempt) {
  const lines = [];
  lines.push('*' + (attempt.label || 'Test') + ' - Result*');
  lines.push('Score: ' + attempt.score + '/' + attempt.total + ' (' + attempt.percent + '%)');
  lines.push('Correct: ' + attempt.correct + '  Wrong: ' + attempt.wrong + '  Skipped: ' + attempt.skipped);
  lines.push('Time: ' + Math.floor((attempt.timeTaken || 0) / 60) + 'm ' + ((attempt.timeTaken || 0) % 60) + 's');
  if (attempt.breakdown && attempt.breakdown.length) {
    lines.push('');
    lines.push('*Subject-wise:*');
    attempt.breakdown.forEach(b => lines.push('• ' + b.subject + ': ' + b.correct + '/' + b.total + ' (' + b.accuracy + '%)'));
  }
  const weak = (attempt.weakTopics || []).slice(0, 5);
  if (weak.length) {
    lines.push('');
    lines.push('*Need revision:*');
    weak.forEach(t => lines.push('• ' + t.topic + ' - ' + t.accuracy + '%'));
  }
  return lines.join('\n');
}
