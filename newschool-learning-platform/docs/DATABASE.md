# Database

> Status: **Implemented (Phase 1, local).** Migrations: `supabase/migrations/`; tests:
> `supabase/tests/database/` (61 pgTAP checks) and `tests/integration/`. See §8 for how
> the implementation refines this design.

PostgreSQL on Supabase. All tables live in `public` with **Row Level Security enabled and
forced**; anything not explicitly allowed by a policy is denied. Primary keys are UUIDs
(`gen_random_uuid()`); timestamps are `timestamptz`. Migrations are SQL files in
`supabase/migrations/`, applied by the Supabase CLI. Nobody edits schema in the dashboard.

## 1. Domains

```
IDENTITY        CATALOG (content)            DELIVERY              LEARNER RECORDS
auth.users      languages                    groups                attempts
profiles        levels                       group_teachers        responses
user_roles      courses                      enrollments           section_progress
                cycles                       group_cycles          vocab_review_state
                books ─ book_sections        group_sessions*       learning_events
                section_teacher_notes        assignments           recommendation_feedback
                activities ─ activity_items  assignment_recipients
                activity_item_keys                                 OPERATIONS
                skills ─ activity_skills                           audit_log
                vocabulary_sets ─ vocabulary_items
                media_assets
```

`*` optional in MVP.

## 2. Tables

### Identity

