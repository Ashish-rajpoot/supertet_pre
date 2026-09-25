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
JWT_SECRET=change-me-to-a-long-random-string
MONGODB_URI=mongodb://127.0.0.1:27017/supertet-prep
ADMIN_EMAILS=you@example.com
```
*(If you use MongoDB Atlas, paste your `mongodb+srv://...` connection string into `MONGODB_URI`)*
`JWT_SECRET` signs the login tokens; keep it private and change it if tokens ever leak.
`ADMIN_EMAILS` is the list of accounts that become the admin (see section 9).

> **Default admin:** on every start (and on `npm run seed`) the server makes sure a default
> admin exists: **`admin@gmail.com` / `admin@123`**. It is created with `role: "admin"` and
> `canAddQuestions: true`, so you can sign in and use the site immediately. Override the
> credentials with `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, and **change the password
> before going to production** (this credential is public in the README).

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

### Option C - let an AI write the questions for you

1. Open **Questions** (you need add permission), fill **How many questions / Subject / Topic /
   Difficulty / Medium** in the *Or let an AI write the questions for you* card and press **Copy AI prompt**.
2. Paste the prompt into any LLM - ChatGPT, Claude, Gemini, Copilot, a local model - and it replies
   with a JSON array in the exact column layout below (answer key + text in the chosen medium + explanations).
3. Paste that array into the *Or paste JSON / CSV text* box on the same page and press
   **Load pasted text**, then check the preview and save.

The prompt itself (with `{{N}}`, `{{SUBJECT}}`, `{{TOPIC}}`, `{{DIFFICULTY}}` and `{{MEDIUM}}`
placeholders - medium defaults to Hindi medium - plus field rules and a filled example) lives in
[`AI-QUESTION-PROMPT.md`](AI-QUESTION-PROMPT.md) - copy it
from there if you prefer not to use the button.

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
AI-QUESTION-PROMPT.md      ready-made LLM prompt that writes questions in the site's format
pages/test.html            test setup + timed test
pages/result.html          result, review, share/print
pages/analytics.html       progress dashboard
pages/flashcards.html      flashcard drill
pages/manage.html          upload / export / delete questions + admin permission panel
pages/profile.html         profile: edit own details (identity fields locked)
css/styles.css             all styling (light + dark, mobile first)
js/util.js                 helpers, base path, language mode, toast
js/store.js                localStorage: questions, attempts, settings, card boxes
js/data.js                 schema, validation, normalising, loader
js/importer.js             xlsx / csv / json reading (SheetJS from CDN)
js/analytics.js            statistics, trend, weak topics, report text
js/ai-prompt.js            builds the copy-able "write the questions" LLM prompt ({{N}}, {{SUBJECT}}, ...)
js/app.js                  shared header/nav/theme, auth dialog + user chip, service worker registration
js/auth.js                 sign in / sign up / OTP calls, session in localStorage (stp.auth)
js/profile.js              profile page: editable details + change password
js/home.js ... manage.js   one controller per page
server/index.js            Express server + static hosting
server/bootstrap-admin.js  creates the default admin (admin@gmail.com / ADMIN_PASSWORD) at boot
server/models/User.js      account, role, canAddQuestions, profile details
server/routes/auth.js      /api/auth/* (register, verify-otp, resend-otp, login, google, me,
                           profile, change-password, users, users/:id)
server/routes/attempts.js  /api/attempts/* scoped to the signed-in user (admin can see all)
server/routes/questions.js /api/questions/* writes gated by requireQuestionEditor
server/routes/analytics.js /api/analytics/users - user-wise report (admin only)
server/auth-util.js        scrypt password hashing + JWT sign/verify + role middleware (node:crypto only)
data/index.json            list of seed data files
data/*.json                seeded questions (8 per subject to start with)
templates/questions-template.xlsx
tools/excel_to_json.py     Excel/CSV -> data/*.json
tools/pdf_to_json.py       PDF -> JSON (review the output)
tools/make_template.py     rebuilds the Excel template
tools/make_icons.py        rebuilds the PWA icons
tools/check.mjs            self-test for the data layer
tools/test-server.mjs      integration test: API + MongoDB + client auth module
sw.js, manifest.webmanifest, 404.html
```

## 6. Checks you can run

```powershell
node tools\check.mjs          # validates data files + schema/storage/analytics logic
node tools\test-server.mjs    # spins up MongoDB in memory: API routes, auth/OTP, permissions
npm test                      # same as tools\check.mjs
npm run test:server           # same as tools\test-server.mjs
python tools\make_template.py # rebuild the Excel template
python tools\make_icons.py    # rebuild the PWA icons
```

## 7. Language modes

The header has a language selector: **हिंदी + English** (both, default), **हिंदी**, and
**English**. It applies to question text, options and explanations; questions that only
exist in one language still work.

## 8. Accounts and sign-in (Google + OTP)

An account is optional - everything still works with local storage only. The top bar shows
**Login**; after signing in it shows the student's avatar/initials and **Log out**.

* **User ID / email / phone + password** - `POST /api/auth/register` creates the account and
  sends a 6-digit OTP (valid 10 minutes, stored in MongoDB with a TTL index).
  `POST /api/auth/verify-otp` activates the account and returns a login token;
  `POST /api/auth/resend-otp` issues a fresh code. Logging in with an unverified account
  answers `403` with `needsOtp: true`, and the dialog moves straight to the OTP step.
