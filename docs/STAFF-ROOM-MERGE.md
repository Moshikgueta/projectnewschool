# Uniting the staff room (חדר המורים) with the learning platform

Status: **in progress** · decided 2026-10-06 · stages A and B implemented locally (ADR-029, ADR-030)

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
| תלמידים / פרופיל (students, profile)             | demo               | teacher: group pages (exist) + per-student page; office: student records with contact details           | **D**   |
| שיעורים קבוצתיים (groups, attendance, level fit) | demo               | groups exist; **attendance per class** (`group_sessions`) and level-fit notes                           | **C**   |
| לוח בקרה (dashboard KPIs, today's lessons)       | demo               | teacher home "today" (sessions, homework to check); office home (packages ending, open payments)        | C / D   |
| יומן שבועי (calendar)                            | demo               | the timetable (A) + `group_sessions`; per-teacher view; Zoom link per class                             | A / C   |
| Private lessons: balance, packages, lesson log   | demo               | **packages and lesson log** (purchased / used, late-cancel rule, low-balance alert)                     | **D**   |
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

A script (`scripts/import-staff-room.ts`) reads a `wrangler d1 export` and imports:

- **Staff accounts.** Each becomes a Supabase user with the mapped role. Passwords
  cannot be carried over (D1 stores PBKDF2; Supabase cannot import it), so each person
  gets an invitation email to set a new password. Disabled accounts are not imported.
- **Students with codes.** If the platform uses the same pepper (`STUDENT_CODE_PEPPER`)
  and the same scheme (SHA-256 of `pepper + "$" + code`), the stored hashes are copied as
  they are and **every student keeps their code**.
- **Rooms and bookings** as they are. A booking's teacher was free text in D1. It is
  matched to a teacher by name where exactly one matches; otherwise the name is kept in
  the booking's note for the office to fix.

The script has a dry run that only reports what it would do.

## Cut-over

1. Stages A and B in the platform, the import tested on a copy of the D1 data.
2. Staff accept their invitations; the office checks rooms and the timetable.
3. The domain points to the platform. The Worker shows a "we have moved" page.
4. D1 is kept read-only for 30 days, then exported once more for the archive and deleted.

Until then the staff room keeps running unchanged.
