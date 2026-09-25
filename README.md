# SuperTET Prep - flashcards + tests (PWA + Node/MongoDB)

A bilingual practice web app (Hindi + English) for SuperTET style multiple-choice questions. Works 100% offline via localStorage and Service Worker, with an **optional Node.js + MongoDB backend** for syncing test results and question banks across multiple devices.

* **Flashcards** - tap to flip, swipe right "I knew this", swipe left "review again" (Leitner boxes). Designed for a phone.
* **Test mode** - pick subjects, question count and timer; flag questions, auto-submit.
* **Practice mode** - instant answer and explanation.
* **Result page** - score, percentage, subject breakdown, weak topics, and answer review. Shareable result links work across devices.
* **Progress dashboard** - score trend sparkline, subject accuracy, day streak. Toggle between "This device" and "All students (MongoDB)".
* **Add questions in bulk** - upload `.xlsx`, `.csv` or `.json` (synced to MongoDB when connected).
* **Works offline** - PWA installs on phone; attempts are saved in localStorage and auto-flushed to MongoDB when reconnected.

---

## 1. Quick Start with Node.js & MongoDB (Recommended)

### Prerequisites
- Node.js 18+ (you already have Node v24 installed)
- MongoDB running locally (`mongodb://127.0.0.1:27017`) OR a free [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) cloud cluster

### Step 1: Install dependencies
```powershell
npm install
```

### Step 2: Configure environment
Copy `.env.example` to `.env`:
```powershell
cp .env.example .env
```
Default `.env`:
```ini
PORT=8080
MONGODB_URI=mongodb://127.0.0.1:27017/supertet-prep
```
*(If you use MongoDB Atlas, paste your `mongodb+srv://...` connection string into `MONGODB_URI`)*

### Step 3: Seed the initial question bank into MongoDB (optional)
```powershell
npm run seed
```

### Step 4: Start the server
```powershell
npm start
```
Then open <http://localhost:8080/>.

> **Offline tolerance:** If MongoDB is down or not running, the server still runs and serves the static site. The frontend automatically falls back to `localStorage` without crashing.

---

## 2. Running without Node (pure static mode)

If you just want the local static preview without the database:

```powershell
python -m http.server 8080
```
Then open <http://localhost:8080/>. (The routing bug `Cannot GET /pages/pages/test.html` is fixed and will no longer occur.)

---

## 3. Put it on GitHub Pages (so your wife can open it on her phone)

