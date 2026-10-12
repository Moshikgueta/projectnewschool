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

-- ── teacher onboarding & training ────────────────────────────────────────
-- New School | Teacher Onboarding. Lives in the same D1 as the accounts and
-- reuses them: a "teacher" here is a staff_users row with role מורה, and the
-- people who manage training are אדמין and מנהל פדגוגי. Nothing below adds a
-- second user table.
--
-- user_id columns deliberately carry no REFERENCES to staff_users. Deleting
-- an account is an existing admin action (users/:id DELETE), and a foreign
-- key would turn it into a 500 for any teacher who ever opened a module. The
-- training record is kept as history instead; the UI shows "(חשבון נמחק)".

-- What the accounts table does not know about a teacher: what they teach
-- and since when. One row per teacher, created the first time it is set.
CREATE TABLE IF NOT EXISTS training_profiles (
  user_id TEXT PRIMARY KEY,
  language TEXT NOT NULL DEFAULT '',     -- teaching language: 'איטלקית'
  position TEXT NOT NULL DEFAULT '',     -- 'מורה פרטי · קבוצות אונליין'
  start_date TEXT NOT NULL DEFAULT '',   -- ISO yyyy-mm-dd, start of training
  updated_at INTEGER NOT NULL
);

-- A module is edited as a draft and read by teachers as its last published
-- snapshot, so a manager can rework a module mid-term without anyone seeing
-- half-finished content. Blocks are a JSON array inside the module (each has
-- a stable id that progress rows point at); `rev` is the optimistic-lock
-- counter that stops two editors overwriting each other.
CREATE TABLE IF NOT EXISTS training_modules (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  objectives TEXT NOT NULL DEFAULT '[]', -- JSON array of strings
  icon TEXT NOT NULL DEFAULT 'book',
  est_minutes INTEGER NOT NULL DEFAULT 0,
  pass_score INTEGER,                    -- % of auto-checked items; NULL = no threshold set
  status TEXT NOT NULL DEFAULT 'draft',  -- draft | published | archived
  draft TEXT NOT NULL DEFAULT '[]',      -- JSON blocks being edited
  published TEXT,                        -- JSON snapshot teachers read; NULL = never published
  rev INTEGER NOT NULL DEFAULT 1,        -- bumps on every saved draft
  published_rev INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',   -- name, kept even if the account goes
  created_at INTEGER NOT NULL
);

-- Every saved draft and every publish, as a full snapshot. This is the
-- restore point when an edit goes wrong — nothing is overwritten in place.
CREATE TABLE IF NOT EXISTS training_module_versions (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES training_modules(id),
  rev INTEGER NOT NULL,
  kind TEXT NOT NULL,                    -- save | publish | restore
  snapshot TEXT NOT NULL,                -- JSON {title, description, objectives, icon, estMinutes, passScore, blocks}
  note TEXT NOT NULL DEFAULT '',
  by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tmv_module ON training_module_versions(module_id, created_at);

CREATE TABLE IF NOT EXISTS training_paths (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'onboarding', -- onboarding | continuing
  language TEXT NOT NULL DEFAULT '',       -- '' = every language
  audience TEXT NOT NULL DEFAULT '',       -- role / teaching type / group, free text
  status TEXT NOT NULL DEFAULT 'active',   -- active | archived
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_path_modules (
  path_id TEXT NOT NULL REFERENCES training_paths(id),
  module_id TEXT NOT NULL REFERENCES training_modules(id),
  sort INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  prereq_module_id TEXT,                 -- must be completed before this one opens
  PRIMARY KEY (path_id, module_id)
);

-- A path given to one teacher. Readiness is a recorded decision by a
-- person, never computed: the columns hold who decided what, and when.
CREATE TABLE IF NOT EXISTS training_assignments (
  id TEXT PRIMARY KEY,
  path_id TEXT NOT NULL REFERENCES training_paths(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | completed | withdrawn
  due_date TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL DEFAULT '',
  assigned_at INTEGER NOT NULL,
  started_at INTEGER,
  last_activity_at INTEGER,
  last_module_id TEXT,
  readiness TEXT,                        -- ready | conditional | more_training
  readiness_note TEXT NOT NULL DEFAULT '',
  readiness_by TEXT NOT NULL DEFAULT '',
  readiness_at INTEGER,
  UNIQUE (path_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ta_user ON training_assignments(user_id);

-- Per block, per assignment. kind separates the four things the brief asks
-- to keep apart: viewed (read/watched), done (activity completed),
-- correct (passed an auto-checked item) — and approval, which lives on the
-- submission, because only a person grants it.
CREATE TABLE IF NOT EXISTS training_progress (
  assignment_id TEXT NOT NULL REFERENCES training_assignments(id),
  module_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  state TEXT NOT NULL,                   -- viewed | done
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER,                       -- 1/0 for auto-checked items, NULL otherwise
  answer TEXT,                           -- JSON of the last answer
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (assignment_id, module_id, block_id)
);

-- Work a person has to read. Every (re)submission is a new row, so the
-- history of drafts and feedback survives; the newest row is the live one.
CREATE TABLE IF NOT EXISTS training_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES training_assignments(id),
  module_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  body TEXT NOT NULL,                    -- JSON {text} | {fields:{...}} | {url, note}
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted | needs_revision | approved
  feedback TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ts_block ON training_submissions(assignment_id, module_id, block_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ts_status ON training_submissions(status);

-- The first 30 days after a teacher starts. Created when a manager records
-- readiness (or by hand), one row per checkpoint.
CREATE TABLE IF NOT EXISTS training_followups (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES training_assignments(id),
  checkpoint TEXT NOT NULL,              -- first_lesson | week1 | week2 | month1
  due_date TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',   -- open | done
  reflection TEXT NOT NULL DEFAULT '',   -- the teacher's
  manager_notes TEXT NOT NULL DEFAULT '',
  meeting_at TEXT NOT NULL DEFAULT '',
  recommendations TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  UNIQUE (assignment_id, checkpoint)
);

CREATE TABLE IF NOT EXISTS training_resources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'guide',    -- notebook | syllabus | lesson_plan | guide | video | enrichment | policy | link | faq | template
  category TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',     -- '' = general, every language
  level TEXT NOT NULL DEFAULT '',
  program TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  module_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',  -- official | draft | review | archived
  link_status TEXT NOT NULL DEFAULT 'unchecked', -- unchecked | ok | restricted | broken | error
  link_checked_at INTEGER,
  created_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS training_favorites (
  user_id TEXT NOT NULL,
  resource_id TEXT NOT NULL REFERENCES training_resources(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, resource_id)
);

-- "What's New" — professional updates, shown inside the portal only.
CREATE TABLE IF NOT EXISTS training_announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'update',   -- update | policy | module | tool
  status TEXT NOT NULL DEFAULT 'published', -- published | archived
  by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- In-portal notifications. Nothing here leaves the building: there is no
-- external sending until an email/push channel is set up and approved.
CREATE TABLE IF NOT EXISTS training_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tn_user ON training_notifications(user_id, created_at);

-- Every significant management action. Append-only: no endpoint edits or
-- deletes a row here.
CREATE TABLE IF NOT EXISTS training_audit (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor_id TEXT NOT NULL DEFAULT '',
  actor_name TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT '',
  subject_user_id TEXT NOT NULL DEFAULT '', -- the teacher it concerns, when there is one
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_taudit_at ON training_audit(at);
CREATE INDEX IF NOT EXISTS idx_taudit_subject ON training_audit(subject_user_id, at);
