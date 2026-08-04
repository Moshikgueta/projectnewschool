# Database & Auth — handoff brief

## Goal
Replace localStorage-based login/signup in `Teacher Dashboard v2.dc.html` and `Teacher Mobile.dc.html` with real accounts backed by a database: admin-managed signup (email + password), login, and self-serve "forgot password."

## Recommended stack
Cloudflare Worker + D1 (SQLite). Reuses the auth pattern already built for the `espanolsindolordecabeza` project (PBKDF2 password hashing, signed session cookie, reset-token flow) — port it rather than build from scratch.

## Schema (D1)
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,           -- 'מורה' | 'מנהל פדגוגי' | 'אדמין' | 'מנהלת קבלה'
  name TEXT NOT NULL,
  initials TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE reset_tokens (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);
```
Extend `users` later per `MIGRATION-FROM-TAZMAN.md` if teacher/student/lesson data also moves server-side.

## API endpoints needed
- `POST /api/auth/login` — `{email, password}` → sets session cookie, returns `{name, role, initials}`
- `POST /api/auth/logout` — clears session
- `POST /api/admin/users` (admin-only) — `{email, tempPassword, role, name}` → creates account
- `GET /api/admin/users` (admin-only) — list accounts for the admin panel
- `DELETE /api/admin/users/:id` (admin-only)
- `POST /api/auth/reset-request` — `{email}` → emails a reset link (or, with no email service yet, returns the token so an admin can relay it manually)
- `POST /api/auth/reset-complete` — `{token, newPassword}` → sets new password, invalidates token
- `GET /api/auth/me` — returns current session's user, for page load

## Frontend changes (in this repo)
In both `.dc.html` files, `USERS` is currently a hardcoded array and `session` is read/written to `localStorage`. Replace:
- Login form submit → `fetch('/api/auth/login', {method:'POST', body:...})` instead of matching against `USERS`.
- On mount, call `/api/auth/me` to restore session instead of reading localStorage directly (keep localStorage as a short-lived cache only, not source of truth).
- Add a "שכחתי סיסמה" link on the login screen → calls `/api/auth/reset-request`.
- Add a reset-password screen (token from URL query param) → calls `/api/auth/reset-complete`.
- Admin's user management screen (already scaffolded for pedagogical tasks) gets a new panel calling the `/api/admin/users` endpoints instead of a static list.

## Not included here
No email-sending is wired up. Cheapest path: Cloudflare Worker + a transactional email API (e.g. Resend) for the reset link. Until that's set up, an admin can manually share the reset link/token.

## Suggested next step
Hand this file + the two `.dc.html` files to a Claude Code session with access to the Cloudflare account, to stand up the Worker/D1 database and wire the endpoints in.
