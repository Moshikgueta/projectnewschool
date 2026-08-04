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

-- Next up, per MIGRATION-FROM-TAZMAN.md: teachers · students · availability ·
-- lessons · groups · group_members · packages · attendance · reminders.
-- Those tables are what turn this from "logins work" into a booking system.
