/* ===========================================================
   importer.js - read .xlsx / .csv / .json question banks in the browser
   SheetJS is loaded from a CDN only when an Excel/CSV file is used.
   =========================================================== */

const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let _xlsxLoading = null;

export function loadSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_xlsxLoading) return _xlsxLoading;
  _xlsxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SHEETJS_URL;
    s.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('SheetJS failed to initialise'));
    s.onerror = () => reject(new Error('Could not load the Excel reader (no internet?)'));
    document.head.appendChild(s);
  });
  return _xlsxLoading;
}

export const SHEET_COLUMNS = [
  'id', 'subject', 'topic', 'difficulty',
  'q_hi', 'q_en',
  'opt1_hi', 'opt2_hi', 'opt3_hi', 'opt4_hi',
  'opt1_en', 'opt2_en', 'opt3_en', 'opt4_en',
  'answer', 'expl_hi', 'expl_en', 'tags',
];

/** Parse one uploaded file into an array of flat row objects. */
export async function parseFile(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.json')) return parseJsonText(await file.text(), file.name);
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    try {
      const XLSX = await loadSheetJS();
      const wb = XLSX.read(text, { type: 'string' });
      return sheetToRows(XLSX, wb);
    } catch (e) {
      return parseCsvText(text);
    }
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
    const XLSX = await loadSheetJS();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    return sheetToRows(XLSX, wb);
  }
  const text = await file.text();
  try { return parseJsonText(text, file.name); } catch (e) { return parseCsvText(text); }
}

function sheetToRows(XLSX, wb) {
  const rows = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    for (const r of json) rows.push(r);
  }
  return rows;
}

export function parseJsonText(text, fileName = 'upload.json') {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.questions)) return data.questions;
  if (data && typeof data === 'object') {
    const out = [];
    for (const k of Object.keys(data)) {
      if (Array.isArray(data[k])) data[k].forEach(q => out.push(Object.assign({ subject: k }, q)));
    }
    if (out.length) return out;
    return [data];
  }
  throw new Error('Unrecognised JSON in ' + fileName);
}

/* ---------------- minimal CSV reader (fallback, handles quotes) ---------------- */
export function parseCsvText(text) {
  const rows = [];
  let row = [], cell = '', inQuotes = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(v => String(v).trim() !== ''))
    .map(r => {
      const o = {};
      header.forEach((h, i) => { if (h) o[h] = r[i] == null ? '' : r[i]; });
      return o;
    });
}


/** Download a ready-to-fill Excel template. */
export async function downloadTemplate() {
  const XLSX = await loadSheetJS();
  const example = [
    {
      id: 'gk-101', subject: 'GK & GS', topic: 'Important Days', difficulty: 'easy',
      q_hi: 'राष्ट्रीय युवा दिवस कब मनाया जाता है?',
      q_en: 'When is National Youth Day celebrated?',
      opt1_hi: '10 जनवरी', opt2_hi: '12 जनवरी', opt3_hi: '15 जनवरी', opt4_hi: '24 जनवरी',
      opt1_en: '10 January', opt2_en: '12 January', opt3_en: '15 January', opt4_en: '24 January',
      answer: 'B', expl_hi: '12 जनवरी को स्वामी विवेकानंद का जन्मदिन है।',
      expl_en: '12 January is Swami Vivekananda birth anniversary.', tags: 'days,national',
    },
    {
      id: 'gk-102', subject: 'GK & GS', topic: 'Awards', difficulty: 'medium',
      q_hi: 'भारत का सर्वोच्च नागरिक पुरस्कार कौन-सा है?',
      q_en: 'Which is the highest civilian award of India?',
      opt1_hi: 'पद्म विभूषण', opt2_hi: 'भारत रत्न', opt3_hi: 'पद्म भूषण', opt4_hi: 'पद्म श्री',
      opt1_en: 'Padma Vibhushan', opt2_en: 'Bharat Ratna', opt3_en: 'Padma Bhushan', opt4_en: 'Padma Shri',
      answer: 'B', expl_hi: '', expl_en: '', tags: 'awards',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(example, { header: SHEET_COLUMNS });
  ws['!cols'] = SHEET_COLUMNS.map(c => ({ wch: c.startsWith('q_') || c.startsWith('expl') ? 42 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'questions');
  XLSX.writeFile(wb, 'questions-template.xlsx');
}

/** Convert canonical questions back to flat rows (for Excel export). */
export function questionsToRows(questions) {
  return (questions || []).map(q => ({
    id: q.id,
    subject: q.subject,
    topic: q.topic,
    difficulty: q.difficulty,
    q_hi: q.question.hi || '',
    q_en: q.question.en || '',
    opt1_hi: q.options.hi[0] || '', opt2_hi: q.options.hi[1] || '',
    opt3_hi: q.options.hi[2] || '', opt4_hi: q.options.hi[3] || '',
    opt1_en: q.options.en[0] || '', opt2_en: q.options.en[1] || '',
    opt3_en: q.options.en[2] || '', opt4_en: q.options.en[3] || '',
    answer: q.answerLetter || '',
    expl_hi: q.explanation.hi || '',
    expl_en: q.explanation.en || '',
    tags: (q.tags || []).join(','),
  }));
}

export async function exportQuestionsXlsx(questions, fileName = 'question-bank.xlsx') {
  const XLSX = await loadSheetJS();
  const ws = XLSX.utils.json_to_sheet(questionsToRows(questions), { header: SHEET_COLUMNS });
  ws['!cols'] = SHEET_COLUMNS.map(c => ({ wch: c.startsWith('q_') || c.startsWith('expl') ? 42 : 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'questions');
  XLSX.writeFile(wb, fileName);
}
