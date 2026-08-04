CREATE TABLE IF NOT EXISTS staff_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  must_change INTEGER NOT NULL DEFAULT 0,
  screens TEXT,
  student_id TEXT,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

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
