# New School Cycles · חדר המורים

This repository holds two applications on one Cloudflare Worker and one D1 database:

- **New School Cycles** (`/learn/`), the practice platform for New School students. It is documented directly below.
- **חדר המורים** (`/dashboard`, `/mobile`), the staff room. It is documented from [Staff room](#staff-room--חדר-המורים) on.

Both use the same accounts, sessions and roles.

---

# New School Cycles

Students practise their course content, get immediate feedback, review mistakes and follow their own
progress. The interface is Hebrew and RTL, and learning content is shown in the target language. Each
student sees only the languages and levels they are enrolled in. The platform follows the school's
non-chronological cycles method. Topics carry names, never lesson numbers. Any published topic in an
enrolled level can be opened at any time, and nothing unlocks anything else.

## Quick start (local demonstration)

```sh
npm install
npm run demo          # build → schema → Spanish content → demo accounts → wrangler dev
```

Open <http://localhost:8787/learn/>. The demo accounts exist **only in the local D1**. Their pepper is
written to `.dev.vars`, and the app shows a "local demo" banner. They are not a production setup.

| Who | Sign in with | Sees |
| --- | --- | --- |
| Student, Level 1 | code `DEMA-ESAA` | Spanish Level 1 |
| Student, Level 2 | code `DEMA-ESBB` | Spanish Level 2 |
| Student, Levels 1 + 2 | code `DEMA-ESCC` | both, with a course switcher |
| Admin | `demo-admin` / `demo-admin-2026` | everything |
| Pedagogical manager | `demo-pedagogy` / `demo-pedagogy-2026` | all content and students |
| Office (admissions) | `demo-office` / `demo-office-2026` | students, codes, enrollments |
| Teacher (Spanish Level 1) | `demo-teacher` / `demo-teacher-2026` | Level 1 only |

## Tests

```sh
npm test              # build + grading unit tests + staff-room suite + Cycles suite
npm run test:grade    # answer-checking rules only (no server)
npm run test:learn    # the Cycles end-to-end suite only
```

`scripts/e2e-learn.mjs` starts its own `wrangler dev` on a separate local database
(`.wrangler/e2e-learn`), so it never touches your development data. If Playwright is installed, it
ends with browser checks.

## Production setup

1. **Database.** Apply the schema, then load the content. Both scripts are idempotent, and the content
   seed uses `INSERT OR IGNORE`, so re-running it never overwrites edits staff have made in the admin area:
   ```sh
   npx wrangler d1 execute teacher-room --remote --file=schema.sql
   npx wrangler d1 execute teacher-room --remote --file=seed/content.sql
   ```
   **Never** apply `seed/demo.sql` remotely. It is git-ignored and is only produced by `npm run seed:demo`.
2. **Secrets** (Worker → Settings → Variables and Secrets). Names are listed in `.env.example`; values
   never go in the repository or the frontend:

   | Name | Required | Purpose |
   | --- | --- | --- |
   | `STUDENT_CODE_PEPPER` | yes | Makes student entry codes work. Long and random; changing it invalidates every code |
   | `STAFF_BOOTSTRAP_TOKEN` | once | Creates the first admin, then delete it (see [The first admin](#the-first-admin)) |
   | `RESEND_API_KEY`, `EMAIL_FROM` | optional | Password-reset email for staff |
   | `DEMO_MODE` | **no** | Local demo banner only. Leave unset in production |

3. **Optional audio storage.** Uncomment the `MEDIA` R2 binding in `wrangler.toml` (see the comment there).
4. `npm run deploy`.

## How access is enforced

The browser is never trusted. Every student request goes through `functions/learn/_core.js`:

- `levelAccess` returns content only when **all three** hold: the student has an *active* enrollment in the
  level, the level is *published*, and its language is *published*. Topics and activities must also be
  published. This check runs in SQL on every request. The same friendly "outside your enrollment" answer
  comes back for a changed URL, a guessed ID or a hand-written API call.
- Answer keys stay in `exercises.key_json`. They are graded on the server and never sent before an answer.
  A model answer is shown after a correct answer, after two misses in a row, or when the student asks
  (the request is recorded).
- `docs/learn/app.js` is interface only. The build contains no course text, and the test suite checks this.
- Students cannot reach any `/api/manage/*` endpoint. Enrollments, roles and content change only there.
- Every student-record query is filtered by the session's own user ID.
- Writes must be JSON from the same origin (CSRF guard in `functions/learn/router.js`). The app is served
  with a strict Content-Security-Policy, and protected responses are `no-store`.
- Staff permissions are enforced per request:

| Role | Content | Publish · Challenge Mode on/off | Students & codes | Enrollments | Reports & practice suggestions |
| --- | --- | --- | --- | --- | --- |
| אדמין | all | yes | all | yes | all |
| מנהל פדגוגי | all | yes | all | yes | all |
| מנהלת קבלה | — | — | all | yes | — |
| מורה | assigned levels (edit, add drafts, preview) | no | students of assigned levels (codes only) | no | assigned levels |

Admins assign teachers to levels under **מורים ורמות**.

## Content model

`language → level → cycle (topic group) → topic → activity`. Each language has its own levels,
groups, topics, activities, vocabulary, audio, enrollments and progress. Nothing assumes that languages
share a curriculum or a number of levels. The interface is shared, so adding a language, level, topic or
activity is data entry in the admin area, not code.

The Spanish course comes from the supplied ZIP (`content/source/spanish-practice/`). Re-extract with
`npm run content`, which needs Python 3 with `beautifulsoup4`:

| | Topics | Activities | Glossary |
| --- | --- | --- | --- |
| Level 1 (A1) | 19 | 304 | 1,034 |
| Level 2 (A2) | 21 | 357 | 491 |
| Level 3 (B1) | 20 + 6 mixed-review sets | 419 | 610 |

Where the platform had to add or adapt something, it is marked:

- **Topic groups are a proposal.** The workbook has none. Each group's description says so, and staff can
  rename, regroup or delete them.
- **Level 2/3 objectives are composed** from the topic title and its stated grammar focus, because the
  workbook states none. They are flagged "נוסחה אוטומטית" in the editor for staff review.
- **Level 2/3 have no grammar explanations in the workbook.** The page shows the stated grammar focus.
  It also shows the corrected sentences of the topic's own error-correction activity, labelled as such,
  and says plainly that no explanation exists.
- **Workbook references to page numbers and unit numbers were reworded.** For example "the unit" became
  "the topic", and "check the key at the back" became "check the feedback". The Level 3 review stations
  were titled "unidades 01–04". They are now named after the topics they cover.
- **Accepted alternatives come only from the answer key's own notation**: `a / b`, `o/a`, `(גם: …)`. Hebrew
  notes in the key are shown as feedback. The key allows dropping a Spanish subject pronoun, so the
  transformation and translation activities accept answers with or without it.

## Answer checking (`functions/learn/grade.js`)

Case, extra spaces and sentence punctuation (including `¿ ¡`, Arabic `، ؛ ؟`, Greek `;`) are always
ignored. Everything else can be configured per language (admin → הגדרות שפה), then per activity, then per
item:

- **Accents / diacritics.** `strict` is the default: `esta`/`está` and `hablo`/`habló` are different words. The
  answer is marked "almost", with feedback naming the words to check. `lenient` accepts the answer with a
  note showing the correct form; the Spanish vocabulary-recall and matching activities use it.
- **Arabic.** Harakat and tatweel are ignored by default. Hamza on alef stays significant unless set to lenient.
- **German.** `ß`/`ss` and capitalization can each be made significant or not. **Greek** tonos is strict by default.
- **Optional leading words** (for example subject pronouns), and a **content match** for reading questions.
  Content match marks an answer right if it contains every content word of the model answer that is not
  already in the question. "En Madrid" is right for "¿Dónde vive Lucía?".
- **Feedback names the problem without giving the answer away**: unexpected words, the number of missing
  words, word order only, accents only, a spelling that is close.
- **"My answer is also right"** sends the answer to the teacher. If accepted, it joins the key for everyone.
- **Open writing and speaking are not auto-assessed.** The student writes or speaks, then gets the
  workbook's model and criteria (and the level rubric) and self-rates. That is recorded as self-assessment.

## Progress: three separate numbers

- **Completion**: an activity counts once every item has been answered (or the open task self-reviewed).
  A topic is *practised* at 75% of its activities.
- **Accuracy**: share of items answered right the first time.
- **Evidence of learning**: items answered right on a *later day* than first seen, without having
  revealed the answer that day.

XP is separate from all three and never counts towards them.

## Staff guide

**Enroll a student.** Go to *תלמידים והרשמה*. *תלמיד/ה חדש/ה* creates the account and shows an entry
code once. Hand the code over; *קוד חדש* replaces it. *הרשמה לרמה* adds a level, and a student can hold
several levels and languages. *סיום הרשמה* withdraws access at once and keeps all history. The
student's progress page shows every level they have had, with ended enrollments labelled.

**Add a language's first course.** The seven languages already exist. Spanish is published; English,
German, Italian, French, Arabic and Greek are Draft.
1. *קורסים ותוכן → רמה חדשה*. The number is the enrollment level, and the new level starts as Draft.
2. *הגדרות שפה*: content direction (Arabic is RTL), on-screen special characters, answer-checking defaults.
3. In the level, add topic groups and topics. Titles describe the topic, and a title like "שיעור 3" is refused.
4. In a topic, fill in the objective, the two main skills, a short explanation, examples and vocabulary
   (`word = meaning` per line), then add activities with *פעילות חדשה*. Every activity type has a form,
   and a raw JSON mode is available. The server validates every activity before saving.

**Preview and publish.** *תצוגה מקדימה כתלמיד* shows the topic exactly as a student will see it,
drafts included. Answers can be checked there and are not recorded. Publishing goes bottom-up: publish a topic (it needs
at least one activity), then the level (it needs a published topic), then the language (it needs a published
level). Students see nothing until all three are published. *החזרה לטיוטה* at any layer hides it again,
immediately and for API requests too. Teachers can edit, add and preview content in their own levels; publishing is for the
pedagogical manager and admins.

**Teaching tools.** In each level: *התקדמות התלמידים* shows each student and each topic, with completion,
accuracy and evidence kept separate, plus the items most often answered wrongly. *הצעות תרגול* sends a
set of topics to one student or the whole level, as suggestions with no order. *תשובות חלופיות* holds
students' proposed alternative answers. *מצב אתגר* switches the optional game layer on or off for the level.

## What is not included (honest list)

- **No audio.** The supplied course contains no recordings, so there is no listening activity and no audio
  control anywhere. Media storage and a protected streaming endpoint are built (R2 binding `MEDIA`, off by
  default), and an activity with `audio` shows a real player or says the recording is missing.
- **Grammar explanations for Levels 2–3** and **teacher-reviewed objectives** are missing from the
  source (see above).
- **No automatic assessment of free writing or speaking.** Self-review against a model is used instead.
- **Student accounts sign in by entry code only** (the existing staff-room design). There is no email
  login or password for students.
- **Hebrew is the only interface language.** Interface strings live apart from content in
  `learn-src/i18n.js`, ready for another language.
- **Google Fonts** is fetched at runtime. Offline, the system fonts are used.
- **Production still needs** the secrets above, the remote schema and content load, real student
  accounts and enrollments, and teacher↔level assignments. None of these can be done from the repository.

## Layout

| Path | What |
| --- | --- |
| `content/source/spanish-practice/` | the supplied ZIP, unchanged (not served) |
| `content/spanish/level-*.json` | extracted course (generated by `scripts/extract-spanish.py`) |
| `seed/content.sql` | idempotent D1 seed (generated by `scripts/build-seed.mjs`) |
| `functions/learn/` | platform API: `_core` (access), `grade`, `stats`, `student`, `manage`, `router` |
| `learn-src/` | Preact app source; `npm run build` bundles it into `docs/learn/` |
| `scripts/seed-demo.mjs` | local demo accounts |
| `scripts/e2e-learn.mjs`, `scripts/test-grade.mjs` | tests |

---

# Staff room · חדר המורים


לוח מחוונים למורה — desktop and mobile views for a language-school teaching system:
students, digital notebooks (מחברות דיגיטליות) and lesson materials, in Hebrew RTL.

## Files

| File | What it is |
| --- | --- |
| `Teacher Dashboard v2.dc.html` | The full desktop dashboard — login, greeting, students list, digital notebooks, lesson materials |
| `Teacher Mobile.dc.html` | The phone view of the same system |
| `support.js` | The `dc` runtime both pages load (`<script src="./support.js">`) — generated, do not hand-edit |
| `_ds/broadsheet-…/` | The **Broadsheet** design system bundle — `styles.css` tokens, `_ds_bundle.js`, `_ds_manifest.json`, lint config and `readme.md`. Reference only; the pages don't link it (see [Design](#design)) |
| `vendor/` | React 18.3.1 and ReactDOM 18.3.1 UMD builds, vendored so the standalone build is offline and deterministic |
| `scripts/build-standalone.js` | Bundles each page into one self-contained file in `docs/` |
| `uploads/` | Source documents the content was derived from (course and notebook lists) |
| `.thumbnail` | WebP preview image |
| `functions/` | Server side: `_shared.js` (PBKDF2, email), `_staff.js` (sessions, guards), `api/staff/*` (the endpoints) |
| `src/worker.js` | Cloudflare Worker entry — routes `/api/staff/*`, serves `docs/` for everything else |
| `schema.sql` | D1 schema: `staff_users`, `staff_sessions`, `staff_reset_tokens` |
| `scripts/e2e.mjs` | 60 end-to-end checks against a local Worker and D1 (`npm test`) |
| `wrangler.toml` | Worker + D1 config |

## Running it

Both pages are self-contained documents that pull `support.js` from the same directory,
so they need to be served over HTTP rather than opened with `file://`:

```sh
python3 -m http.server 8000
```

then open <http://localhost:8000/Teacher%20Dashboard%20v2.dc.html>.

`support.js` bootstraps itself by fetching React 18.3.1 and ReactDOM 18.3.1 from unpkg at
runtime (with SRI), so the browser needs internet access — behind a network that blocks
unpkg the page stays blank and the console shows `[dc] failed to load React or boot`.

### With the backend

```sh
npm install
npm run schema      # apply schema.sql to the local D1
npm run dev         # build + wrangler dev, on http://localhost:8787
npm test            # build + the 60-check end-to-end suite
```

`npm run dev` serves `docs/` and the API from one origin, which is what the session
cookie needs. Create the first admin with the bootstrap endpoint below.

### Self-contained build

```sh
node scripts/build-standalone.js
```

writes `docs/dashboard.html` and `docs/mobile.html` — each one file, no server and no
network. They can be opened straight from disk, emailed, or dropped on any static host.

The build inlines the two React UMD bundles from `vendor/` ahead of `support.js`, which
makes the runtime skip its CDN fetch (`loadReactUmd` returns early when `window.React` and
`window.ReactDOM` already exist). `@babel/standalone` is deliberately left out: the runtime
only loads it for `x-import`ed JSX modules, which these pages don't use — confirmed by
loading them in a browser with the Babel request blocked.

The only thing a built page still reaches for is Google Fonts. Offline it falls back to
Georgia; everything else renders and works.

**Inlining has to escape HTML-looking tokens**, and getting this wrong fails in a way that
only shows up when the page is served. `support.js` mentions `<x-dc`, `</x-dc>` and
`<sc-raw-*>` in its own regexes, strings and comments. Inlined verbatim those land in the
document text — and the runtime re-fetches the page over HTTP and re-parses it, so it finds
the stray markers and tries to create an element named `sc-raw-*`, which throws and renders
a blank page. Under `file://` the re-fetch fails and the runtime falls back to the live DOM,
so the page looks perfect locally and is broken the moment it is hosted. The build escapes
the `<` of those tokens (and of `<script`) to `\x3c`, which leaves every value identical.
**Verify built pages over http, not file://** — that is the condition that matters.

## The site

`docs/` is the published site — GitHub Pages serves it from the `main` branch. It holds the
hand-written landing page (`docs/index.html`, which links the two views and explains how to
sign in) plus the two built pages, so the whole thing is static with no build step on
GitHub's side. `docs/dashboard.html` and `docs/mobile.html` are generated — rebuild them
with the command above rather than editing them; `docs/index.html` is a source file.

Enabling it, once per repository: **Settings → Pages → Source: Deploy from a branch →
`main` / `/docs`**. Pages on a private repository needs a paid GitHub plan; on the free
plan the repository has to be public, which puts the prototype on the open web — so nothing
under `docs/` may carry a working credential.

Both pages open on a login screen. **The demo accounts are gone** — login now goes to
`POST /api/staff/auth/login` and is checked against D1, so the printed `ns2026` passwords
that used to sit on the login screen were removed with them. See [Accounts and auth](#accounts-and-auth).

That makes the GitHub Pages copy a **look-only** deployment: the pages render, but no
login can succeed there, because Pages serves static files and has no API. The same
`docs/` build served by the Worker is the working system. Student and lesson data is
still in-page demo data — only accounts moved server-side so far.

## Accounts and auth

Accounts live in D1 and every rule is enforced in the Worker — the UI hiding a screen is a
convenience, the API is the boundary.

| endpoint | who | what |
| --- | --- | --- |
| `POST /api/staff/auth/login` | anyone | `{user, pass}` — username or email |
| `POST /api/staff/auth/logout` | signed in | deletes the session row, not just the cookie |
| `GET /api/staff/auth/me` | anyone | the source of truth for identity; called on every page load |
| `POST /api/staff/auth/signup` | anyone | self-signup — created **disabled**, pending an admin |
| `POST /api/staff/auth/reset-request` | anyone | mails a link. Never returns a token |
| `POST /api/staff/auth/reset-complete` | with token | `{token, pass}` — drops every session for that account |
| `GET/POST /api/staff/users` | admin | list · create with a temporary password |
| `PATCH/DELETE /api/staff/users/:id` | admin | edit · delete |
| `POST /api/staff/users/:id/reset` | admin | mint a reset link to relay by hand |
| `POST /api/staff/bootstrap` | once | the first admin |

### The first admin

Every account is made by an admin — except the first. Once, then delete the secret:

```sh
npx wrangler secret put STAFF_BOOTSTRAP_TOKEN        # any random value
curl -X POST https://<domain>/api/staff/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<same value>","name":"אלון","user":"office",
       "email":"office@newschool.co.il","pass":"<strong password>"}'
npx wrangler secret delete STAFF_BOOTSTRAP_TOKEN
```

The endpoint answers 409 forever once any account exists, so a forgotten secret is not a
standing door — delete it anyway.

### Email

`RESEND_API_KEY` + `EMAIL_FROM` as secrets. Without them nothing breaks: "forgot password"
tells the user to contact the office, and the admin mints a link from the users screen.

### Decisions worth knowing

- **PBKDF2** (100k iterations, per-account salt), lifted verbatim from the Spanish course
  project where it already runs in production, rather than rewritten.
- **Sessions are database rows, not signed cookies.** Disabling or deleting an account
  kills its live sessions immediately instead of at the next login — the difference that
  matters on a shared staffroom machine.
- **Session and reset tokens are stored hashed** (SHA-256): a dump of either table cannot
  be replayed as a login.
- **`reset-request` never returns the token.** That endpoint is unauthenticated, so
  echoing it back would be account takeover for anyone who can guess an address. Manual
  relay lives behind the admin guard at `POST /api/staff/users/:id/reset`.
- **Self-signup creates a disabled account**, or a stranger could mint themselves a מורה
  login and read student records.
- **8 failed attempts lock the account for 15 minutes.**
- **The last active admin cannot be demoted, disabled or deleted** — nor can you do any of
  those to the account you are signed in with.
- Wrong password and unknown username return the identical message, so the API cannot be
  used to confirm which school addresses exist.

## Design

The site follows **Broadsheet** — the design system in `_ds/broadsheet-…/`. Newsprint set
for the web: a `#f3f2f2` paper ground with `#201e1d` ink, cyan `#0088b0` as the interactive
accent and magenta `#d6006c` as the rarer second spot colour, hierarchy carried by the
serif scale and by space rather than by rules and boxes. The guide, the full token set and
the component list are in `_ds/broadsheet-…/readme.md`.

**Typography.** Broadsheet specifies Source Serif 4, which carries no Hebrew glyphs — on a
Hebrew RTL interface it would silently fall back to a system sans on nearly every string.
So the stack is `'Source Serif 4','Frank Ruhl Libre',Georgia,serif`: Latin sets in the
system's own face and Hebrew falls through to a Hebrew serif of the same newsprint
character. Per-character fallback does the routing, so each script gets a serif.

**Colour.** The pages carry no stylesheet to retheme — the look lived in ~1,600 inline
`style` attributes plus a few hundred values in the page script, so those were rewritten
onto `var(--color-*)` tokens declared at the top of each page. A hex is mapped by the
property it sits in: dark values as `background` become surfaces, the same values as
`color` become text.

Two deliberate departures from the guide, both because this is an operated interface rather
than a document:

- **The rail stays dark.** Broadsheet shows no dark surfaces, but the navigation rail and
  the sign-in panel need to separate from the working area. They take the system's deepest
  ink neutral, so they read as an ink panel on newsprint with knockout type — print
  language — instead of navy UI chrome.
- **Semantic and categorical colour sit outside the accents.** Pass/fail/warning states and
  the 26-language palette are information, not brand, so they keep distinct hues; every one
  is retuned to the same muted press-ink register so they sit inside the palette.

The landing page (`docs/index.html`) commits to the single light theme on purpose — a
newsprint system has no dark register to invert into — and uses the one rule pair the
system does print: the front-page thick–thin around a dateline rail.

## Conventions

- `support.js` is generated from `dc-runtime` — rebuild it there, never edit it here.
- Templates use the `sc-if` / `sc-for` control elements inside `<x-dc>`; props and script
  live in the `data-props` script block at the bottom of each page.
- **Keep the tags balanced, and check it.** See below — one missing `</div>` cost the
  whole desktop app, silently.

### One missing `</div>` blanked the entire desktop app

Worth writing down, because the symptom pointed nowhere near the cause. After signing in,
the desktop went **blank**: the login screen disappeared, the app never appeared, no
exception was thrown, the console was clean, and `renderVals()` returned
`showStaffApp: true` the whole time. Signing in as a student worked fine.

The cause was one missing `</div>` in the login block. The HTML spec says an end tag for
an unknown element — `</sc-if>` — that meets an open `<div>` on the stack is **ignored**
outright. So `<sc-if value="{{ isLocked }}">` never closed, and the entire staff app that
follows it got parsed *inside* it. The moment you signed in and `isLocked` went false, the
staff app went with it. The student view survived only because it sits further down,
outside the broken nesting.

Two `</div>` strays remain at the end of the staff block; unmatched end tags are discarded
by the parser and change nothing. The lesson is that a file can look completely fine and
be broken in its nesting, so before blaming the runtime, check the balance:

```sh
python3 - <<'EOF'
import io
from html.parser import HTMLParser
VOID={'br','img','input','hr','meta','link','source','area','base','col','embed','param','track','wbr'}
class P(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True); self.stack=[]; self.bad=[]
    def handle_starttag(self,t,a):
        if t not in VOID: self.stack.append((t,self.getpos()))
    def handle_endtag(self,t):
        if t in VOID: return
        if not self.stack: self.bad.append('stray </%s> line %d'%(t,self.getpos()[0])); return
        if self.stack[-1][0]!=t:
            self.bad.append('<%s> line %d closed by </%s> line %d'%(self.stack[-1][0],self.stack[-1][1][0],t,self.getpos()[0]))
            for i in range(len(self.stack)-1,-1,-1):
                if self.stack[i][0]==t: del self.stack[i:]; break
        else: self.stack.pop()
p=P(); p.feed(io.open('Teacher Dashboard v2.dc.html',encoding='utf-8').read())
print('unclosed:', [t for t,_ in p.stack] or 'none')
print('mismatched:', p.bad or 'none')
EOF
```