| Table        | Key columns                                                                        | Notes                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `auth.users` | id, email, encrypted_password                                                      | Owned by Supabase Auth. Credentials never leave this schema.                                                                                    |
| `profiles`   | **id → auth.users.id**, display_name, avatar_path, ui_locale, timezone, created_at | Educational profile only. No phone, address, ID number or birth date (see [SECURITY.md §Privacy](SECURITY.md#4-privacy-and-data-minimisation)). |
| `user_roles` | user_id, role, granted_by, granted_at · PK(user_id, role)                          | `role` enum: `student`, `teacher`, `pedagogical_manager`, `admin`. A person may hold several roles.                                             |

### Catalog — what the school teaches

| Table                   | Key columns                                                                                                                                                                                   | Notes                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `languages`             | id, code (BCP 47: `es`, `he`, `ar`…), name, **direction** (`ltr`/`rtl`)                                                                                                                       | The language being _taught_.                                                                                      |
| `levels`                | id, language_id, code, title, position, cefr (nullable)                                                                                                                                       | "Level 1".                                                                                                        |
| `courses`               | id, level_id, slug, title, description, **instruction_locale**, status, published_at                                                                                                          | A concrete course ("Español básico 2025"). `instruction_locale` = language of the explanations (usually `he`).    |
| `cycles`                | id, course_id, slug, title, communicative_goal, position, status                                                                                                                              | Communicative topic ("Food"). `position` is only the _suggested_ order — groups choose what's active.             |
| `books`                 | id, course_id, **kind** (`notebook`/`workbook`), title                                                                                                                                        | One notebook and one workbook per course (more kinds later, e.g. `teacher_guide`).                                |
| `book_sections`         | id, book_id, cycle_id, position, title, **blocks** jsonb, schema_version, phase, status                                                                                                       | The content. `blocks` validated against the block schema ([CONTENT-MODEL.md](CONTENT-MODEL.md)).                  |
| `section_teacher_notes` | section_id, blocks jsonb                                                                                                                                                                      | Teacher-only content, in its own table so it **cannot** leak with a student query (RLS can't filter inside JSON). |
| `activities`            | id, course_id, cycle_id, slug, title, instructions jsonb, **phase**, scoring_mode, est_minutes, status, created_by (null = curriculum; else the teacher or office user who wrote it, ADR-038) | Any interactive unit: workbook exercise, in-notebook question, homework.                                          |
| `activity_items`        | id, activity_id, position, **type**, prompt jsonb, data jsonb, points                                                                                                                         | One question. `data` is type-specific and **public** (options, gaps, tokens — each with a stable id).             |
| `activity_item_keys`    | item_id, answer jsonb, feedback jsonb                                                                                                                                                         | Correct answers. **No student access, ever.** Teachers and managers may read them.                                |
| `skills`                | id, code (`vocab.food`, `grammar.past_simple`, `listening`), label                                                                                                                            | Taxonomy that drives recommendations and "topics to revisit".                                                     |
| `activity_skills`       | activity_id, skill_id                                                                                                                                                                         | Many-to-many.                                                                                                     |
| `vocabulary_sets`       | id, course_id, cycle_id, title                                                                                                                                                                | Per-cycle word lists.                                                                                             |
| `vocabulary_items`      | id, set_id, position, term, gloss, example, notes, audio_asset_id, image_asset_id, attrs jsonb                                                                                                | `attrs` holds language-specific grammar (gender, plural, verb class) without a column per language.               |
| `media_assets`          | id, bucket, path, kind, mime, bytes, duration_s, alt_text, transcript, source/licence, created_by                                                                                             | Every file in Storage. Content blocks refer to assets by id, never by URL.                                        |

Enums: `content_status` = `draft | in_review | published | archived`;
`phase` = `before_class | during_class | after_class | review | optional`;
`scoring_mode` = `none | practice | scored` (most activities are `practice`: feedback, no grade).

### Delivery — who studies what, with whom

| Table                   | Key columns                                                                                                                                                              | Notes                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `groups`                | id, course_id, name, starts_on, ends_on, status, schedule_note                                                                                                           | A class. A private student is a group of one.                                                                  |
| `group_teachers`        | group_id, teacher_id, role (`lead`/`assistant`)                                                                                                                          |                                                                                                                |
| `enrollments`           | id, group_id, student_id, status (`active`/`paused`/`completed`/`withdrawn`), started_on, ended_on                                                                       | **The single source of course access** (ADR-008). No separate `course_enrollments` table to drift out of sync. |
| `group_cycles`          | group_id, cycle_id, state (`upcoming`/`active`/`completed`), activated_at, position                                                                                      | Teacher picks the active cycle(s).                                                                             |
| `group_sessions`        | id, group_id, starts_at, cycle_id                                                                                                                                        | _Optional in MVP._ Lets "before your next class" use a real date. Later fed by the timetable system.           |
| `assignments`           | id, group_id, activity_id \| book_section_id \| vocabulary_set_id (exactly one — CHECK), audience (`group`/`selected`), phase, available_from, due_at, note, assigned_by |                                                                                                                |
| `assignment_recipients` | assignment_id, student_id                                                                                                                                                | Only for `audience = selected`. A `group` assignment automatically includes students who join later.           |

### Learner records

| Table                     | Key columns                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `attempts`                | id, user_id, activity_id, **course_id**, assignment_id, attempt_no, status (`in_progress`/`submitted`), state jsonb (resume position, drafts), score, max_score, started_at, updated_at, submitted_at | "Continue where you left off". `course_id` is denormalised so RLS checks don't need joins.                                                                                                                                                                |
| `responses`               | id, attempt_id, item_id, answer jsonb, is_correct, score, feedback_code, try_no, created_at                                                                                                           | **Append-only**: every check is a row, which is what makes "common errors" analysis possible.                                                                                                                                                             |
| `section_progress`        | user_id, book_section_id, status, last_block_id, updated_at, completed_at                                                                                                                             | Notebook/workbook reading position.                                                                                                                                                                                                                       |
| `block_responses`         | user_id, section_id, **course_id**, block_id, item_index, answer (≤ 2000), updated_at                                                                                                                 | Optional, ungraded in-class answers in the notebook (decision C2). Own-row writes (ADR-023).                                                                                                                                                              |
| `vocab_review_state`      | user_id, vocabulary_item_id, box (Leitner 1–5), due_at, last_reviewed_at, correct_streak, lapses                                                                                                      | Spaced review scheduling.                                                                                                                                                                                                                                 |
| `learning_events`         | id bigint, user_id, type, occurred_at, course_id, cycle_id, activity_id, section_id, payload jsonb                                                                                                    | Append-only history: `activity_started`, `activity_completed`, `answer_submitted`, `section_completed`, `vocab_reviewed`, `assignment_completed`, `login`. Source for progress, weekly activity, streaks and analytics. Partition by month once it grows. |
| `recommendation_feedback` | user_id, rec_key, action (`dismissed`/`opened`/`completed`), at                                                                                                                                       | Recommendations themselves are computed, not stored (ADR-010).                                                                                                                                                                                            |

XP/badges (Phase 9) will add `xp_ledger` and `badges/user_badges`; nothing in the MVP
depends on them.

### Operations

| Table       | Notes                                                                                                                                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_log` | id, actor_id, action, entity_type, entity_id, before jsonb, after jsonb, occurred_at. Written by triggers on roles, enrollments, groups, publishing and account changes. Insert-only: `UPDATE`/`DELETE` revoked from every role, including the app. |

## 3. Relationships (summary)

```
languages 1─* levels 1─* courses 1─* cycles
courses 1─* books 1─* book_sections *─1 cycles
courses 1─* activities *─1 cycles;  activities 1─* activity_items 1─1 activity_item_keys
courses 1─* groups 1─* enrollments *─1 profiles(student)
groups 1─* group_teachers *─1 profiles(teacher)
groups 1─* group_cycles *─1 cycles
groups 1─* assignments ─→ activity | book_section | vocabulary_set
profiles 1─* attempts 1─* responses *─1 activity_items
```

Why some things the original list mentioned are _not_ separate tables:

- **`teachers`** — a teacher is a profile with the `teacher` role; a second table would
  duplicate identity.
- **`course_enrollments`** — access derives from group enrollment (ADR-008).
- **`notebooks` / `workbooks`** — both are "a book of sections per cycle"; one `books`
  table with `kind` avoids two copies of the same logic.
- **`activity_questions` / `activity_options`** — exercise types differ too much (pairs,
  gaps, tokens, buckets) for one options table. Options live in `activity_items.data`
  with stable ids, validated per type by Zod, so analytics can still count wrong choices.
- **`progress`** — split into `section_progress`, `attempts` and `vocab_review_state`
  (current state) plus `learning_events` (history). One generic table would mix them.
- **`recommendations`** — computed per request; only feedback is stored.
- **`content_units`** — the cycle _is_ the unit; sections, activities and vocabulary
  hang off it directly.

## 4. Row Level Security model

Helper functions (`SECURITY DEFINER`, `STABLE`, `search_path = ''`), called as
`(select fn(...))` in policies so Postgres evaluates them once per query:

| Function                                               | True when                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `app.has_role(r)`                                      | caller holds role `r`                                                                                 |
| `app.is_staff_manager()`                               | caller is `pedagogical_manager`                                                                       |
| `app.can_view_course(course_id)`                       | active enrollment in a group of that course, **or** teaches a group of it, **or** pedagogical manager |
| `app.teaches_group(group_id)`                          | row in `group_teachers` for the caller                                                                |
| `app.teaches_student_in_course(student_id, course_id)` | caller teaches a group of `course_id` in which `student_id` is enrolled                               |

Policies (read = `SELECT`; writes are listed separately):

| Table                                     | Student                                         | Teacher                                      | Ped. manager            | Admin              |
| ----------------------------------------- | ----------------------------------------------- | -------------------------------------------- | ----------------------- | ------------------ |
| profiles                                  | own row; display name of their groups' teachers | students in their groups                     | all                     | all (account mgmt) |
| user_roles                                | own                                             | —                                            | read                    | read/write         |
| catalog tables                            | `published` + `can_view_course`                 | `published` + `can_view_course`              | all incl. drafts, write | —                  |
| section_teacher_notes                     | **none**                                        | `can_view_course`                            | all, write              | —                  |
| activity_item_keys                        | **none**                                        | `can_view_course`                            | all, write              | —                  |
| groups / enrollments / group_cycles       | own groups                                      | groups they teach; may update `group_cycles` | all, write              | read               |
| assignments                               | targeted at them                                | their groups, write                          | all                     | —                  |
| attempts / responses / vocab_review_state | **own rows** (read only)                        | `teaches_student_in_course` (read)           | read                    | —                  |
| block_responses / section_progress        | **own rows** (read, own-row write, ADR-023)     | `teaches_student_in_course` (read)           | read                    | —                  |
| learning_events                           | own (read)                                      | `teaches_student_in_course` (read)           | read                    | —                  |
| audit_log                                 | —                                               | —                                            | —                       | read               |

Learner-record **writes** happen only through Server Actions using the privileged module
(ADR-006): there is no `INSERT/UPDATE` policy for `authenticated` on graded tables.
Low-risk, ungraded state has narrow own-row policies instead (ADR-023):
`block_responses` (insert, update of `answer` only, delete) and `section_progress`
(insert, update of `status`, `last_block_id` and `completed_at`), each limited to
sections the student can read.

Exercises (Phase 4, migration `…0900_exercises`): `attempts`, `responses` and
`vocab_review_state` stay read-only for students; Server Actions write them with the
privileged client after checking access with the student's own session (ADR-006).
`attempts.state` holds the player state (per item: status, tries, the student's own
latest answer, first-try score), never keys. A partial unique index allows one open
(`in_progress`) attempt per student and activity. `activity_items.slug` gives items a
stable identity for imports.

Exercises written by staff (Phase 8, migration `…1800_staff_exercises`, ADR-038):
`activities.created_by` is null for the school curriculum (manager-only, unchanged) and
otherwise names the teacher or office user who wrote the exercise; it is set once, in the
author's own name, and never changed (trigger `app.activities_created_by`).

| Helper                               | True when                                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.can_author_activity(course)`    | caller teaches a group of the course, or is the office (MFA)                                                                                                                                                                |
| `app.can_edit_activity(activity)`    | manager (MFA); or a staff exercise the caller wrote and may still author in its course; or, for the office, one written by any office user                                                                                  |
| `app.can_edit_item(item)`            | `can_edit_activity` of the item's exercise                                                                                                                                                                                  |
| `app.can_view_staff_activity(…row…)` | the author; the office (office-written in any status, others once published); teachers of the course once published; a student only through an assignment they can see (their group, or them by name) in a published course |
| `app.answered_item_ids(activity)`    | rows only for callers who may edit the exercise: every answered item, whoever answered it                                                                                                                                   |

- `activities`: staff insert only with `created_by = auth.uid()` and `can_author_activity`;
  update only what `can_edit_activity` allows; no delete (archived instead).
  `activities_select` = manager, or curriculum `published` in a visible cycle, or
  `can_view_staff_activity` — so a staff exercise never reaches a whole course.
- `activity_items` (select follows the parent row as before), `activity_item_keys`
  (students still read none) and `activity_sources`: staff write through
  `can_edit_activity` / `can_edit_item`.
- The office (MFA) reads published courses and cycles, reads all assignments, inserts
  assignments for any group in its own name, and updates or deletes only its own.
- Views for the editor (no functions in `public`): `editable_activities` (ids the caller
  may edit) and `activity_answered_items` (over `app.answered_item_ids`), both
  `security_barrier`, select-only, no `anon` access.

Homework for selected students (Phase 7, migration `…1900_selected_homework`, ADR-039):
an assignment with `audience = 'selected'` reaches only its `assignment_recipients`
(`assignments_select` and `app.can_view_staff_activity` check
`app.is_assignment_recipient`, unchanged).

- **Recipients are students of the assignment's group** (enrolment `active` or `paused`),
  and exist only for `selected` assignments: trigger
  `app.check_assignment_recipient` (AFTER insert/update, so RLS refuses an outsider before
  the check reveals anything about enrolments). Applies to every writer, the secret key
  included. An assignment with recipients cannot move to another group
  (`app.assignments_keep_recipients_group`).
- `assignment_recipients`: teachers of the group read and write (`app.teaches_assignment`,
  unchanged); the office (MFA) reads, inserts and deletes only for assignments it gave
  itself (`app.office_owns_assignment`: `assigned_by = auth.uid()`); a student reads only
  their own rows and writes none; the manager (MFA) everything.
- `enrollments_select_office`: the office (MFA) reads enrolments, to offer a group's
  students when it assigns.

Pilot release and mistake reports (migration `…2000_pilot_and_content_reports`,
ADR-040): `courses.pilot` (boolean, default false; read like the rest of the course row).
`content_reports` (`reporter_id`, `course_id`, `activity_id` + optional `item_id`, or
`book_section_id`, `message` ≤ 500, `suggested_answer` ≤ 300, `status` open/resolved,
`created_at`, `resolved_by`, `resolved_at`; composite foreign keys keep each target in
its course):

| Policy / rule             | Who                                                                                                                                                                                  |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `content_reports_select`  | the reporter (own rows); teachers of the course (`app.teaches_course`); the manager (MFA). Not the office, not other students                                                        |
| `content_reports_insert`  | `reporter_id = auth.uid()`, `app.is_enrolled_in_course(course_id)`, and the exercise (its question) or page `exists` under the caller's RLS; insert grant on the "what" columns only |
| `content_reports_resolve` | update by teachers of the course or the manager (MFA); update grant on `status` only                                                                                                 |
| trigger `…_before_insert` | forces `open` and `created_at = now()`; at most `app.content_reports_per_hour()` (10) per reporter per hour, else `PT429`                                                            |
| trigger `…_before_update` | sets `resolved_by = auth.uid()` and `resolved_at = now()` on resolving, clears both on reopening; audit trigger records every change                                                 |
| delete                    | nobody (no grant)                                                                                                                                                                    |

Answer corrections (migration `…2100_answer_corrections`, ADR-041):
`activity_items.corrected_at` (when the key was last corrected; set only by a correction,
read like the rest of the item, so students can be told). `item_corrections` is both the
request and its audit record: `item_id`, `course_id`, `activity_id`, `corrected_by`,
`corrected_at`, `reason` (3–500), optional `report_id` (the mistake report it answers),
`old_data`/`old_answer`, `new_data`/`new_answer`, `new_source` (the corrected question in
the authored form), and the re-check's counts (`responses_rechecked`, `became_correct`,
`became_incorrect`, `attempts_rescored`, `regraded_at`).

| Policy / rule                                                         | Who / what                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `item_corrections_select`                                             | the manager (MFA) only: rows hold answer keys. Not teachers, the office or students                                                                                                                                                                                                        |
| `item_corrections_insert`                                             | the manager (MFA); insert grant on the request columns only (`item_id`, `course_id`, `reason`, `report_id`, `new_data`, `new_answer`, `new_source`)                                                                                                                                        |
| trigger `app.correct_answered_item` (BEFORE INSERT, SECURITY DEFINER) | checks `app.is_manager()` itself; locks the item and key; refuses a change to anything but the key and multiple choice's `multiple` (23001) or no change (22023); records old values, who and when; updates item, key, `corrected_at` and the source's item; bumps `activities.updated_at` |
| `app.item_correction_grants` (private table)                          | the one-time bypass: (transaction id, item, random token). No grant to `anon`, `authenticated` or `service_role`; written and removed only inside the trigger                                                                                                                              |
| `app.item_correction_allowed(item)`                                   | true only with a grant row for the current transaction and item **and** `app.item_correction` = its token; asked by `app.protect_answered_item` / `app.protect_answered_key` (which also refuse any other change of `corrected_at`)                                                        |
| trigger `app.item_corrections_keep`                                   | a correction is never rewritten: only the re-check's counts may be filled in (by the server's secret key); no delete grant                                                                                                                                                                 |

The re-check of past answers writes `responses` (`is_correct`, `score`, `feedback_code`)
and `attempts` (`state`, `score`) with the secret key, like live grading (ADR-006).

Note the admin column: **admin is not a superset of everything.** Admin manages accounts
and settings; seeing student learning data requires the pedagogical role (a person can
hold both). This is least privilege applied to the most powerful account.

Every policy gets a pgTAP test (see [SECURITY.md §Testing](SECURITY.md#3-security-testing)).

## 5. Indexes (initial)

Every column used in an RLS predicate or a foreign key is indexed:
`enrollments(student_id, status)`, `enrollments(group_id)`, `group_teachers(teacher_id)`,
`groups(course_id)`, `attempts(user_id, activity_id, updated_at desc)`,
`attempts(course_id)`, `responses(attempt_id)`, `responses(item_id, created_at)`,
`section_progress(user_id, updated_at desc)`, `learning_events(user_id, occurred_at desc)`,
`vocab_review_state(user_id, due_at)`, `book_sections(book_id, cycle_id, position)`,
`activities(course_id, cycle_id, phase)`, `assignments(group_id, due_at)`.

## 6. Conventions

- Snake_case, plural table names; `id uuid` PK; `created_at`/`updated_at` with a trigger.
- Soft state via `status`, not deletes, for content and enrollments (history matters).
- Hard delete only for personal data on erasure requests (see SECURITY.md).
- Every migration is forward-only and reviewed; destructive changes need a two-step
  (expand → migrate → contract) migration.
- Generated TypeScript types (`supabase gen types`) are committed and checked in CI.

## 7. Seed data

`supabase/seed.sql` (local + staging only): one language, one level, one course with two
cycles, a group, two students, two teachers (one with an _unrelated_ group), one manager,
one admin. These fixtures are what the authorization tests attack.

## 8. Implementation notes (Phase 1)

What the migrations do beyond the tables above:

- **Composite foreign keys keep the tree consistent.** Child rows carry `course_id` and
  reference their parent as `(id, course_id)`, so a section can't point at another
  course's cycle and a response can't point at someone else's attempt. It also lets every
  policy check `course_id` directly instead of joining up the tree.
- **Integrity triggers:** only `student` accounts can be enrolled and only `teacher`
  accounts can teach a group; the last `admin` role can't be removed.
- **Helpers in a private `app` schema** (not exposed by the API). `public` contains no
  functions, so nothing is callable as an RPC.
- **Default deny:** `auto_expose_new_tables = false`, RLS enabled _and forced_ on every
  table, and explicit grants. `anon` has no privilege on any table.
- **Manager and admin powers need MFA (`aal2`)** in the policies themselves (ADR-015).
- **Teachers see published content only**, like students; managers see drafts.
- **Audit log** is filled by triggers on `user_roles`, `enrollments`, `groups`,
  `group_teachers`, `courses`, `cycles` and status changes of `activities` and
  `book_sections`. A trigger rejects `UPDATE`, `DELETE` and `TRUNCATE`, even from the
  owner.
- **New auth users get a profile automatically** (`app.handle_new_auth_user`), with the
  display name set by the inviting admin.

| Migration                 | Contents                                                            |
| ------------------------- | ------------------------------------------------------------------- |
| `…000100_foundation`      | `app` schema, enums, `touch_updated_at`                             |
| `…000200_identity`        | `profiles`, `user_roles`, new-user trigger                          |
| `…000300_catalog`         | languages → … → vocabulary, media, keys, teacher notes              |
| `…000400_delivery`        | groups, teachers, enrollments, active cycles, sessions, assignments |
| `…000500_learner_records` | attempts, responses, progress, vocabulary state, events, feedback   |
| `…000600_audit_log`       | audit log, append-only guard, audit triggers, last-admin rule       |
| `…000700_authorization`   | helper functions, RLS, grants, policies                             |
