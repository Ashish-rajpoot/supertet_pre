# AI question-writing prompt

Need questions for your test bank? You do not have to type them one by one. Copy the prompt below, paste it into **any** LLM - ChatGPT, Claude, Gemini, Copilot, DeepSeek, Grok, a local Ollama model - and the model will reply with a JSON array in the exact column layout this website imports. The answer-key, the question text in the medium you choose (Hindi, English or both) and explanations are all included.

The same prompt is also shown **right inside the app**: open the **Questions** page (admin or an allowed account) and you will find it directly under the *Add questions in bulk* card - the placeholders are filled in live from the *How many questions / Subject / Topic / Difficulty / Medium* fields, so just press **Copy AI prompt** and paste it into your LLM.

The **Subject** and **Topic** fields are searchable dropdowns (a combobox you can type in) built from the syllabus in `data/subjects.json` - or from the subjects the admin published on the **Subjects** page when the backend is running. Typing filters the list and searching also matches the Hindi names, so `विज्ञान` finds *Science*. Picking a suggestion copies that exact subject/topic name into the prompt, which is what makes the AI write questions for the chapter you actually want; typing a name that is not in the syllabus still works.

## Placeholders

Replace these five slots before pasting, or let the app do it for you:

| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `{{N}}` | How many questions to write | `20` |
| `{{SUBJECT}}` | Subject / paper of the test menu | `GK & GS` |
| `{{TOPIC}}` | Chapter or topic inside the subject | `Important Days` |
| `{{DIFFICULTY}}` | `easy`, `medium` or `hard` | `medium` |
| `{{MEDIUM}}` | Language medium: `Hindi` (default), `English` or `Hindi + English` | `Hindi` |

## The prompt

Paste everything inside the box:

```text
You write exam questions for "SuperTET Prep", a bilingual (Hindi + English) practice-test website for SuperTET / TET style teacher-eligibility exams.

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

Now output the JSON array with exactly {{N}} questions for {{SUBJECT}} / {{TOPIC}} (medium: {{MEDIUM}}). Remember: only the JSON array, nothing else.
```


### Filled-in example

If you replace the slots with `{{N}} = 5`, `{{SUBJECT}} = GK & GS`, `{{TOPIC}} = Important Days`, `{{DIFFICULTY}} = medium`, `{{MEDIUM}} = Hindi + English`, the model should answer with a bare JSON array like:

```json
[
  {
    "id": "gk-001",
    "subject": "GK & GS",
    "topic": "Important Days",
    "difficulty": "medium",
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
```

...with `5` questions in total. If the model wraps the reply in \`\`\`json fences or adds commentary, delete that text - only the `[ ... ]` array is imported.

## Bring the questions into the site

You need permission on the **Questions** page first (admin, or an account the admin allowed to add questions). Then pick one way:

1. **Paste** - copy the whole JSON array from the chat and drop it into the *Or paste JSON / CSV text* box on the Questions page, then press **Load pasted text**.
2. **JSON file** - save the array as `questions.json` and press **Choose JSON**.
3. **Excel / CSV file** - the keys above are the exact column names of the downloadable Excel template (`templates/questions-template.xlsx`), so you can paste the array into that sheet (one key per column, one object per row) or save it as CSV and press **Choose Excel / CSV**.

Either way you get a **preview** first: valid rows are counted, problems are listed per row, and nothing is saved until you press *Save to question bank*.

## Tips

- Ask for batches of 10-30 questions; long batches drift off-topic or repeat.
- For a Hindi-medium or English-medium batch the other language's columns come back as empty strings `""` - that is correct and imports fine; the site then shows only the filled language.
- Always spot-check facts and the answer key - LLMs can be confidently wrong.
- The site rejects rows with no question, no options or a missing/invalid answer (`A`-`D` or `1`-`4`); fix those rows and paste again - the preview tells you exactly which row failed.
- Want a different flavour? Add one line to the prompt, e.g. *"Make every question from the previous year's exam papers"* or *"Focus on child pedagogy and learning theories"*.
- Duplicate `id` values are fine - re-importing the same file updates the questions instead of adding them twice.

## File map

- Prompt source (used by the Questions page): `js/ai-prompt.js`
- This guide: `AI-QUESTION-PROMPT.md`
- Excel template generator: `tools/make_template.py`
- Column guide: `README.md` section 3 ("Adding questions")
