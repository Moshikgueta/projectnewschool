# Performance at school scale

> Status: **measured 2026-10-13 on the local stack.** Spike from ROADMAP "Technical
> spikes": _RLS performance with helper functions on a seeded 10k-student dataset_ —
> done. Also the data-volume half of Phase 10's load test; concurrent users are still to
> do (see [§8](#8-not-covered-and-watch-items)).

**Result.** At 10,000 students, 27 of the 96 database queries behind the hot pages took
over 50 ms, the worst 4.9 s (a teacher's group page: 6.5 s end to end). The cause was
per-row helper calls in Row Level Security policies, not missing indexes. Migration
`20261013002200_rls_performance` makes each policy compute "what may this user see"
once per query instead of once per row. After it, **every query is under 50 ms (worst
40 ms)** and every page under 80 ms end to end through the API. The policies mean exactly
what they meant before: the pgTAP suite passes unchanged, every benchmarked query returns
the same rows for the same user, and a check of 14 users × 53 tables and views under the
old and the new policies (the seven large learner tables over a sample of 300+ students)
finds no difference (§6). Re-checking answers after a key correction went from 18.7 s to
6.7 s (6,543 answers), and a re-check with nothing to change from 11 s to 0.8 s; a bug
that made it rewrite every attempt each time was fixed.

## 1. Dataset

`scripts/perf/seed-scale.sql` loads it on top of `supabase/seed.sql` and the full
content import (18 courses, 320 cycles, 643 exercises, 5,137 questions). Deterministic:
every id is `md5('perf:…')` and every choice a hash of the row's own keys; times are
relative to the day it runs. Generation took **7 min**; the database is **2.7 GB**.

| What                                    | Rows                   | Notes                                                                                                                                   |
| --------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Students / teachers / office            | 10,000 / 150 / 10      | real `auth.users` (password as in seed.sql), profiles, roles                                                                            |
| Groups                                  | 800                    | ≈44 per course; one lead teacher each, an assistant in every tenth                                                                      |
| Enrolments                              | 14,906                 | each student in 1 or 2 groups (different courses); 90% active, 4% paused, 3% completed, 3% withdrawn                                    |
| Classes (`group_sessions`) / attendance | 24,003 / 335,934       | 30 classes per group (24 past); every past class marked for active and paused students                                                  |
| Assignments / recipients                | 24,196 / 9,159         | 30 per group (exercises, pages, word sets); 12% of exercise homework for 3–5 selected students; 8% given by the office                  |
| Staff exercises                         | 330 (1,980 questions)  | 2 per teacher (70% published), 3 per office user; published ones assigned to the teacher's first group                                  |
| Attempts                                | 370,065                | ≈37 per student (55% of a course's exercises, a quarter twice); 15% left open                                                           |
| Responses                               | 3,181,839              | ≈320 per student; answers in the grader's real shapes, so they re-grade like real ones                                                  |
| Reading progress / notebook answers     | 589,550 / 202,658      |                                                                                                                                         |
| Vocabulary review state                 | 1,101,397              |                                                                                                                                         |
| Learning events                         | 2,208,983              | started/completed/homework, page opened/completed, word reviews, logins                                                                 |
| Mistake reports                         | 1,419                  | a third resolved                                                                                                                        |
| Rooms / weekly bookings                 | 30 / 1,603             | two slots per group                                                                                                                     |
| Office: records / packages / lessons    | 10,003 / 1,503 / 6,008 |                                                                                                                                         |
| The "hot" question                      | 6,543 answers          | the first multiple-choice question of the first course, practised six times by every student of that course, for the re-grade benchmark |

Scaled down from the brief: about 37 attempts per student instead of 50 (the response
count, ≈320 per student, is on target). Disk was not the limit (19 GB free after loading).

Benchmark users: **student** `perf.student.8` (two active groups, 22 attempts and 170
first tries in the course benchmarked), **teacher** `perf.teacher.1` (leads 6 groups,
113 students; benchmarked group: 22 students), **office** `perf.office.1` (MFA, aal2),
**manager** `manager@example.com` (MFA, aal2). The 15 teachers who are also assistants
have 10 or 11 groups; one with 11 (`perf.teacher.103`) was run too (worst query 40 ms).

## 2. Machine

Local Supabase stack in Docker on a 4-vCPU Intel Xeon @ 2.1 GHz cloud container with
15 GB RAM: `supabase/postgres:17.11.0.002` with the CLI's defaults (`shared_buffers`
128 MB, `work_mem` 4 MB, JIT on), PostgREST v16.4, Kong 2.8. Warm cache (each query runs
once before it is timed); no other load. Hosted Supabase has more memory for buffers, so
these numbers should be an upper bound for the same data.

## 3. How it is measured

- **`scripts/perf/bench.sql`** — the SQL the app's hot pages send, **exactly as PostgREST
  sends it**: captured from the database log while the real query functions in
  `src/server/queries/*.ts` ran (§9), with ids and times replaced by placeholders resolved
  at run time. Each runs as the user (`role authenticated`, `request.jwt.claims` with
  `sub` and `aal`, as PostgREST and the pgTAP helpers do): one warm-up, then the median of
  7 runs of `EXPLAIN (ANALYZE, TIMING OFF, BUFFERS)`, planning plus execution. It also
  records the row count and an order-insensitive checksum of what each query returns.
  89 page reads (student dashboard, practice, progress, activity, notebook and section,
  vocabulary, my lessons; teacher group overview, student page, group stats, teacher's
  day, reports; office students, timetable, office day; manager reports) and 7 write-path
  steps (answering: the student's reads, the rate-limit count, the key read, inserting the
  response and updating the attempt; starting: the reads, inserting the attempt and the
  event — writes are rolled back).
- **`scripts/perf/pages.perf.ts`** — page level: the real query functions with a real
  user's token through Kong and PostgREST, all of a page's queries in parallel as the
  page does (median of 7).
- **`scripts/perf/regrade.perf.ts`** — the re-check after a key correction on the hot
  question, with the real code: the manager's preview read, the correction insert (its
  trigger) and `src/server/privileged/regrade.ts`; it corrects the key back and checks the
  data ends as it started.
- **`scripts/perf/policy-equivalence.sql`** — old vs new policies, full tables (§6).

## 4. Results: database queries (ms, median of 7)

Bold: 50 ms or more. Rows: what the query returns (capped at 1,000 by PostgREST's
`max_rows`; see §8).

| User    | Query (page: what)                                           | Rows | Before (ms) | After (ms) |
| ------- | ------------------------------------------------------------ | ---: | ----------: | ---------: |
| student | my courses (enrollments → group → course → level → language) |    2 |         1.8 |        2.0 |
| student | dashboard: recommendation feedback                           |    0 |         0.1 |        0.1 |
| student | dashboard: skills                                            |    2 |         0.0 |        0.1 |
| student | dashboard: words due (count)                                 |   38 |         0.3 |        0.4 |
| student | dashboard: next class                                        |    1 |         0.5 |        0.5 |
| student | dashboard: finished sections                                 |   29 |         0.2 |        0.3 |
| student | dashboard: active cycles                                     |    1 |         1.7 |        1.6 |
| student | dashboard: latest section                                    |    1 |         5.2 |        1.5 |
| student | dashboard: attempts + activity                               |   22 |        12.2 |        1.7 |
| student | dashboard: recent events (50)                                |   50 |    **63.2** |        3.4 |
| student | dashboard: first tries (500)                                 |  170 |    **65.3** |        2.6 |
| student | dashboard: activities + skills                               |   38 |   **190.9** |        7.2 |
| student | dashboard: sections + book                                   |   95 |   **165.4** |        2.5 |
| student | dashboard: homework (assignments + embeds)                   |   25 |   **116.0** |        7.2 |
| student | dashboard: words (count)                                     |  679 |   **336.0** |        3.0 |
| student | practice: attempts                                           |   22 |         0.2 |        0.2 |
| student | practice: group cycles                                       |   19 |         1.0 |        0.4 |
| student | practice: cycles                                             |   19 |         9.8 |        1.0 |
| student | practice: homework due dates                                 |   23 |    **91.4** |        0.9 |
| student | practice: activities                                         |   38 |   **183.3** |        7.0 |
| student | progress: attempts                                           |   22 |         0.2 |        0.2 |
| student | progress: vocabulary boxes                                   |   85 |         0.3 |        0.2 |
| student | progress: events (8 days)                                    |   14 |         0.2 |        0.2 |
| student | progress: section progress                                   |   37 |         0.2 |        0.2 |
| student | progress: first tries (all)                                  |  170 |    **66.5** |        2.6 |
| student | progress: sections                                           |   95 |   **168.3** |        1.3 |
| student | progress: activities + skills                                |   38 |   **160.7** |        7.1 |
| student | activity: my attempts                                        |    1 |         0.2 |        0.2 |
| student | activity: detail + items                                     |    1 |         5.8 |        4.6 |
| student | notebook: sections + book                                    |   95 |   **147.5** |        2.5 |
| student | notebook section: page + course                              |    1 |         2.5 |        3.9 |
| student | notebook section: my answers                                 |    0 |         0.1 |        0.1 |
| student | notebook section: my progress                                |    1 |         0.1 |        0.1 |
| student | vocabulary: review states                                    |   85 |         0.3 |        0.2 |
| student | vocabulary: course                                           |    1 |         0.5 |        1.0 |
| student | vocabulary: words + set                                      |  679 |   **163.0** |        4.8 |
| student | my lessons: packages                                         |    0 |         0.1 |        0.2 |
| student | my lessons: private lessons                                  |    0 |         0.4 |        0.4 |
| student | my lessons: package balances                                 |    0 |         0.5 |        0.4 |
| student | my lessons: attendance + class + group                       |   48 |         5.9 |        1.3 |
| teacher | group overview: group + course + students                    |    1 |         6.8 |        2.8 |
| teacher | group overview: group cycles                                 |   16 |         0.3 |        0.3 |
| teacher | group overview: next classes                                 |    5 |         0.3 |        0.2 |
| teacher | group overview: past classes                                 |    6 |         0.3 |        0.2 |
| teacher | group overview: cycles                                       |   16 |        11.0 |        1.0 |
| teacher | group overview: homework + recipients                        |   32 |        23.7 |        5.3 |
| teacher | group overview: finished sections                            |  510 |        15.3 |        2.2 |
| teacher | group overview: submitted attempts                           |  569 |        16.6 |        4.6 |
| teacher | group overview: recent events (200)                          |  200 |   **125.9** |       12.3 |
| teacher | group overview: activities                                   |   40 |   **182.1** |        4.2 |
| teacher | group overview: first tries + items                          | 1000 | **1,276.4** |       26.2 |
| teacher | group overview: attendance (inner join class)                |  504 | **4,884.4** |       33.9 |
| teacher | student page: group (teacher inner)                          |    1 |         1.4 |        1.8 |
| teacher | student page: enrolment + profile                            |    1 |         0.9 |        1.3 |
| teacher | student page: section progress                               |   32 |         1.5 |        0.8 |
| teacher | student page: attendance                                     |   24 |         1.8 |        1.3 |
| teacher | student page: attempts                                       |   25 |         1.5 |        1.1 |
| teacher | student page: notebook pages written                         |   14 |         1.5 |        0.8 |
| teacher | student page: last event                                     |    1 |         0.8 |        0.9 |
| teacher | student page: events (8 days)                                |    8 |         0.8 |        0.8 |
| teacher | student page: first tries                                    |  179 |   **108.5** |        3.5 |
| teacher | student page: activities + skills                            |   40 |   **193.4** |        4.8 |
| teacher | student page: sections + book                                |   71 |   **173.6** |        2.6 |
| teacher | group stats: group + students                                |    1 |         2.5 |        1.0 |
| teacher | group stats: activity detail + items                         |    1 |         7.2 |        5.0 |
| teacher | group stats: first tries of the group                        |  133 |         4.2 |        2.0 |
| teacher | group stats: answer keys                                     |    8 |         7.0 |        3.7 |
| teacher | teacher day: my groups                                       |    6 |         1.1 |        0.7 |
| teacher | teacher day: classes in window                               |   30 |         0.6 |        0.3 |
| teacher | teacher day: timetable                                       |   12 |         0.4 |        0.5 |
| teacher | teacher day: enrolments                                      |  113 |        13.5 |        0.7 |
| teacher | teacher day: homework due + recipients                       |   20 |        14.4 |        3.4 |
| teacher | teacher day: attendance marks                                |  408 |         6.7 |        2.0 |
| teacher | teacher day: private lessons                                 |    4 |         1.0 |        0.8 |
| teacher | teacher day: finished sections                               |    0 |         0.4 |        0.3 |
| teacher | teacher day: submitted attempts                              |  324 |         9.7 |        2.2 |
| teacher | reports list                                                 |  251 |   **131.5** |       11.6 |
| office  | students (office_students, 200)                              |  200 |         6.2 |        6.3 |
| office  | student records (phones)                                     | 1000 |   **102.4** |        1.1 |
| office  | packages of 200 students                                     |   23 |         2.8 |        0.6 |
| office  | package balances of 200 students                             |   23 |        12.0 |        1.6 |
| office  | timetable: rooms                                             |   33 |         3.5 |        0.3 |
| office  | timetable: entries                                           | 1000 |         5.6 |        5.6 |
| office  | office day: all students                                     | 1000 |         2.0 |        1.9 |
| office  | office day: lessons today                                    |  200 |   **177.1** |       20.3 |
| office  | office day: all packages                                     | 1000 |   **158.4** |        2.7 |
| office  | office day: all balances                                     | 1000 |   **548.5** |        4.5 |
| manager | reports (all)                                                |  500 |   **209.9** |       30.0 |
| manager | reports (open)                                               |  500 |   **146.7** |       18.9 |
| student | answer: my open attempt                                      |    1 |         0.2 |        0.3 |
| service | answer: rate limit (answers in the last minute)              |    0 |         0.5 |        0.5 |
| service | answer: answer key                                           |    1 |         0.1 |        0.1 |
| service | answer: insert response + update attempt state               |    — |         0.4 |        0.4 |
| student | start: my attempts at the activity                           |    0 |         0.2 |        0.2 |
| student | start: homework for the activity                             |    1 |         3.2 |        0.5 |
| service | start: insert attempt + learning event                       |    — |         0.3 |        0.3 |

The teacher's slowest query after the fix (40 ms) is the attendance read on the group
page; for the teacher with 11 groups it is the same 40 ms. All 96 queries: 27 at or over
50 ms before, none after.

## 5. Results: pages and write paths

Page level, end to end through Kong and PostgREST (median of 7, ms):

| User    | Page                   | Before (ms) | After (ms) |
| ------- | ---------------------- | ----------: | ---------: |
| student | dashboard              |     **401** |         41 |
| student | practice list          |         188 |         19 |
| student | progress               |     **404** |         30 |
| student | activity page          |          13 |         12 |
| student | notebook list          |         213 |         13 |
| student | notebook section       |          12 |         12 |
| student | vocabulary             |         220 |         16 |
| student | my lessons             |          12 |          7 |
| teacher | group overview         |   **6,502** |         77 |
| teacher | student in group       |         235 |         29 |
| teacher | group stats (activity) |          34 |         23 |
| teacher | teacher's day          |          69 |         41 |
| teacher | reports list           |         157 |         22 |
| office  | students               |         147 |         18 |
| office  | timetable              |          15 |         14 |
| office  | office day             |     **636** |         42 |
| manager | reports (all)          |         272 |         39 |
| manager | reports (open)         |         181 |         29 |

Bold: over the 300 ms dashboard budget ([ARCHITECTURE.md §9](ARCHITECTURE.md#9-performance-budget-initial-targets)).
The group overview makes two round trips (the group, then eleven queries in parallel).

**Answering an exercise** (database time per step, in the table above): the student's
reads 0.2–5 ms (the activity with its questions, 5 ms, is the largest), the rate-limit
count 0.9 ms, the key 0.1 ms, inserting the response and updating the attempt 0.4 ms;
starting an activity: reads 0.2–0.6 ms, inserting the attempt and its event 0.3 ms.
Writes were never the problem: `responses` has five indexes and the insert stays under
half a millisecond at 3.2 million rows.

**Re-checking answers after a key correction** (`pnpm perf:regrade`, the hot question,
6,543 answers in 5,116 attempts, ms):

| Step                                                  | Original code                         | With the jsonb fix only | Now (batched) |
| ----------------------------------------------------- | ------------------------------------- | ----------------------: | ------------: |
| Manager's preview read (RLS, all answers)             | 113                                   |                     113 |           124 |
| Correction insert (trigger applies the key)           | 11                                    |                      11 |            14 |
| Re-check, key changed (6,166 answers, 4,928 attempts) | ≈18,700                               |                  18,727 |         6,650 |
| Re-check again, nothing to change                     | ≈14,700, rewriting all 5,116 attempts |                  10,961 |           797 |

"Original code": the first run took 33.4 s for the two re-checks together and reported
5,116 attempts changed on the second (§7.3); the split is derived from the run with the
jsonb fix, whose key-changed path does the same work.

## 6. Same rules, proven

1. **pgTAP** (`pnpm test:db`): the whole suite (17 files, 379 checks) passes on the
   migrated database, unchanged; so do the API attack tests and the end-to-end suite.
2. **Same rows per user and query**: `pnpm perf:bench --compare before` runs every
   benchmarked query again and compares the row count and an order-insensitive checksum
   of the rows with the saved "before" run. All 96 match. One read (the office day's
   package balances) is capped at 1,000 of 1,503 rows by PostgREST with no order, so
   _which_ 1,000 come back depends on the plan; for capped reads the count is compared.
3. **Full tables, old against new** (`scripts/perf/policy-equivalence.sql`): for 14 users
   (two perf students, seed students A and B, two perf teachers, seed teachers X and Y,
   the office with and without MFA, the perf office user, the manager with and without
   MFA, the admin) and all 53 tables and views in `public`, the row count and a checksum
   of every visible row under the new policies, then — in the same transaction — under
   the policy expressions as they were before (verbatim from `pg_policies`). The seven
   large learner tables are compared over a sample of 300+ students (under the old
   policies a full scan of 3 million responses per user takes minutes). **742
   comparisons, 0 differences**; tables a user may not read refuse the same way before
   and after. On the normal seed (the 9 seed users, no sample): 477 comparisons, 0
   differences.

## 7. What changed and why

### 7.1 Policies evaluated once per query (migration `20261013002200_rls_performance`)

The plans showed no missing index. Every slow query was paying for **SECURITY DEFINER
helper calls once per row**:

- The catalog chain. `cycles_select` called `app.can_read_course(course_id)` for every
  cycle, and `book_sections`, `activities`, `vocabulary_sets` (and through them
  `activity_items`, `activity_skills`, `vocabulary_items`) check "is the cycle visible",
  so a student's 679-word count evaluated it for all 324 cycles: 336 ms. Each call is a
  SQL function with its own `search_path` and four nested helper calls (~0.5 ms each).
- Learner records. `app.teaches_student_in_course(user_id, course_id)` per response,
  attempt, event… row (≈30 µs each).
- Attendance. `app.teaches_group(app.session_group(session_id))` — two helpers per mark;
  the group page's attendance read is an inner-joined embed, so Postgres scans every mark
  (336,000) and called them for each: 4.9 s.
- `app.is_office()` and `app.is_staff()` were not wrapped in `(select …)` in about ten
  policies, so they ran per row too (office day: 548 ms for package balances).
- `FOR ALL` policies (`group_cycles_write`, `lesson_packages_write`, …) also apply to
  reads; several had the same per-row calls.

The fix is the standard one. For each per-row helper `app.f(col)` there is now a
set-returning helper listing exactly the values for which `app.f` is true for the caller,
and the policy says `col in (select app.f_set())`. Postgres computes the set once per
query (a hashed sub-plan) and probes it per row. Each set helper restates its per-row
helper's predicate verbatim, over the same tables, with the same `SECURITY DEFINER`,
`STABLE` and `search_path = ''`:

| New helper                                                | Lists what…                                                     | Replaces, per row                                              |
| --------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------- |
| `app.readable_course_ids()`                               | published courses the caller is actively enrolled in or teaches | `app.can_read_course(c)` (= `app.is_manager()` or this)        |
| `app.taught_course_ids()`                                 | courses of groups the caller teaches                            | `app.teaches_course(c)`                                        |
| `app.taught_group_ids()`                                  | groups the caller teaches                                       | `app.teaches_group(g)`                                         |
| `app.member_group_ids()`                                  | groups the caller is actively enrolled in                       | `app.is_group_member(g)`                                       |
| `app.received_assignment_ids()`                           | homework given to the caller by name                            | `app.is_assignment_recipient(a)`                               |
| `app.taught_assignment_ids()`                             | homework of groups the caller teaches                           | `app.teaches_assignment(a)`                                    |
| `app.own_assignment_ids()`                                | homework the caller gave                                        | `app.office_owns_assignment(a)` (= `app.is_office()` and this) |
| `app.taught_student_courses()`                            | (student, course) pairs the caller teaches                      | `app.teaches_student_in_course(s, c)`                          |
| `app.taught_session_ids()`                                | classes of groups the caller teaches                            | `app.teaches_group(app.session_group(s))`                      |
| `app.taught_student_ids()`                                | students of groups the caller teaches                           | `app.teaches_student(p)`                                       |
| `app.my_teacher_ids()`                                    | teachers of the caller's active groups                          | `app.is_my_teacher(p)`                                         |
| `app.private_student_ids()` / `app.private_teacher_ids()` | the caller's private-lesson students / teachers                 | `app.teaches_privately(p)` / `app.is_my_private_teacher(p)`    |
| `app.student_or_teacher_ids()`                            | users with the student or teacher role                          | `app.is_student_or_teacher(p)`                                 |

43 policies changed by `ALTER POLICY` (names, commands and roles unchanged): every
SELECT policy that called a per-row helper, and the `USING`/`WITH CHECK` of the `FOR ALL`
policies with one. Bare `app.is_office()`/`app.is_staff()` became `(select …)`. Write-only
policies (insert, update, delete) were left as they were: they run per written row, not
per row read. The old helpers stay; write policies, triggers and other helpers use them.
The new helpers are in the private `app` schema like the others (not callable through
the API; no `anon` execute — `01_rls_coverage` checks). The helpers were already
`STABLE`, so nothing changed there.

No index was added: every lookup the new plans make already has one (`enrollments
(student_id, status)`, `group_teachers (teacher_id)`, `assignments (group_id, …)`,
`assignment_recipients (student_id)`, `responses (user_id, course_id)`, `attempts
(user_id, activity_id, …)`, `attendance` primary key, …).

### 7.2 Re-check in batches (`src/server/privileged/regrade.ts`)

It made one API request per changed answer, then three per attempt (read the attempt,
read its tries, write it): about 21,000 requests for 6,500 answers. Now answers that get
the same new grade are updated together by id, 100 ids per request (≈70 requests), and
attempts are read 100 at a time — the attempts first, then their tries, in the same order
as before — and only those that change are written, each still compare-and-set on
`updated_at`. An attempt a student changed in the meantime falls back to the old
one-at-a-time rebuild with retries. Same results, same concurrency guarantee.

### 7.3 A re-check bug: jsonb key order (`src/domain/grading/regrade.ts`)

`regradeAttempt` decided whether an attempt changed by comparing `JSON.stringify` of the
stored and the rebuilt progress. The stored state comes back from `jsonb`, which orders
keys its own way (`tries, answer, status, firstScore`), so every attempt always looked
changed: each re-check rewrote every attempt of the question (and bumped `updated_at`,
which can make a student's concurrent answer retry), and "re-check again" reported
thousands of changes. It now compares the values regardless of key order. New unit test:
"is idempotent on state read back from the database".

## 8. Not covered, and watch items

- **Concurrent users.** This measures data volume with one user at a time. Phase 10's
  load test at 10× expected users (many sessions at once, against the hosted plan's
  connection limits) is still to do.
- **Reads capped at 1,000 rows.** PostgREST returns at most `max_rows` (1,000) rows and
  the app does not page, so at this scale some pages silently show part of the data: the
  teacher's group overview reads 1,000 of the group's 4,860 first tries (common
  difficulties and per-student summaries are computed on a part); the office timetable
  shows 1,000 of 1,603 weekly bookings; the office students list and office day read 1,000
  of 10,003 contact records, 1,000 of 10,006 student names and 1,000 of 1,503 packages.
  Not a security issue and not changed here (it needs paging or narrower queries in
  `src/server/queries`); it should be fixed before the school has this many groups.
- **Attendance on the group page** reads every mark in the school once per page (40 ms at
  336,000 marks), because the embed `session:group_sessions!inner(group_id)` gives
  Postgres no index-usable filter on `attendance` and the policy's teacher arm is an OR.
  It grows with the attendance history (about 0.1 ms per 1,000 marks). If it becomes
  slow: have `getGroupOverview` filter by the group's class ids (`.in('session_id', …)`,
  primary-key lookups).
- **Memory.** The local stack has 128 MB of shared buffers; the hot pages fit, but a cold
  cache (first request after a restart) is several times slower.

## 9. Re-running

```bash
pnpm db:start
pnpm db:reset                                    # migrations + seed
pnpm exec tsx scripts/content.ts import content  # the 18 courses (~1 min)
pnpm perf:seed                                   # school-scale data (~7 min, 2.7 GB)
pnpm perf:bench --save before                    # 96 queries, ~3 min; perf-results/before.csv
#   …change policies, indexes or queries…
pnpm perf:bench --compare before                 # times, and exits 1 if any query's rows changed
pnpm perf:pages                                  # page level through the API
pnpm perf:regrade                                # re-check of ~6,500 answers
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -f scripts/perf/policy-equivalence.sql
pnpm db:reset                                    # back to the normal seed
```

`pnpm perf:bench` options: `--runs N`, `--plans` (saves `EXPLAIN (ANALYZE, BUFFERS)` of
every query to `perf-results/<name>.plans.txt`), `--now <timestamp>` (fix "now" when
comparing runs), `--student/--teacher/--office/--manager <email>`. It uses `psql` if
installed, otherwise `docker exec` into the local database container, and refuses a
non-local `DATABASE_URL`. Results go to `perf-results/` (git-ignored). Everything here
is for the local stack only; never point it at staging or production.

### Refreshing the queries

`bench.sql` holds the SQL PostgREST generated for the app's query functions. When those
change, capture it again:

1. Log every statement (local only):
   `docker exec supabase_db_newschool-learning-platform psql -U supabase_admin -c "alter system set log_min_duration_statement = 0" -c "select pg_reload_conf()"`.
2. Note the time, then run the pages once: `PERF_RUNS=0 pnpm perf:pages`.
3. `docker logs --since <time> supabase_db_newschool-learning-platform 2>&1 | node scripts/perf/capture.mjs > captured.sql`
   — each statement with its parameters filled in and the user it ran as (keys and tokens
   in the log are not printed; keep the raw log out of the repository).
4. Turn logging off again (`alter system reset log_min_duration_statement`, reload).
5. Copy the new statements into `bench.sql` as `select pg_temp.bench('<who>', '<label>', $q$…$q$);`,
   replacing ids and times with the placeholders listed at the top of the file
   (`{s_id}`, `{s_course}`, `{t_group}`, `{t_group_students}`, `{now-8d}`, …).
