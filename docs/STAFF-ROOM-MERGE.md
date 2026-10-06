# Uniting the staff room (חדר המורים) with the learning platform

Status: **in progress** · decided 2026-10-06 · stages A–D and the import script implemented locally (ADR-029 to ADR-032)

## Decisions

- **One app on the learning platform** (Next.js + Supabase). The staff room's real
  features move into it; its Cloudflare Worker and D1 database are retired after the
  cut-over. One login, one database, one look (the New School design system).
- **The code stays local** until the `newschool-il` organization is connected. Nothing is
  pushed to the personal `Moshikgueta/projectnewschool` repository, which keeps serving
  the current staff room until the cut-over.
- Security model: the platform's (RLS on every table, MFA for staff powers beyond
  teaching, server-only privileged code), not the Worker's. Features are re-implemented
  on it, not copied.

## What the staff room is today

From an inventory of `Teacher Dashboard v2.dc.html`, `Teacher Mobile.dc.html`,
`functions/` and `schema.sql`:

- **Server-side (D1):** staff accounts and sessions, student entry codes, rooms and the
  weekly timetable. Everything else runs on demo data in the page, saved in the
  browser's localStorage, so it is not shared between people or devices.
- **Roles:** מורה, מנהל פדגוגי, אדמין, מנהלת קבלה, תלמיד; plus per-account screen lists.
- **Design:** "Broadsheet". Retired: the platform follows the New School brand.

## Where each part goes

| Staff room                                       | Data today         | In the platform                                                                                         | Stage   |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------- | ------- |
| Accounts, roles (מורה, מנהל פדגוגי, אדמין)       | D1                 | Supabase Auth + `user_roles` (teacher, pedagogical_manager, admin), invites by admin                    | exists  |
| Role מנהלת קבלה                                  | D1                 | new role **`office`** with its own area, MFA required                                                   | **A** ✓ |
| Per-account screen lists                         | D1                 | not ported: roles and areas decide; revisit if a real need appears                                      | —       |
| כיתות ושיבוץ (rooms, weekly timetable)           | D1                 | `rooms`, `room_bookings` (overlaps refused by the database), office area, read-only timetable for staff | **A** ✓ |
| Student entry codes                              | D1                 | code sign-in into a normal Supabase session; same hashing scheme so existing codes keep working         | **B** ✓ |
| Student portal                                   | demo               | `/learn` (notebook, workbook, practice, vocabulary, progress)                                           | exists  |
| תלמידים / פרופיל (students, profile)             | demo               | teacher: group pages (exist) + per-student page; office: student records with contact details           | **D** ✓ |
| שיעורים קבוצתיים (groups, attendance, level fit) | demo               | groups exist; **attendance per class** (`group_sessions`) and level-fit notes                           | **C**   |
| לוח בקרה (dashboard KPIs, today's lessons)       | demo               | teacher home "today" (sessions, homework to check); office home (packages ending, open payments)        | C / D   |
| יומן שבועי (calendar)                            | demo               | the timetable (A) + `group_sessions`; per-teacher view; Zoom link per class                             | A / C   |
| Private lessons: balance, packages, lesson log   | demo               | **packages and lesson log** (purchased / used, late-cancel rule, low-balance alert)                     | **D** ✓ |
| Payments                                         | flag only          | PayPlus integration from the Spanish course project, behind the office area                             | D+      |
| מחברות דיגיטליות (notebook links)                | demo (Google Docs) | platform notebooks (exist); Google Docs links until each cycle is converted                             | exists  |
| חומרי לימוד (materials)                          | demo               | media library in the CMS                                                                                | 8 / E   |
| בונה מערך שיעור (lesson-plan prompt)             | local              | teacher tool, same prompt builder, no AI call from the server                                           | **E**   |
| בונה סילבוס                                      | local              | cycles per course in the CMS                                                                            | 8       |
| פידבק (student, material, missing material)      | local              | `feedback` table; managers see it                                                                       | **E**   |
| חומר הדרכה (training links)                      | local              | staff resources page                                                                                    | **E**   |
| משימות (tasks)                                   | demo               | staff tasks                                                                                             | **E**   |
| קבלה ורישום (admissions, leads)                  | demo               | leads pipeline in the office area. **Personal data of prospects: privacy review first**                 | **F**   |
| פיתוח מורים (teacher development)                | demo               | HR records. **Sensitive: separate access rules, review first**                                          | **F**   |
| מורים (roster, 77 teachers)                      | demo               | teacher profiles + languages taught                                                                     | D       |

Stages: **A** rooms and timetable · **B** student codes · **C** attendance and teacher
"today" · **D** students, packages and the office (the Tazman replacement,
`MIGRATION-FROM-TAZMAN.md`) · **E** staff tools · **F** admissions and teacher development.

## The office: students, packages and private lessons (stage D)

The Tazman replacement, first part (`MIGRATION-FROM-TAZMAN.md` in the staff room, steps 1
and 3).

- **Office home** (`/office`): today's private lessons; packages to follow up (one lesson
  or fewer left to book, expiring within 14 days, or not paid). The timetable moved to
  `/office/timetable`.
- **Students** (`/office/students`): search, lessons left, "needs attention"; add a
  student (no email needed: they sign in with an entry code).
- **A student's page:** contact details and office note; entry code; packages (lessons,
  length, validity, price, paid or not, used · booked · left) with "mark as paid"; private
  lessons: book (teacher, time, length; drawn from the package expiring first), cancel
  (less than 24 hours before counts as late and is charged), mark held or missed once
  started.
