# New School | Teacher Onboarding

Teacher training and onboarding, built **inside** the existing portal (חדר המורים): the same
login, accounts, roles, Worker, D1 database, navigation and Broadsheet styling. No separate
app, no second user table, no existing feature removed.

Status: **built and tested on branch `claude/awesome-lovelace-tm9baz`. Not deployed.**
Production needs your approval and the one schema step below.

---

## 1. How it fits the existing portal (audit summary)

| Existing piece | What onboarding does with it |
| --- | --- |
| `staff_users` + server-side sessions (`_staff.js`) | Reused as is. A "teacher" is a `staff_users` row with role `מורה`. |
| Roles | `מנהל פדגוגי` and `אדמין` manage training; `מורה` learns; `מנהלת קבלה` and `תלמיד` are refused (403). |
| Worker router (`src/worker.js`) | One line hands `/api/staff/training/*` to its own router (`functions/api/staff/training.js`). |
| D1 (`schema.sql`) | 15 new `training_*` tables appended. No existing table altered. |
| Dashboard page (`Teacher Dashboard v2.dc.html`) | Three new screens on the same shell and nav; styles reuse the page's `--color-*` tokens. |
| Notifications | The existing ones are browser-only (localStorage), so onboarding has its own **in-portal** notifications in D1. Nothing is sent outside the portal. |
| File storage | The portal has none (no R2). Files are **Drive links**: the "File" block and "Upload a file" task both take a URL. |
| E2E suite (`npm test`) | Extended: 224 checks pass (112 existing + 112 onboarding). |

## 2. What was built

**Teacher, "ההכשרה שלי"** (nav item appears only when a path is assigned):
- Welcome banner, progress ring, profile card (name, language, role, start date, status, %).
- "Continue where you left off".
- Path timeline: each module card has an icon, estimated time, activity count, status and a button. Modules can be required, optional or locked behind a prerequisite.
- Module player for all 19 block types:
  - **Content:** heading, text, image, video, link, file, info card, accordion, steps/cycle diagram, approved embed.
  - **Activities:** checklist, multiple choice, matching, ordering, scenario, open answer, lesson plan, reflection, file submission.
- Answers are graded on the server; the key is revealed only once an item is finished.
- Feedback and submission history; drafts are kept in the browser until sent.
- Ready to Teach stage, 30-day follow-up with reflections, notifications, What's New.
- A card on the teacher's existing home dashboard links into the training.

**Teacher Resource Hub, "מרכז משאבים"** (teachers and managers):
- Official resources only.
- Search across modules and resources; results point to where the information was entered, nothing is generated.
- Filters for language (including "general"), level, type and programme; sort; favourites.

**Manager, "ניהול הכשרת מורים"** (pedagogical manager and admin):
- **Overview:** in training, completed, awaiting readiness, to review, average progress, needs follow-up, plus the review queue and the full teacher table.
- **Teachers and assignment:** assign any path, with a due date.
- **Teacher profile:**
  - edit language, role and start date;
  - per module: status, score and every answer;
  - submissions with approve / request revision (feedback required for a revision);
  - reset auto-graded answers;
  - readiness decision: ready / ready with conditions / more training. It is recorded with who decided and when, never computed.
  - 30-day checkpoints: meeting, recommendations (the teacher sees these), private notes (the teacher does not), done/reopen;
  - withdraw or reactivate an assignment; this teacher's action history.
- **Paths:** create; onboarding or continuing; language and audience; order modules; required/optional; prerequisites; archive.
- **Module editor (CMS):**
  - title, description, objectives, icon, estimated time, optional pass mark;
  - add, reorder and remove blocks and their items;
  - save draft, preview exactly as a teacher sees it, publish, archive, duplicate;
  - full version history with restore.
  - Losing work is guarded against: a stale save gets a 409 instead of overwriting, unsaved edits are kept in the browser and offered back, and leaving the page asks first.
  - Publishing refuses an activity a teacher could not complete.
