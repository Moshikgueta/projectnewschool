-- D1 schema for חדר המורים.
-- Apply with: npx wrangler d1 execute teacher-room --file=schema.sql --remote

CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE,          -- optional short handle ('yotam'); login accepts either
  pass_hash TEXT NOT NULL,       -- pbkdf2$<iterations>$<saltHex>$<hashHex>
  role TEXT NOT NULL,            -- מורה | מנהל פדגוגי | אדמין | מנהלת קבלה | תלמיד
  name TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,      -- 0 = disabled, or self-signup awaiting approval
  must_change INTEGER NOT NULL DEFAULT 0, -- 1 after an admin issues a temporary password
  screens TEXT,                  -- JSON array of screen keys; NULL = every screen
  student_id TEXT,               -- links a תלמיד account to its student record
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Server-side sessions rather than a stateless signed cookie: an admin who
-- disables or deletes an account must be able to kill its live sessions.
-- Only the SHA-256 of the cookie value is stored, so a dump of this table
-- cannot be replayed as a login.
CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id),
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_exp ON staff_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_staff_reset_user ON staff_reset_tokens(user_id);

-- ── student entry codes ──────────────────────────────────────────────────
-- A תלמיד account signs in with a short code the teacher hands out, not with
-- an email and password. UNIQUE(user_id) is the "one live code per student"
-- rule: rotating is a delete followed by an insert, so an old code stops
-- working the instant a new one is printed.
--
-- The stored value is SHA-256 of the normalised code plus a server-side
-- pepper (STUDENT_CODE_PEPPER). Deterministic on purpose — the student types
-- nothing but the code, so the row has to be findable from the code alone,
-- and a per-row salt would mean scanning every student on every attempt.
-- That trade is what makes the pepper load-bearing: without it, a dump of
-- this table is brute-forceable offline in seconds.
CREATE TABLE IF NOT EXISTS student_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES staff_users(id),
  issued_by TEXT,                -- staff_users.id of whoever pressed the button
  created_at INTEGER NOT NULL
);

-- Code entry cannot use staff_users.failed_attempts: a password guess targets
-- one named account, but a code guess targets every student at once, so the
-- counter has to hang off the caller instead of the target. One row per
-- scope — 'ip:<addr>' for the ordinary limit, 'all' for the circuit breaker
-- that a distributed sweep trips and a real school never does.
CREATE TABLE IF NOT EXISTS code_attempts (
  scope TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  n INTEGER NOT NULL
);

