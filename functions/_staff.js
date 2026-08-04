/* חדר המורים — shared auth helpers for the Teacher Dashboard endpoints.

   Deliberately separate from _shared.js's buyer auth:
     - buyers get a stateless HMAC cookie gated on paid_until;
     - staff get a SERVER-SIDE session row gated on role + active, so
       disabling or deleting an account kills its live sessions at once.
   Password hashing reuses _shared.js's PBKDF2 so there is one implementation
   in the repo, just packed into a single column here. */

import { json, hashPassword, timingSafeEqual } from './_shared.js';

export const STAFF_COOKIE = 'ns_staff';
const SESSION_DAYS = 14;
const RESET_TTL_MS = 3600000;          /* one hour */
const MAX_FAILED = 8;
const LOCK_MS = 15 * 60000;            /* 15 minutes after MAX_FAILED misses */

export const ROLES = ['מורה', 'מנהל פדגוגי', 'אדמין', 'מנהלת קבלה', 'תלמיד'];
/* Only the office admin manages accounts. מנהל פדגוגי sees the school but
   does not mint logins — that stays one desk's job. */
const ADMIN_ROLES = ['אדמין'];

export const MIN_PASS = 6;             /* matches the dashboard's own copy */

/* ── ids, tokens ───────────────────────────────────────────────────────── */

