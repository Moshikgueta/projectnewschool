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