- **Resources:** create and edit (all fields, tags, linked modules); status official / draft / review / archive; link check (ok / needs access / broken).
- **Updates (What's New)** and the **audit log** (append-only).

**Rules enforced on the server, not just hidden in the UI:**
- Every route checks the role.
- A teacher can only open their own live assignment, inside their path, published, and with prerequisites met.
- Viewed, completed, passed and approved are separate states.
- Readiness is never automatic.
- Teachers read the published snapshot, so drafts never leak mid-training.
- Every stored URL must be http(s).

## 3. Content: what is real and what is waiting

- **Starting template** (seeded only when a manager clicks the button, always as **drafts**): the 12 modules, from Welcome to New School through Final Assessment.
  - Objectives and topic lists come from your brief.
  - Wherever New School's own pedagogy, the cycle method, the notebooks or policies belong, there is a **"ממתין לתוכן רשמי"** card. Nothing organisational was invented.
  - Policies & Communication shows every topic as a draft awaiting the official policy.
  - Final Assessment has **no pass mark**; that is a management setting.
- **Draft suggestions to review before publishing:** three Classroom Management scenarios (labelled "טיוטה לאישור"), each with several reasonable responses, and the first-lesson checklist.
- **The 8 links from "Training - Rabi & Moshik" (04.03.2026):**
  - Seeded as **draft, unchecked** resources, not as compulsory training.
  - 2 are Italian-specific; the other 6 are general.
  - They have not been opened or verified. Use "בדיקת קישור" on each; Google returns "needs access" for private documents.

## 4. Testing

- `npm test`: **224 passed, 0 failed.** It walks the full success-criteria flow through the API (manager creates a path with three modules, assigns it, the teacher signs in and works, the manager reviews, requests a revision, approves, records readiness, adds a continuing training). It also covers:
  - a teacher with no training;
  - unauthorised roles (reception, student, a teacher on management routes);
  - another teacher's assignment;
  - a stale editor;
  - content changed mid-training;
  - refresh;
  - an incomplete question refused at publish;
  - archived modules;
  - deleting an account that has training history (still works; the history is kept).
- **Browser (Chromium, desktop and 390px phone):** the same flow driven through the real UI. Two runtime quirks were found and fixed: an attribute that both starts and ends with an interpolation resolves to nothing, and a `d="{{ }}"` path attribute is parsed before render.
- **Regression:** all 112 existing checks still pass, and the page's tag balance is unchanged (the same three pre-existing strays).
- **Not tested:**
  - the link check against the real Google URLs (the sandbox has no route to them);
  - real screen readers;
  - Safari and Firefox;
  - load with many teachers.

## 5. Not done / gaps

1. **File upload:** there is no storage. Adding an R2 bucket would enable real uploads and protected files; for now Drive links are used, with Drive's own permissions.
2. **External notifications** (email / WhatsApp): deliberately off. `RESEND_API_KEY` already exists for password resets and could be wired in with your approval.
3. **Mobile page** (`Teacher Mobile.dc.html`): no onboarding screens yet. The desktop page now works at phone width (the nav becomes a scrolling strip).
4. **AI assistant over the knowledge base:** not built. Search returns only what was entered.
5. **"חומר הדרכה"** (the older localStorage guides screen) is untouched. Its items could be moved into the hub.
6. **Teaching language** lives in `training_profiles`. The teacher roster on the "מורים" screen is still localStorage, so the two are not linked.
7. **Group assignment:** paths go to one teacher at a time. "Audience" is descriptive text, not an automatic rule.
8. **Reload:** after a reload the portal opens on its usual home screen. Training progress is kept, and "continue where you left off" returns to the module.

## 6. Deploying (only after your approval)

```sh
npx wrangler d1 execute teacher-room --remote --file=schema.sql   # adds the training_* tables; existing tables untouched (CREATE IF NOT EXISTS)
npm run deploy
```

Then sign in as the pedagogical manager → ניהול הכשרת מורים → "יצירת תבנית ההכשרה", fill in the
official content, publish, build a path, assign.

**Production risks:**
- The schema step is additive, but take a D1 Time Travel bookmark first.
- `docs/` is also served by GitHub Pages. There the screens render but cannot sign in (as today).
- The link checker makes outbound requests from the Worker, only when a manager presses the button, never automatically.