function hexOf(bytes) {
  return [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function randomId(prefix = 'u') {
  return prefix + hexOf(crypto.getRandomValues(new Uint8Array(12)));
}

export function randomToken() {
  return hexOf(crypto.getRandomValues(new Uint8Array(32)));
}

/* Tokens are stored hashed; the raw value only ever lives in the cookie or
   the reset link. */
export async function tokenHash(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hexOf(new Uint8Array(buf));
}

/* ── passwords (single-column packing over _shared.js's PBKDF2) ─────────── */

export async function packPassword(pass) {
  const { hash, salt } = await hashPassword(pass);
  return `pbkdf2$100000$${salt}$${hash}`;
}

export async function checkPassword(pass, packed) {
  const parts = String(packed || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const { hash } = await hashPassword(pass, parts[2]);
  return timingSafeEqual(hash, parts[3]);
}

/* ── sessions ──────────────────────────────────────────────────────────── */

export async function startSession(env, userId) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO staff_sessions (token_hash, user_id, expires_at, created_at) VALUES (?,?,?,?)'
  ).bind(await tokenHash(token), userId, now + SESSION_DAYS * 86400000, now).run();
  /* Opportunistic sweep — D1 has no TTL, and expired rows are dead weight. */
  await env.DB.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').bind(now).run();
  return token;
}

export function sessionCookie(token) {
  return `${STAFF_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearStaffCookie =
  `${STAFF_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function cookieToken(request) {
  const raw = (request.headers.get('Cookie') || '')
    .split(/;\s*/).find(c => c.startsWith(STAFF_COOKIE + '='));
  return raw ? raw.slice(STAFF_COOKIE.length + 1) : '';
}

/* The live staff user behind this request, or null. Re-reads the user row on
   every call on purpose: a session must die the moment the account is
   disabled, not at the next login. */
export async function currentStaff(request, env) {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM staff_sessions s JOIN staff_users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(await tokenHash(token), Date.now()).first();
  if (!row || !row.active) return null;
  return row;
}

export async function endSession(request, env) {
  const token = cookieToken(request);
  if (!token) return;
  await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash=?')
    .bind(await tokenHash(token)).run();
}

export async function endAllSessions(env, userId) {
  await env.DB.prepare('DELETE FROM staff_sessions WHERE user_id=?').bind(userId).run();
}

/* ── password reset ────────────────────────────────────────────────────── */

/* Mints a single-use token and returns the RAW value — the caller decides
   where it may go (an email, or an admin's screen for manual relay). Any
   earlier unused token for the user is burned, so the newest link is the only
   live one.

   An invite gets a week rather than an hour: a password reset is something
   you asked for thirty seconds ago, an invite is something that has to
   survive a WhatsApp message read the next morning. */
export async function issueResetToken(env, userId, ttl = RESET_TTL_MS) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('UPDATE staff_reset_tokens SET used=1 WHERE user_id=? AND used=0')
    .bind(userId).run();
  await env.DB.prepare(
    'INSERT INTO staff_reset_tokens (token_hash, user_id, expires_at, used, created_at) VALUES (?,?,?,0,?)'
  ).bind(await tokenHash(token), userId, now + ttl, now).run();
  await env.DB.prepare('DELETE FROM staff_reset_tokens WHERE expires_at < ?').bind(now).run();
  return token;
}

/* Extensionless: the asset server 307s the '.html' form to this one, and a
   reset link that redirects risks losing the ?reset= query on the way. */
export const DASHBOARD_PATH = '/dashboard';

export function resetLink(request, token) {
  return `${new URL(request.url).origin}${DASHBOARD_PATH}?reset=${token}`;
}

/* ── shapes handed to the browser ──────────────────────────────────────── */

export function initialsOf(name) {
  return String(name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('');
}

export function roleLabel(role) {
  return role === 'מורה' ? 'מורה · תיק אישי'
    : role === 'אדמין' ? 'אדמין · משרד'
    : role === 'מנהלת קבלה' ? 'קבלה ורישום'
    : role === 'תלמיד' ? 'תלמיד/ה'
    : 'מנהל פדגוגי';
}

/* What the dashboard's session object needs — never the hash. */
export function publicUser(u) {
  let screens = null;
  if (u.screens) { try { screens = JSON.parse(u.screens); } catch { screens = null; } }
  return {
    id: u.id,
    user: u.username || u.email,
    email: u.email,
    name: u.name,
    role: u.role,
    initials: u.initials || initialsOf(u.name),
    label: roleLabel(u.role),
    teacherName: u.role === 'מורה' ? u.name : '',
    sid: u.student_id || '',
    active: !!u.active,
    mustChange: !!u.must_change,
    screens
  };
}

/* ── guards ────────────────────────────────────────────────────────────── */

export function isAdmin(u) {
  return !!u && ADMIN_ROLES.indexOf(u.role) > -1;
}

/* Resolves the caller and refuses anyone who is not an office admin. Returns
   {user} on success or {res} with the response to return. */
export async function requireAdmin(request, env) {
  const user = await currentStaff(request, env);
  if (!user) return { res: json({ ok: false, error: 'נדרשת התחברות.' }, 401) };
  if (!isAdmin(user)) return { res: json({ ok: false, error: 'הפעולה הזו שמורה לאדמין.' }, 403) };
  return { user };
}

/* ── login throttle ────────────────────────────────────────────────────── */

export function lockedOut(u) {
  return !!u && u.locked_until > Date.now();
}

export async function noteFailure(env, u) {
  const n = (u.failed_attempts || 0) + 1;
  const until = n >= MAX_FAILED ? Date.now() + LOCK_MS : 0;
  await env.DB.prepare('UPDATE staff_users SET failed_attempts=?, locked_until=? WHERE id=?')
    .bind(n >= MAX_FAILED ? 0 : n, until, u.id).run();
}

export async function noteSuccess(env, u) {
  if (!u.failed_attempts && !u.locked_until) return;
  await env.DB.prepare('UPDATE staff_users SET failed_attempts=0, locked_until=0 WHERE id=?')
    .bind(u.id).run();
}

/* ── lookup ────────────────────────────────────────────────────────────── */

/* The login form asks for "שם משתמש או אימייל", so accept either. */
export function findByHandle(env, handle) {
  const h = String(handle || '').trim().toLowerCase();
  if (!h) return Promise.resolve(null);
  return env.DB.prepare('SELECT * FROM staff_users WHERE email=? OR username=?')
    .bind(h, h).first();
}

export async function staffCount(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM staff_users').first();
  return row ? row.n : 0;
}

export function validRole(role) {
  return ROLES.indexOf(role) > -1;
}

export function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

export async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

export const RESET_TTL = RESET_TTL_MS;
export const INVITE_TTL = 7 * 24 * 3600000;