-- ── rooms and the weekly timetable ───────────────────────────────────────
-- The first school data to live server-side rather than in the page. Until
-- now a group carried its room as free text ('כיתה 2 · פרונטלי'), which reads
-- fine and answers nothing: you cannot ask a string whether it is free on
-- Tuesday at ten.
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,     -- 'כיתה 2'
  capacity INTEGER NOT NULL DEFAULT 0,   -- 0 = unstated
  kit TEXT NOT NULL DEFAULT '',  -- projector, whiteboard, floor — free text on purpose
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- One row per recurring weekly slot, which is the shape a language school's
-- timetable actually has: the same class in the same room every Tuesday.
--
-- Times are minutes from midnight (600 = 10:00), not 'HH:MM'. Overlap is then
-- integer comparison — start < other.end AND end > other.start — instead of
-- string parsing on every check, and the double-booking guard is one WHERE
-- clause rather than a loop. The UI formats them back for display.
--
-- weekday is 0=Sunday … 6=Saturday, matching JS getDay() and the Israeli week.
CREATE TABLE IF NOT EXISTS room_bookings (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  title TEXT NOT NULL,           -- 'English Foundations'
  teacher TEXT NOT NULL DEFAULT '',
  weekday INTEGER NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookings_room_day ON room_bookings(room_id, weekday);

-- Next up, per MIGRATION-FROM-TAZMAN.md: teachers · students · availability ·
-- lessons · groups · group_members · packages · attendance · reminders.
-- Those tables are what turn this from "logins work" into a booking system.

-- ══ New School Cycles — the practice platform ═════════════════════════════
-- Content: language → level → cycle (topic group) → topic → exercise.
-- Nothing here carries an order a student must follow: `sort` exists only so
-- staff screens are stable, and the student UI never shows it.
--
-- A student reaches content only through an ACTIVE enrollment in a PUBLISHED
-- level of a PUBLISHED language. Every student endpoint checks this in the
-- Worker (functions/learn/_core.js → levelAccess); nothing is trusted from
-- the page. Answer keys live in exercises.key_json and are never sent to a
-- student before they have answered.

CREATE TABLE IF NOT EXISTS languages (
  id TEXT PRIMARY KEY,              -- ISO code: es, en, de, it, fr, ar, el
  name_he TEXT NOT NULL,
  name_native TEXT NOT NULL,
  dir TEXT NOT NULL DEFAULT 'ltr',  -- direction of learning content
  status TEXT NOT NULL DEFAULT 'draft',       -- draft | published
  sort INTEGER NOT NULL DEFAULT 0,
  font_stack TEXT NOT NULL DEFAULT '',
  special_chars TEXT NOT NULL DEFAULT '[]',   -- JSON: on-screen character keys
  normalize TEXT NOT NULL DEFAULT '{}',       -- JSON: answer-normalization defaults
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS levels (
  id TEXT PRIMARY KEY,              -- 'es-1'
  language_id TEXT NOT NULL REFERENCES languages(id),
  number INTEGER NOT NULL,          -- the enrollment level: Spanish Level 1
  name_he TEXT NOT NULL,
  name_target TEXT NOT NULL DEFAULT '',
  cefr TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  challenge_enabled INTEGER NOT NULL DEFAULT 1,
  rubric TEXT NOT NULL DEFAULT '[]',          -- JSON rows: open-task rubric
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(language_id, number)
);

CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL REFERENCES levels(id),
  title_he TEXT NOT NULL,
  title_target TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS topics (
  id TEXT PRIMARY KEY,              -- slug; internal, never shown as a number
  level_id TEXT NOT NULL REFERENCES levels(id),
  cycle_id TEXT REFERENCES cycles(id),
  title_he TEXT NOT NULL,
  title_target TEXT NOT NULL DEFAULT '',
  objective TEXT NOT NULL DEFAULT '',
  objective_source TEXT NOT NULL DEFAULT 'staff',
  skills TEXT NOT NULL DEFAULT '[]',        -- JSON [{he, target}] — the two main skills
  grammar TEXT NOT NULL DEFAULT '[]',       -- JSON [string]
  explanation TEXT NOT NULL DEFAULT '{}',   -- JSON {rules, examples, tips, mistakes}
  vocab TEXT NOT NULL DEFAULT '[]',         -- JSON [{term, he}]
  self_check TEXT NOT NULL DEFAULT '[]',    -- JSON [string]
  links TEXT NOT NULL DEFAULT '[]',         -- JSON [{label, url}]
  status TEXT NOT NULL DEFAULT 'draft',
  source_ref TEXT NOT NULL DEFAULT '',      -- e.g. workbook unit, for staff only
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_level ON topics(level_id);

CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  kind TEXT NOT NULL,               -- recall gap choice bank correction transform translate
                                    -- conjugation reading wordorder selftest match order open
  skill TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'auto',        -- auto (graded) | self (model + self-review)
  body TEXT NOT NULL DEFAULT '{}',          -- JSON, safe to send to an enrolled student
  key_json TEXT NOT NULL DEFAULT '{}',      -- JSON, never sent before an answer
  status TEXT NOT NULL DEFAULT 'published',
  source_ref TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_topic ON exercises(topic_id);

-- Audio and other protected files. The bytes live in R2 (binding MEDIA); a
-- row without a stored object is how a missing recording is reported.
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL REFERENCES levels(id),
  topic_id TEXT REFERENCES topics(id),
  kind TEXT NOT NULL DEFAULT 'audio',
  title TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL
);

-- ── who may see what ────────────────────────────────────────────────────
-- Ending an enrollment flips status; it never deletes. History stays with
-- the student, access does not.
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES staff_users(id),
  level_id TEXT NOT NULL REFERENCES levels(id),
  status TEXT NOT NULL DEFAULT 'active',    -- active | ended
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  created_by TEXT,
  ended_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_enroll_user ON enrollments(user_id, status);
CREATE INDEX IF NOT EXISTS idx_enroll_level ON enrollments(level_id, status);

-- Which levels a מורה teaches. A teacher sees only these levels' content and
-- only students enrolled (now or before) in them.
CREATE TABLE IF NOT EXISTS teacher_levels (
  teacher_id TEXT NOT NULL REFERENCES staff_users(id),
  level_id TEXT NOT NULL REFERENCES levels(id),
  PRIMARY KEY (teacher_id, level_id)
);

-- ── the student's record ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  client_id TEXT NOT NULL,          -- idempotency: a double submit is one attempt
  context TEXT NOT NULL DEFAULT 'practice',   -- practice | review | challenge
  answers TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  correct INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  self_assessed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_level ON attempts(level_id, created_at);

-- Completion is per exercise; accuracy and mastery are per item (item_state).
CREATE TABLE IF NOT EXISTS exercise_progress (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_correct INTEGER NOT NULL DEFAULT 0,
  best_correct INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,     -- every item answered (or self-review done)
  self_rating TEXT,                          -- open tasks: not_yet | almost | done
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, exercise_id)
);
CREATE INDEX IF NOT EXISTS idx_progress_level ON exercise_progress(user_id, level_id);

-- One row per gradable item a student has met. This is where "mistakes to
-- review" and "evidence of mastery" come from:
--   status open      → last answer wrong, waiting for review
--   status ok        → answered correctly
--   retained_at      → answered correctly on a later day than first seen, with
--                      no revealed answer that day: evidence, not completion.
CREATE TABLE IF NOT EXISTS item_state (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  item_idx INTEGER NOT NULL,
  topic_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  skill TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,             -- open | ok
  first_result INTEGER NOT NULL,    -- 1 = right first time
  wrong_count INTEGER NOT NULL DEFAULT 0,
  right_count INTEGER NOT NULL DEFAULT 0,
  wrong_tries INTEGER NOT NULL DEFAULT 0,   -- consecutive misses; 2 unlocks the answer
  revealed_day TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_wrong_at INTEGER,
  retained_at INTEGER,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, exercise_id, item_idx)
);
CREATE INDEX IF NOT EXISTS idx_items_level ON item_state(user_id, level_id, status);

