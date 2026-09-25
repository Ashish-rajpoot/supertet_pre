/* ===========================================================
   ai-prompt.js - the reusable "write the questions for me" prompt

   The user copies this prompt, pastes it into any LLM (ChatGPT,
   Claude, Gemini, ...), and the model replies with a JSON array in
   the exact flat column layout the Questions page accepts:

     id, subject, topic, difficulty, q_hi, q_en,
     opt1_hi..opt4_hi, opt1_en..opt4_en,
     answer, expl_hi, expl_en, tags

   AI-QUESTION-PROMPT.md (project root) is the human-readable copy
   of the same prompt with {{PLACEHOLDER}} slots. Keep both in sync.
   =========================================================== */

/** Raw prompt with {{N}}, {{SUBJECT}}, {{TOPIC}} and {{DIFFICULTY}} slots. */
export const AI_PROMPT_TEMPLATE = `You write exam questions for "SuperTET Prep", a bilingual (Hindi + English) practice-test website for SuperTET / TET style teacher-eligibility exams.

TASK
Create exactly {{N}} new multiple-choice questions.
- Subject: {{SUBJECT}}
- Topic: {{TOPIC}} (if that is broad, cover several sub-topics inside it)
- Difficulty: {{DIFFICULTY}} (must be one of: easy, medium, hard)
- Medium: {{MEDIUM}}

MEDIUM RULES (which language columns to fill)
The Medium value in TASK tells you which rule applies:
- If Medium is "Hindi" (Hindi medium): write the real content - question, four options and explanation - in natural Devanagari Hindi into q_hi, opt1_hi..opt4_hi and expl_hi. Set q_en, opt1_en..opt4_en and expl_en to empty strings "" and do NOT translate.
- If Medium is "English" (English medium): write the real content into q_en, opt1_en..opt4_en and expl_en. Set q_hi, opt1_hi..opt4_hi and expl_hi to empty strings "".
- If Medium is "Hindi + English": fill BOTH language columns with the same meaning, like the example below.

OUTPUT FORMAT
Reply with ONE JSON array and nothing else: no introduction, no commentary, no markdown code fences, no trailing notes. Every array element is one flat object with exactly these keys, in this order:

id, subject, topic, difficulty, q_hi, q_en, opt1_hi, opt2_hi, opt3_hi, opt4_hi, opt1_en, opt2_en, opt3_en, opt4_en, answer, expl_hi, expl_en, tags

FIELD RULES
- id: unique inside the array; only lowercase letters, digits and hyphens. For subject "Science" use science-001, science-002, ...
- subject and topic: copy the Subject and Topic values above verbatim into every row.
- difficulty: "easy", "medium" or "hard" only.
- q_hi / q_en: the question text, filled exactly as MEDIUM RULES demands (empty string "" for the language not used). Each filled field at most 200 characters.
- opt1..opt4 (hi and en): exactly four options, in the same order in both columns when both are used, plausible and similar in length. Never use "all of the above", "none of the above" or "both A and B".
- answer: only the letter of the correct option - "A", "B", "C" or "D" - matching its position (opt1 = A, opt2 = B, opt3 = C, opt4 = D). Exactly one option is correct. Spread the correct letters roughly evenly across the batch.
- expl_hi / expl_en: a 1-2 sentence explanation, in the language(s) required by MEDIUM RULES, saying WHY the answer is correct.
- tags: 2-4 lowercase keywords separated by commas, e.g. "important days, national".

QUALITY RULES
1. Factually correct and unambiguous - no opinions, no trick wording.
2. Self-contained: a 12-year-old can answer from the question text alone.
3. No duplicate questions inside the batch.
4. Whenever Hindi is used it must be natural Devanagari, not transliterated English.
5. When both languages are filled, dates, numbers and proper nouns must match between the Hindi and English versions.

EXAMPLE (the exact shape - do not copy the content)
[
  {
    "id": "gk-001",
    "subject": "{{SUBJECT}}",
    "topic": "{{TOPIC}}",
    "difficulty": "{{DIFFICULTY}}",
    "q_hi": "राष्ट्रीय युवा दिवस कब मनाया जाता है?",
    "q_en": "When is National Youth Day celebrated?",
    "opt1_hi": "10 जनवरी",
    "opt2_hi": "12 जनवरी",
    "opt3_hi": "15 जनवरी",
    "opt4_hi": "24 जनवरी",
    "opt1_en": "10 January",
    "opt2_en": "12 January",
    "opt3_en": "15 January",
    "opt4_en": "24 January",
    "answer": "B",
    "expl_hi": "12 जनवरी को स्वामी विवेकानंद का जन्मदिन है।",
    "expl_en": "12 January is Swami Vivekananda's birth anniversary.",
    "tags": "important days, national"
  }
]

The example shows the bilingual medium; for "Hindi" or "English" medium fill only the columns named in MEDIUM RULES and leave the others as empty strings "".

Now output the JSON array with exactly {{N}} questions for {{SUBJECT}} / {{TOPIC}} (medium: {{MEDIUM}}). Remember: only the JSON array, nothing else.`;