- **Rules in the database:** a teacher or a student can't be in two lessons at once; a
  lesson can't use another student's package; only teachers teach and only students
  attend; balances are counted, never stored; packages and lessons are audited.
- **Teachers** see today's private lessons on their "Today" page, read-only. No contact
  details, packages or prices.
- **Not yet:** self-booking by students and teachers' working hours (Tazman step 2),
  reminders (step 4), reports and teacher pay (step 5), PayPlus payments (D+), a student
  view of their packages, guardians (waits for D7).

## Attendance and the teacher's day (stage C)

- **Teacher home is now "Today"** (`/teach`): today's classes in the teacher's time zone,
  each with its room from the weekly timetable and how many students are marked;
  earlier classes from the last two weeks still missing attendance; homework due in the
  coming week with how many have done it; then the groups.
- **Attendance** (`/teach/groups/<group>/classes/<class>`): present, late, absent or
  excused, and an optional note, for each active or paused student. It opens 30 minutes
  before the class. Students left unmarked stay unmarked. The database checks the
  teacher, the time and the student again (ADR-031).
- **Group page:** past classes with how many are marked, and each student's attendance
  ("3 of 4"; excused absences don't count).
- **Records stay:** attendance is never deleted, and a class that has started can't be
  cancelled (once attendance exists, the database refuses).
- Not yet: level-fit notes, a student-facing attendance view, attendance in the office's
  lesson log (stage D, with packages).

## Student entry codes (stage B)

- **Students** sign in at `/login/code` (linked from the login page) by typing the code
  in any case, with or without the dash. The server finds the student by the code's
  hash, checks the account has the student role and nothing else, and exchanges a
  one-time token for a normal session. From then on it is an ordinary student session
  with the same RLS.
- **Teachers** press "New code" next to a student on their group page. The code is shown
  there once. The old code stops working. Only students enrolled (active or paused) in a
  group the teacher teaches; anything else, including a forged form, is refused.
- **Wrong codes:** the same message for every failure; 10 per caller and 100 overall per
  15 minutes, as in the staff room.
- **Pepper:** `STUDENT_CODE_PEPPER`, a server secret (Vercel environment variable). At
  cut-over it must be the staff room Worker's value; until then each environment has
  its own.
- Not ported: admins issuing codes from a staff list (the office and admins get this with
  stage D's student records), and an explicit "revoke" (issuing a new code revokes).

## Moving the data (D1 → Supabase)

`scripts/staff-room-import.ts` reads an export of the staff room's D1 database and
imports it. It reads accounts, entry codes, rooms and bookings, and never reads password
hashes, sessions or reset tokens.

```bash
# 1. Export (someone with access to the Cloudflare account). The file holds personal
#    data: keep it out of Git (export/ and *.d1-export.sql are ignored) and delete it
#    after the cut-over.
npx wrangler d1 export teacher-room --remote --output=export/teacher-room.d1-export.sql

# 2. Dry run: prints what would be created and what needs a person to look at.
pnpm staff-room:import export/teacher-room.d1-export.sql

# 3. Import. No email is sent: staff accounts are created without an invitation.
pnpm staff-room:import export/teacher-room.d1-export.sql --apply

# 4. At the cut-over: run again with invitations. Staff who have never signed in get an
#    email to set their password; everything already imported is left as it is.
pnpm staff-room:import export/teacher-room.d1-export.sql --apply --send-invites
```

Staging and production need `APP_ENV=staging|production` and `--confirm=<Supabase host>`.
Running it again is safe: what is already there counts as unchanged, and nothing is
deleted or overwritten.

What it does (rules in `src/domain/migration/staff-room.ts`, unit tested):

| Staff room                                                    | Platform                                                                                                                                                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account, role מורה / מנהל פדגוגי / אדמין / מנהלת קבלה / תלמיד | Account with role teacher / pedagogical_manager / admin / office / student. Matched by email: an existing account gains the role, **unless that would move it across the student/staff line** (reported for an admin instead) |
| Disabled or awaiting approval; unknown role                   | Not imported, reported                                                                                                                                                                                                        |
| Password                                                      | Not carried over (PBKDF2 can't be imported): staff set a new one from the invitation; students use their code                                                                                                                 |
| Entry code                                                    | The hash is copied for **students only**, so the code keeps working when `STUDENT_CODE_PEPPER` is the Worker's value. A newer platform code wins                                                                              |
| Room                                                          | Matched by name, otherwise created                                                                                                                                                                                            |
| Booking                                                       | Created unless it would clash (reported). The free-text teacher is matched by name to exactly one platform teacher; otherwise the name goes into the note as "Teacher: …" and is reported                                     |
| Screen lists, sessions, reset tokens                          | Not imported                                                                                                                                                                                                                  |

Tested with a made-up export (`tests/fixtures/staff-room-export.sql`): an API-level test
imports it into the local database, checks every row, and runs it again to show nothing
changes; an end-to-end test signs in with a code imported from the staff room.

## Cut-over

1. Stages A and B in the platform, the import tested on a copy of the D1 data.
2. Staff accept their invitations; the office checks rooms and the timetable.
3. The domain points to the platform. The Worker shows a "we have moved" page.
4. D1 is kept read-only for 30 days, then exported once more for the archive and deleted.

Until then the staff room keeps running unchanged.