* **Google Sign-In** - `POST /api/auth/google` verifies the Google ID token against
  `https://oauth2.googleapis.com/tokeninfo` and creates/logs in the matching account
  (accounts are linked by Google id or email, so an OTP account can later use Google too).
  Setup:
  1. Google Cloud Console -> **APIs & Services -> Credentials -> Create OAuth client ID -> Web application**.
  2. **Authorised JavaScript origins**: `http://localhost:8080` and your real site URL
     (for GitHub Pages: `https://<user>.github.io`).
  3. Add the client id to the app once (browser console on the site, or in settings):
     ```js
     saveSettings({ googleClientId: '1234567890-xxxxxxxx.apps.googleusercontent.com' })
     ```
  The dialog then renders Google's official button. Without a client id it explains that the
  id is missing instead of failing silently.
* Sessions are stored in `localStorage` under `stp.auth` (signed JWT). `GET /api/auth/me`
  re-checks the session on every page load, and the cached profile keeps working offline.
* Accounts need MongoDB. If the database is down the rest of the app still works and the auth
  endpoints answer `503` with a readable message.
* OTP delivery: no SMTP/SMS provider is configured yet, so the code is printed in the server
  console and returned as `devOtp` (which the dialog prefills in demo mode). Wire up a
  provider in `server/routes/auth.js` (`dispatchOtp`) and stop returning `devOtp` before
  going live.

## 9. Profile page, admin and permissions

### Who is the admin

**The seeded default admin (works out of the box):**

```text
email:    admin@gmail.com
password: admin@123
```

`server/bootstrap-admin.js` creates this account on server start and on `npm run seed`
(`role: "admin"`, `canAddQuestions: true`, verified). Set `ADMIN_EMAIL` / `ADMIN_PASSWORD`
in `.env` to change it, and **change the password before production** - the defaults above
are public. An existing account with that email is only *repaired* (role/flags), never
given a new password, so once you change the password it stays changed.

You can also promote your own accounts: put the email in `.env` and it becomes
`role: "admin"` the next time that account signs in or opens a page:

```ini
ADMIN_EMAILS=you@example.com,other-admin@example.com
```

The top bar then shows an **Admin** badge next to your name. A promoted admin can hand the role
on from the Questions page, and cannot accidentally remove their own admin role.

### Profile page (`pages/profile.html`)
Tap the avatar/name chip in the top bar to open it.

* **Account identity** (user id, email, phone, verified) is shown read-only in locked rows.
* **Editable:** full name, class/paper, city, school/coaching, photo link and a short "about".
  `PATCH /api/auth/profile` saves them, and the server **rejects any attempt to change email,
  phone or the login id** with `400` and a message naming the blocked fields. A 1-character name
  or a non-`http(s)` photo link is also rejected.
* **Change password** needs the current one (a Google-only account can set a password straight
  away, since it has none yet).

Editing needs a working server, because the details are saved against your account in MongoDB.
Offline the page says so and disables the save button instead of pretending it worked.

### Who can add questions
`POST /api/questions` and `DELETE /api/questions/:id` go through the `requireQuestionEditor`
middleware, so the **server** enforces this, not just the UI:

| | read the bank | add questions | delete any question | delete own | clear the whole bank |
|---|---|---|---|---|---|
| Anonymous | yes | no | no | no | no |
| Student without permission | yes | **no (403)** | no | no | no (403) |
| Student with permission | yes | **yes** | no | **yes** | no (403) |
| Admin | yes | **yes** | **yes** | yes | **yes** |

Reading stays open to everyone, so the question bank and offline mode keep working for a
student who has never signed in. A permitted student can only add new questions or edit ones
they added themselves - writing over someone else's question is refused. Permissions are read
from the database on every request, so a revoke applies on the next click without signing out.

On the Questions page a student without permission sees a read-only bank plus a card explaining
how to ask the admin, and an admin additionally gets the **Student permissions** panel: one row
per account with **Allow to add questions** / **Revoke add access** and a promote/demote button.

### User-wise analytics
`GET /api/analytics/users` is admin only (`requireAdmin`) and returns one row per account with
tests, average %, best %, overall accuracy, last attempt and the permission flag. Accounts that
have never taken a test are included with zeros, so you can see who needs a nudge; attempts
whose account was deleted still appear as "Unknown user" rather than disappearing.

On the Progress page the scope buttons now adapt to who is signed in:

* **This device** - always shown (local storage).
* **My account** - the signed-in student's own attempts in MongoDB.
* **All students** - admins only: the user-wise roster above, with a **view** button per student
  that drills the whole dashboard into that one student, and **Show all students** to come back.

Signed out, the "All students" button is not rendered at all. `GET /api/attempts` is scoped the
same way: a student only ever receives their own rows, `?scope=all` / `?userId=` are admin only,
and clearing results from a non-admin only removes that student's rows. Anonymous (signed-out)
attempts are still saved, with an empty `userId`, and stay visible to the admin who owns the
device.

## 10. Notes and limitations

* Results and imported questions live in that browser only. Clearing browser data, or
  switching phone/browser, means starting fresh - use **Download full backup** on the
  Questions page before switching devices.
* Questions are text only; images inside questions are not supported.
* Hosting is static, so there is no central "see her results" view. Ask her to use
  **Share result** (WhatsApp), or export the history as CSV/JSON from the Progress page.
* `sw.js` caches files by version. After you change site files, bump `CACHE` in `sw.js`
  (currently `supertet-prep-v3` - increase the number, e.g. `supertet-prep-v4`) so phones pick
  up the new version.

  "answer": "B",
  "explanation": { "hi": "12 जनवरी को स्वामी विवेकानंद का जन्मदिन है।", "en": "12 January is Swami Vivekananda's birthday." },
  "tags": ["days", "national"]
}
```