CREATE TABLE IF NOT EXISTS activity_state (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS saved_items (
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,               -- word | exercise
  ref TEXT NOT NULL,                -- the Spanish term, or an exercise id
  level_id TEXT NOT NULL,
  meaning TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref, level_id)
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY,
  gamification INTEGER NOT NULL DEFAULT 0,  -- 0 = calm Practice Mode
  weekly_goal INTEGER NOT NULL DEFAULT 3,   -- practice days a week
  current_level TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS xp_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xp_user ON xp_events(user_id, day);

CREATE TABLE IF NOT EXISTS game_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  level_id TEXT NOT NULL,
  game TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_games_user ON game_scores(user_id, level_id, game);

-- Practice a teacher suggests. A set of topics or activities, never a sequence.
CREATE TABLE IF NOT EXISTS practice_assignments (
  id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL REFERENCES levels(id),
  student_id TEXT,                  -- NULL = everyone enrolled in the level
  topic_ids TEXT NOT NULL DEFAULT '[]',
  exercise_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_assign_level ON practice_assignments(level_id, archived);

-- "My answer is also right": a student's alternative, for a teacher to accept
-- (it is then added to the key) or reject. Never counted as correct until then.
CREATE TABLE IF NOT EXISTS answer_flags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  item_idx INTEGER NOT NULL,
  level_id TEXT NOT NULL,
  answer TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',      -- open | accepted | rejected
  reviewed_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_flags_level ON answer_flags(level_id, status);