/** Every placeholder the raw template understands. */
export const AI_PROMPT_PLACEHOLDERS = ['{{N}}', '{{SUBJECT}}', '{{TOPIC}}', '{{DIFFICULTY}}', '{{MEDIUM}}'];

/** Fill the prompt with the user's choices (blank values fall back to safe defaults).
 *  medium: "Hindi" (default) | "English" | "Hindi + English". */
export function buildAiPrompt({ count, subject = '', topic = '', difficulty = '', medium = '' } = {}) {
  let n = parseInt(count, 10);
  if (!Number.isFinite(n)) n = 20;
  n = Math.max(1, Math.min(200, n));

  const sub = String(subject).trim() || 'General';
  const top = String(topic).trim() || 'Mixed';
  const diff = ['easy', 'medium', 'hard'].includes(String(difficulty).trim().toLowerCase())
    ? String(difficulty).trim().toLowerCase()
    : 'medium';
  const med = ['Hindi', 'English', 'Hindi + English'].includes(String(medium).trim())
    ? String(medium).trim()
    : 'Hindi';

  return AI_PROMPT_TEMPLATE
    .split('{{N}}').join(String(n))
    .split('{{SUBJECT}}').join(sub)
    .split('{{TOPIC}}').join(top)
    .split('{{DIFFICULTY}}').join(diff)
    .split('{{MEDIUM}}').join(med);
}

/* ===========================================================
   Suggestions for the Subject / Topic search boxes of the
   "Or let an AI write the questions for you" card.

   Picking a real syllabus subject and topic is what makes the copied
   prompt precise, so the lists combine the syllabus with whatever the
   question bank already holds. Both helpers are pure (no DOM) and
   return [{ value, label, sub }] for js/combo.js.
   =========================================================== */

/** Push a choice once, ignoring blanks and case-insensitive duplicates. */
function pushChoice(out, seen, value, sub) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return;
  const key = v.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push({ value: v, label: v, sub: String(sub == null ? '' : sub).trim() });
}

/**
 * Subject choices: every syllabus subject first (with its Hindi name as the
 * hint), then subjects that only exist in the question bank.
 */
export function buildSubjectChoices(syllabus = [], bankSubjects = []) {
  const out = [];
  const seen = new Set();
  (syllabus || []).forEach((s) => {
    if (!s) return;
    pushChoice(out, seen, s.name, s.nameHi || '');
  });
  (bankSubjects || []).forEach(name => pushChoice(out, seen, name, 'already in your bank'));
  return out;
}

/**
 * Topic choices for `subject` (all topics when it is blank).
 *
 * @param {Array} syllabus   [{ name, nameHi, topics: [{ name, nameHi }] }]
 * @param {Array} bankTopics [{ subject, topic }] pairs already used in the bank
 * @param {string} subject   the subject typed in the Subject box ('' = every subject)
 */
export function buildTopicChoices(syllabus = [], bankTopics = [], subject = '') {
  const want = String(subject == null ? '' : subject).trim().toLowerCase();
  const out = [];
  const seen = new Set();

  (syllabus || []).forEach((s) => {
    if (!s) return;
    const sName = String(s.name || '').trim();
    if (want && sName.toLowerCase() !== want) return;
    (s.topics || []).forEach((t) => {
      if (!t) return;
      const hi = String(t.nameHi || '').trim();
      // With no subject chosen the subject name is the hint, so the topic stays identifiable.
      const hint = want ? hi : [hi, sName].filter(Boolean).join(' \u00b7 ');
      pushChoice(out, seen, t.name, hint);
    });
  });

  const bankSeen = new Set();
  (bankTopics || []).forEach((row) => {
    if (!row) return;
    const sName = String(row.subject == null ? '' : row.subject).trim().toLowerCase();
    if (want && sName !== want) return;
    const topic = String(row.topic == null ? '' : row.topic).trim();
    if (!topic) return;
    const key = topic.toLowerCase();
    if (bankSeen.has(key)) return;
    bankSeen.add(key);
    pushChoice(out, seen, topic, 'already in your bank');
  });

  return out;
}