```powershell
cd supertet-prep
git init
git add .
git commit -m "SuperTET practice site"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then on GitHub: **Settings -> Pages -> Source: Deploy from a branch -> Branch: `main` / `(root)` -> Save**.

After a minute the site is live at:

```
https://<your-username>.github.io/<repo-name>/
```

Open that link on her phone, then use the browser menu -> **Add to Home screen**.
The site then behaves like an app and works offline.

> The `.gitignore` keeps the `books/` folder and all PDFs out of the repository, so you are
> not publishing the source material you are practising from.

---

## 3. Adding questions

### Option A - upload a file in the browser (easiest)

1. Open **Questions** in the site menu.
2. Click **Download Excel template** to get `questions-template.xlsx`.
3. Fill one row per question (see the column guide below), then drag the file back
   onto the page.
4. Check the preview table and error list, then press **Save to question bank**.

You can repeat this any time; questions with the same `id` are updated instead of duplicated.

### Option B - commit JSON into the repository

Put your file in `data/` (copy `data/gk-gs.json` as a starting point) and add its
file name to `data/index.json`:

```json
{ "files": ["gk-gs.json", "child.json", "my-new-subject.json"] }
```

Commit and push - every visitor loads it automatically. To convert an Excel file to
JSON on your computer:

```powershell
python tools\excel_to_json.py questions.xlsx --out data\my-new-subject.json
```

### Column guide (Excel / CSV)

| Column | Meaning |
|---|---|
| `id` | unique text. Leave blank and the app generates one. |
| `subject` | builds the test menu, e.g. `GK & GS`, `Science` |
| `topic` | smaller heading, e.g. `Important Days` (drives weak-topic analysis) |
| `difficulty` | `easy` / `medium` / `hard` (optional) |
| `q_hi` / `q_en` | question text in Hindi / English - fill at least one |
| `opt1_hi` ... `opt4_hi` | four options in Hindi |
| `opt1_en` ... `opt4_en` | four options in English (optional - Hindi is reused if blank) |
| `answer` | `A`, `B`, `C`, `D` (or `1`, `2`, `3`, `4`) |
| `expl_hi` / `expl_en` | optional explanation, shown after answering |
| `tags` | optional comma separated keywords |

Equivalent JSON shape:

```json
{
  "id": "gk-01",
  "subject": "GK & GS",
  "topic": "Important Days",
  "difficulty": "easy",
  "question": { "hi": "राष्ट्रीय युवा दिवस कब मनाया जाता है?", "en": "When is National Youth Day celebrated?" },
  "options": {
    "hi": ["10 जनवरी", "12 जनवरी", "15 जनवरी", "24 जनवरी"],
    "en": ["10 January", "12 January", "15 January", "24 January"]
  },

---

## 4. Turning the books into questions (optional)

`tools/pdf_to_json.py` reads the PDFs in `../books` and writes question JSON. It is a
**starting point, not a finished pipeline**: the PDFs use a legacy Hindi font, so some
words extract slightly wrong (for example `ववश्व` instead of `विश्व`), and in several books
the answer key is an image, so those answers must be typed in by hand.

```powershell
python tools\pdf_to_json.py "..\books\*.pdf" --out data\from-pdf.json --allow-missing-answers
```

* `--subject "Child Development"` overrides the subject name (otherwise it is taken from the file name).
* `--allow-missing-answers` still exports questions whose answer was not found (tagged `needs-answer`).
* `--fix` applies best-effort repairs for the most common font mistakes (verify the output!).

On the seven books in `../books` this produced 974 questions (all of them bilingual, 4
options each); about half still need their answers filled in because the answer key is an
image in those PDFs. Fix the wording and answers, then either split the file per subject
and list them in `data/index.json`, or just add `from-pdf.json` to that list.

---

## 5. Files in this project

```
index.html                 home page (bank summary, quick start)
pages/test.html            test setup + timed test
pages/result.html          result, review, share/print
pages/analytics.html       progress dashboard
pages/flashcards.html      flashcard drill
pages/manage.html          upload / export / delete questions
css/styles.css             all styling (light + dark, mobile first)
js/util.js                 helpers, base path, language mode, toast
js/store.js                localStorage: questions, attempts, settings, card boxes
js/data.js                 schema, validation, normalising, loader
js/importer.js             xlsx / csv / json reading (SheetJS from CDN)
js/analytics.js            statistics, trend, weak topics, report text
js/app.js                  shared header/nav/theme, service worker registration
js/home.js ... manage.js   one controller per page
data/index.json            list of seed data files
data/*.json                seeded questions (8 per subject to start with)
templates/questions-template.xlsx
tools/excel_to_json.py     Excel/CSV -> data/*.json
tools/pdf_to_json.py       PDF -> JSON (review the output)
tools/make_template.py     rebuilds the Excel template
tools/make_icons.py        rebuilds the PWA icons
tools/check.mjs            self-test for the data layer
sw.js, manifest.webmanifest, 404.html
```

## 6. Checks you can run

```powershell
node tools\check.mjs          # validates data files + schema/storage/analytics logic
python tools\make_template.py # rebuild the Excel template
python tools\make_icons.py    # rebuild the PWA icons
```

## 7. Language modes

The header has a language selector: **हिंदी + English** (both, default), **हिंदी**, and
**English**. It applies to question text, options and explanations; questions that only
exist in one language still work.

## 8. Notes and limitations

* Results and imported questions live in that browser only. Clearing browser data, or
  switching phone/browser, means starting fresh - use **Download full backup** on the
  Questions page before switching devices.
* Questions are text only; images inside questions are not supported.
* Hosting is static, so there is no central "see her results" view. Ask her to use
  **Share result** (WhatsApp), or export the history as CSV/JSON from the Progress page.
* `sw.js` caches files by version. After you change site files, bump `CACHE` in `sw.js`
  (for example `supertet-prep-v2`) so phones pick up the new version.

  "answer": "B",
  "explanation": { "hi": "12 जनवरी को स्वामी विवेकानंद का जन्मदिन है।", "en": "12 January is Swami Vivekananda's birthday." },
  "tags": ["days", "national"]
}
```
